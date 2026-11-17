using Backend;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using System.Text;

var originalDirectory = Directory.GetCurrentDirectory();
var directory = Path.Combine(Path.GetTempPath(), $"tracking-trucks-auth-{Guid.NewGuid():N}");
Directory.CreateDirectory(directory);
var profilesDirectory = Path.Combine(directory, "Database", "Profiles");
Directory.CreateDirectory(profilesDirectory);
File.WriteAllText(Path.Combine(profilesDirectory, "template.json"), "{\"id\":9999}");
Directory.SetCurrentDirectory(Directory.CreateDirectory(Path.Combine(directory, "Backend")).FullName);
var publications = new List<string>();
var checks = 0;
var serverArguments = new[] { "--urls", "http://127.0.0.1:0", "--environment", "Development", "--Logging:LogLevel:Default", "Warning" };
await using var app = API.CreateApp(
    serverArguments,
    message => publications.Add(message));
try
{
    Check(Database.DatabaseDirectory == Path.Combine(directory, "Database") && !Database.UsesGitStorage,
        "Development locates the checkout Database directory from the Backend folder");
    Database.InitializeStorage();
    await app.StartAsync();
    using var client = new HttpClient(new HttpClientHandler { CookieContainer = new CookieContainer() })
    {
        BaseAddress = new Uri(app.Urls.Single())
    };
    client.DefaultRequestHeaders.Add("X-Requested-With", "TrackingTrucks");
    const string password = "integration-password-238";
    var registration = new JsonObject
    {
        ["username"] = "  integration-operator  ",
        ["displayname"] = "Test Operator",
        ["password"] = password,
        ["confirm-password"] = password,
        ["phone-number"] = "555-0100",
        ["role"] = "admin"
    };
    var response = await client.GetAsync("/api/auth/session");
    Check(response.StatusCode == HttpStatusCode.Unauthorized, "Anonymous session is rejected");

    client.DefaultRequestHeaders.Remove("X-Requested-With");
    response = await client.PostAsJsonAsync("/api/Profiles/signup", registration);
    Check(response.StatusCode == HttpStatusCode.BadRequest, "Cross-origin form-style requests are rejected");
    client.DefaultRequestHeaders.Add("X-Requested-With", "TrackingTrucks");

    var invalid = (JsonObject)registration.DeepClone();
    invalid["password"] = "short";
    response = await client.PostAsJsonAsync("/api/Profiles/signup", invalid);
    Check(response.StatusCode == HttpStatusCode.BadRequest, "Short passwords are rejected");

    response = await client.PostAsJsonAsync("/api/Profiles/signup", registration);
    Check(response.StatusCode == HttpStatusCode.Created, "Registration creates a profile");
    Check(response.Headers.CacheControl?.NoStore == true, "Registration response is not cached");
    var body = await response.Content.ReadAsStringAsync();
    Check(!body.Contains("password") && !body.Contains("555-0100"), "Registration never returns credentials or contact details");
    var saved = JsonNode.Parse(File.ReadAllText(Path.Combine(profilesDirectory, "1.json")))!.AsObject();
    Check(saved["password"] is null && saved["password-hash"] is not null, "Only a password hash is stored");
    Check(saved["role"]!.GetValue<string>() == "user", "Registration cannot grant privileged roles");
    Check(saved["username"]!.GetValue<string>() == "integration-operator", "Username is normalized");
    Check(publications.Count == 1, "Registration publishes through the injected isolated publisher");

    registration["username"] = "INTEGRATION-OPERATOR";
    response = await client.PostAsJsonAsync("/api/Profiles/signup", registration);
    Check(response.StatusCode == HttpStatusCode.Conflict, "Duplicate usernames are case insensitive");
    Check(Directory.GetFiles(profilesDirectory).Length == 2, "Duplicate registration creates no additional record");

    response = await client.PostAsJsonAsync("/api/auth/login", new { username = "integration-operator", password = "wrong" });
    Check(response.StatusCode == HttpStatusCode.Unauthorized, "Incorrect password is rejected");
    response = await client.PostAsJsonAsync("/api/auth/login", new { username = "missing-user", password });
    Check(response.StatusCode == HttpStatusCode.Unauthorized, "Unknown username uses the same response");

    response = await client.PostAsJsonAsync("/api/auth/login", new { username = " INTEGRATION-OPERATOR ", password });
    Check(response.StatusCode == HttpStatusCode.OK, "A registered account can log in");
    var cookie = response.Headers.GetValues("Set-Cookie").Single();
    Check(cookie.Contains("httponly", StringComparison.OrdinalIgnoreCase) && cookie.Contains("samesite=strict", StringComparison.OrdinalIgnoreCase), "Session cookie is HttpOnly and SameSite Strict");
    response = await client.GetAsync("/api/auth/session");
    Check(response.StatusCode == HttpStatusCode.OK, "Cookie restores the session on subsequent requests");
    body = await response.Content.ReadAsStringAsync();
    Check(body.Contains("Test Operator") && !body.Contains("password"), "Session exposes only account display data");

    foreach (var path in new[] { "/api/Profiles", "/api/Profiles/1" })
    {
        body = await client.GetStringAsync(path);
        Check(!body.Contains("password") && !body.Contains("555-0100"), $"{path} hides credentials and contact details");
    }

    response = await client.PostAsync("/api/auth/logout", null);
    Check(response.StatusCode == HttpStatusCode.NoContent, "Logout clears the cookie");
    response = await client.GetAsync("/api/auth/session");
    Check(response.StatusCode == HttpStatusCode.Unauthorized, "Logged-out session is rejected");

    // Older profiles may have a descriptive filename rather than <id>.json.
    var legacy = new JsonObject { ["id"] = 2, ["username"] = "legacy", ["displayname"] = "Legacy", ["password"] = password };
    File.WriteAllText(Path.Combine(profilesDirectory, "legacy-profile.json"), legacy.ToJsonString());
    response = await client.PostAsJsonAsync("/api/auth/login", new { username = "legacy", password });
    Check(response.StatusCode == HttpStatusCode.OK, "Existing plaintext accounts can still log in");
    saved = JsonNode.Parse(File.ReadAllText(Path.Combine(profilesDirectory, "legacy-profile.json")))!.AsObject();
    Check(saved["password"] is null && saved["password-hash"] is not null && !File.Exists(Path.Combine(profilesDirectory, "2.json")), "Legacy password is upgraded in its original file");
    response = await client.PostAsJsonAsync("/api/auth/login", new { username = "legacy", password });
    Check(response.StatusCode == HttpStatusCode.OK, "Migrated account can log in again");
    File.Delete(Path.Combine(profilesDirectory, "legacy-profile.json"));
    response = await client.GetAsync("/api/auth/session");
    Check(response.StatusCode == HttpStatusCode.Unauthorized, "Deleted profiles cannot restore a session");

    for (var attempt = 0; attempt < 21; attempt++)
    {
        response = await client.PostAsJsonAsync("/api/auth/login", new { username = "missing", password });
        if (response.StatusCode == HttpStatusCode.TooManyRequests) break;
    }
    Check(response.StatusCode == HttpStatusCode.TooManyRequests, "Repeated authentication attempts are rate limited");
    await app.StopAsync();

    // A new host must authenticate from the saved JSON, not from in-memory state.
    var failPublication = false;
    await using var restarted = API.CreateApp(serverArguments, message =>
    {
        if (failPublication) throw new IOException("Simulated storage failure");
        publications.Add(message);
    });
    Database.InitializeStorage();
    await restarted.StartAsync();
    using var retryClient = new HttpClient { BaseAddress = new Uri(restarted.Urls.Single()) };
    retryClient.DefaultRequestHeaders.Add("X-Requested-With", "TrackingTrucks");
    response = await retryClient.PostAsJsonAsync("/api/auth/login", new { username = "integration-operator", password });
    Check(response.StatusCode == HttpStatusCode.OK, "Saved profile authenticates after the backend restarts");
    string before = Snapshot();
    int publicationCount = publications.Count;
    var invalidValues = new (string Key, JsonNode? Value)[]
    {
        ("username", "   "), ("username", "bad username"), ("username", new string('a', 51)),
        ("username", 123), ("displayname", " "), ("displayname", new string('n', 101)),
        ("displayname", "Bad\nName"), ("password", "short"), ("password", new string(' ', 8)),
        ("password", new string('p', 1025)), ("confirm-password", "different"),
        ("confirm-password", null), ("phone-number", "not a number"), ("phone-number", 123)
    };
    foreach (var (key, value) in invalidValues)
    {
        invalid = (JsonObject)registration.DeepClone();
        invalid["username"] = "invalid-candidate";
        invalid[key] = value?.DeepClone();
        response = await retryClient.PostAsJsonAsync("/api/Profiles/signup", invalid);
        Check(response.StatusCode == HttpStatusCode.BadRequest, $"Invalid {key} is rejected before persistence");
        Check(Snapshot() == before && publications.Count == publicationCount, "Rejected signup leaves files and publisher unchanged");
    }
    response = await retryClient.PostAsync("/api/Profiles/signup", new StringContent("{invalid-json", Encoding.UTF8, "application/json"));
    Check(response.StatusCode == HttpStatusCode.BadRequest && Snapshot() == before, "Malformed JSON creates no record");
    invalid = (JsonObject)registration.DeepClone();
    invalid["username"] = "retry-operator";
    failPublication = true;
    response = await retryClient.PostAsJsonAsync("/api/Profiles/signup", invalid);
    Check(response.StatusCode == HttpStatusCode.ServiceUnavailable && Snapshot() == before,
        "Failed persistence returns an error and rolls back the profile file");
    response = await retryClient.PostAsJsonAsync("/api/auth/login", new { username = "retry-operator", password });
    Check(response.StatusCode == HttpStatusCode.Unauthorized, "A failed signup cannot authenticate");
    failPublication = false;
    response = await retryClient.PostAsJsonAsync("/api/Profiles/signup", invalid);
    Check(response.StatusCode == HttpStatusCode.Created, "A failed signup can be retried without a duplicate account");
    Check(!Directory.GetFiles(profilesDirectory).Any(path => path.EndsWith(".tmp")), "Atomic writes leave no temporary files");
    await restarted.StopAsync();

    // Exercise the normal publisher too: local development must not need Git credentials.
    await using var local = API.CreateApp(serverArguments);
    Database.InitializeStorage();
    await local.StartAsync();
    using var localClient = new HttpClient { BaseAddress = new Uri(local.Urls.Single()) };
    localClient.DefaultRequestHeaders.Add("X-Requested-With", "TrackingTrucks");
    registration["username"] = "local-operator";
    response = await localClient.PostAsJsonAsync("/api/Profiles/signup", registration);
    Check(response.StatusCode == HttpStatusCode.Created && File.Exists(Path.Combine(profilesDirectory, "3.json")),
        "Normal local signup creates Database/Profiles/<id>.json without a Git publisher");
    response = await localClient.PostAsJsonAsync("/api/auth/login", new { username = "local-operator", password });
    Check(response.StatusCode == HttpStatusCode.OK, "Normal local signup can immediately log in");
    await local.StopAsync();

    Console.WriteLine($"Passed {checks} authentication integration checks; no live database or Git remote used.");
}
finally
{
    await app.StopAsync();
    Directory.SetCurrentDirectory(originalDirectory);
    Directory.Delete(directory, true);
}

void Check(bool condition, string message)
{
    if (!condition) throw new Exception($"FAILED: {message}");
    checks++;
    Console.WriteLine($"PASS: {message}");
}

string Snapshot() => string.Join("\n", Directory.GetFiles(profilesDirectory).Order()
    .Select(path => Path.GetFileName(path) + ":" + File.ReadAllText(path)));
