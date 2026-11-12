using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Linq;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using System.Security.Claims;

namespace Backend
{
    public class API
    {
        private static readonly object databaseWriteLock = new();

        private static bool TryGetDevelopmentRole(
            HttpContext context,
            IHostEnvironment environment,
            out string role)
        {
            role = string.Empty;

            if (!environment.IsDevelopment())
            {
                return false;
            }

            role = context.Request.Headers["X-Dev-Role"].ToString()
                .Trim()
                .ToLowerInvariant();

            return role is "user" or "owner" or "admin";
        }

        public static void startAPI(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);

            builder.Services
                .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
                .AddCookie(options =>
                {
                    options.Cookie.Name = "Dababy"; // The cookie is named Dababy
                    options.Cookie.HttpOnly = true; // The cookie is accessible only through HTTP(S), not JavaScript
                    options.Cookie.SameSite = SameSiteMode.Lax; // The cookie is sent with same-site requests and top-level navigation
                    options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
                        ? CookieSecurePolicy.SameAsRequest
                        : CookieSecurePolicy.Always; // The cookie is sent only over HTTPS in production
                    options.ExpireTimeSpan = TimeSpan.FromHours(8); // The cookie expires after 8 hours
                    options.Events.OnRedirectToLogin = context =>
                    {
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        return Task.CompletedTask;
                    };
                });

            builder.Services.AddAuthorization();

            var app = builder.Build();

            app.UseDefaultFiles();
            app.UseStaticFiles(new StaticFileOptions
            {
                OnPrepareResponse = context =>
                {
                    context.Context.Response.Headers.CacheControl =
                        context.Context.Request.Path.StartsWithSegments("/assets")
                            ? "public, max-age=31536000, immutable"
                            : "no-cache";
                }
            });

            app.UseAuthentication();
            app.UseAuthorization();

            // ==========================================
            // LOGIN ENDPOINT
            // ==========================================

            app.MapPost("/api/auth/login", async (HttpContext context, JsonObject request) =>
            {
                if (request["username"] is not JsonValue usernameValue ||
                    !usernameValue.TryGetValue<string>(out var username) ||
                    string.IsNullOrWhiteSpace(username))
                {
                    return Results.BadRequest(new { error = "Username is required." });
                }

                if (request["password"] is not JsonValue passwordValue ||
                    !passwordValue.TryGetValue<string>(out var password) ||
                    string.IsNullOrWhiteSpace(password))
                {
                    return Results.BadRequest(new { error = "Password is required." });
                }

                var profile = GetDataFromDirectory(GetCollectionDirectory("Profiles"))
                    .OfType<JsonObject>()
                    .FirstOrDefault(record =>
                        record["username"] is JsonValue profileUsernameValue &&
                        profileUsernameValue.TryGetValue<string>(out var profileUsername) &&
                        string.Equals(
                            profileUsername,
                            username.Trim(),
                            StringComparison.OrdinalIgnoreCase));

                if (profile is null ||
                    profile["password"] is not JsonValue profilePasswordValue ||
                    !profilePasswordValue.TryGetValue<string>(out var profilePassword) ||
                    !string.Equals(profilePassword, password, StringComparison.Ordinal))
                {
                    return Results.Unauthorized();
                }

                if (profile["id"] is not JsonValue idValue ||
                !idValue.TryGetValue<int>(out var profileId))
                {
                    return Results.Problem("The profile is missing a valid ID");
                }

                var claims = new[]
                {
                    new Claim(ClaimTypes.NameIdentifier, profileId.ToString()),
                    new Claim(ClaimTypes.Name, username.Trim())
                };

                var identity = new ClaimsIdentity(
                    claims,
                    CookieAuthenticationDefaults.AuthenticationScheme);

                await context.SignInAsync(
                    CookieAuthenticationDefaults.AuthenticationScheme,
                    new ClaimsPrincipal(identity));

                return Results.Ok(new
                {
                    id = profileId,
                    username = username.Trim(),
                });
            });

            // ==========================================
            // TRUCK ENDPOINTS
            // ==========================================

            app.MapGet("/api/Trucks", () =>
            {
                var data = GetDataFromDirectory(GetCollectionDirectory("Trucks"));
                return Results.Ok(new { Data = data, Status = "Success", Timestamp = DateTime.UtcNow });
            });

            app.MapGet("/api/Trucks/{id:int}", (int id) =>
            {
                var truck = GetDataFromDirectory(GetCollectionDirectory("Trucks"))
                    .OfType<JsonObject>()
                    .FirstOrDefault(record => record["id"]?.GetValue<int>() == id);

                if (truck is null)
                {
                    return Results.NotFound();
                }

                return Results.Ok(truck);
            });

            app.MapPost("/api/Trucks", (HttpContext context, JsonObject truck) =>
            {
                if (!TryGetDevelopmentRole(context, app.Environment, out var role) || role == "user")
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                int? ownerProfileId = null;
                if (role == "owner")
                {
                    if (!TryGetDevelopmentOwnerProfileId(context, out int profileId))
                    {
                        return Results.StatusCode(StatusCodes.Status403Forbidden);
                    }
                    ownerProfileId = profileId;
                }

                if (truck["id"] is not JsonValue idValue || !idValue.TryGetValue<int>(out var id) || id <= 0)
                {
                    return Results.BadRequest(new { error = "A positive int id is required" });
                }

                if (truck["truckname"] is not JsonValue nameValue || !nameValue.TryGetValue<string>(out var truckname) || string.IsNullOrWhiteSpace(truckname))
                {
                    return Results.BadRequest(new { error = "A truckname is required" });
                }

                if (truck["tags"] is not JsonArray ||
                    truck["profileIds"] is not JsonArray profileIds || profileIds.Count != 0 ||
                    truck["scheduleIds"] is not JsonArray scheduleIds || scheduleIds.Count != 0)
                {
                    return Results.BadRequest(new { error = "For now, tags must be an array and profileIds/scheduleIds must be empty arrays." });
                }

                lock (databaseWriteLock)
                {
                    bool existingTruck = GetDataFromDirectory(GetCollectionDirectory("Trucks"))
                        .OfType<JsonObject>()
                        .Any(record => record["id"] is JsonValue recordId && recordId.TryGetValue<int>(out var existingId) && existingId == id);

                    if (existingTruck)
                    {
                        return Results.Conflict(new { error = $"Truck id {id} already exists." });
                    }

                    JsonObject truckToSave = (JsonObject)truck.DeepClone();
                    if (ownerProfileId is int profileId)
                    {
                        truckToSave["profileIds"] = new JsonArray(profileId);
                        Database.addTruckToProfileDatabase(profileId, id);
                    }

                    Database.writeTrucksDatabase($"{id}.json", truckToSave.ToJsonString());
                    PushDatabaseChanges($"Create truck {id}");
                    return Results.Created($"/api/Trucks/{id}", truckToSave);
                }
            });

            app.MapPut("/api/Trucks/{id:int}", (HttpContext context, int id, JsonObject updatedTruck) =>
            {
                if (!TryGetDevelopmentRole(context, app.Environment, out var role) || role == "user")
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                int? ownerProfileId = null;
                if (role == "owner")
                {
                    if (!TryGetDevelopmentOwnerProfileId(context, out int profileId))
                    {
                        return Results.StatusCode(StatusCodes.Status403Forbidden);
                    }
                    ownerProfileId = profileId;
                }

                lock (databaseWriteLock)
                {
                    var existingTruck = GetDataFromDirectory(GetCollectionDirectory("Trucks"))
                        .OfType<JsonObject>()
                        .FirstOrDefault(record => record["id"] is JsonValue idValue && idValue.TryGetValue<int>(out var existingId) && existingId == id);

                    if (existingTruck is null) return Results.NotFound();

                    if (ownerProfileId is int profileId && !IsTruckLinkedToProfile(existingTruck, profileId, id))
                    {
                        return Results.StatusCode(StatusCodes.Status403Forbidden);
                    }

                    if (updatedTruck["id"] is not JsonValue updatedIdValue || !updatedIdValue.TryGetValue<int>(out var updatedId) || updatedId != id ||
                        updatedTruck["truckname"] is not JsonValue nameValue || !nameValue.TryGetValue<string>(out var truckName) || string.IsNullOrWhiteSpace(truckName) ||
                        updatedTruck["tags"] is not JsonArray || updatedTruck["profileIds"] is not JsonArray profileIds || updatedTruck["scheduleIds"] is not JsonArray scheduleIds)
                    {
                        return Results.BadRequest(new { error = "Invalid truck record" });
                    }

                    if (existingTruck["profileIds"]?.ToJsonString() != profileIds.ToJsonString() ||
                        existingTruck["scheduleIds"]?.ToJsonString() != scheduleIds.ToJsonString())
                    {
                        return Results.BadRequest(new { error = "Changing profileIds or scheduleIds is not supported yet." });
                    }

                    Database.writeTrucksDatabase($"{id}.json", updatedTruck.ToJsonString());
                    PushDatabaseChanges($"Update truck {id}");
                    return Results.Ok(updatedTruck);
                }
            });

            app.MapDelete("/api/Trucks/{id:int}", (HttpContext context, int id) =>
            {
                if (!TryGetDevelopmentRole(context, app.Environment, out var role) || role == "user")
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                int? ownerProfileId = null;
                if (role == "owner")
                {
                    if (!TryGetDevelopmentOwnerProfileId(context, out int profileId))
                    {
                        return Results.StatusCode(StatusCodes.Status403Forbidden);
                    }
                    ownerProfileId = profileId;
                }

                lock (databaseWriteLock)
                {
                    var existingTruck = GetDataFromDirectory(GetCollectionDirectory("Trucks"))
                        .OfType<JsonObject>()
                        .FirstOrDefault(record => record["id"] is JsonValue idValue && idValue.TryGetValue<int>(out var existingId) && existingId == id);

                    if (existingTruck is null) return Results.NotFound();

                    if (ownerProfileId is int profileId && !IsTruckLinkedToProfile(existingTruck, profileId, id))
                    {
                        return Results.StatusCode(StatusCodes.Status403Forbidden);
                    }

                    Database.removeTruckLinksDatabase(id);
                    Database.deleteTrucksDatabase($"{id}.json");
                    PushDatabaseChanges($"Delete truck {id}");
                    return Results.NoContent();
                }
            });

            // ==========================================
            // SCHEDULE ENDPOINTS
            // ==========================================

            app.MapGet("/api/Schedules", () =>
            {
                var data = GetDataFromDirectory(GetCollectionDirectory("Schedules"));
                return Results.Ok(new { Data = data, Status = "Success", Timestamp = DateTime.UtcNow });
            });

            app.MapGet("/api/Schedules/{id:int}", (int id) =>
            {
                var schedule = GetDataFromDirectory(GetCollectionDirectory("Schedules"))
                    .OfType<JsonObject>()
                    .FirstOrDefault(record => record["id"]?.GetValue<int>() == id);

                if (schedule is null) return Results.NotFound();
                return Results.Ok(schedule);
            });

            app.MapPost("/api/Schedules", (HttpContext context, JsonObject schedule) =>
            {
                if (!TryGetDevelopmentRole(context, app.Environment, out var role) || role == "user")
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                if (schedule["id"] is not JsonValue idValue || !idValue.TryGetValue<int>(out var id) || id <= 0)
                {
                    return Results.BadRequest(new { error = "A positive int id is required for schedule" });
                }

                lock (databaseWriteLock)
                {
                    bool exists = GetDataFromDirectory(GetCollectionDirectory("Schedules"))
                        .OfType<JsonObject>()
                        .Any(record => record["id"] is JsonValue recordId && recordId.TryGetValue<int>(out var existingId) && existingId == id);

                    if (exists) return Results.Conflict(new { error = $"Schedule id {id} already exists." });

                    Database.writeSchedulesDatabase($"{id}.json", schedule.ToJsonString());
                    PushDatabaseChanges($"Create schedule {id}");
                    return Results.Created($"/api/Schedules/{id}", schedule);
                }
            });

            app.MapPut("/api/Schedules/{id:int}", (int id, JsonObject updatedSchedule) =>
            {
                lock (databaseWriteLock)
                {
                    var existing = GetDataFromDirectory(GetCollectionDirectory("Schedules"))
                        .OfType<JsonObject>()
                        .FirstOrDefault(record => record["id"] is JsonValue idValue && idValue.TryGetValue<int>(out var existingId) && existingId == id);

                    if (existing is null) return Results.NotFound();

                    if (updatedSchedule["id"] is not JsonValue updatedIdValue || !updatedIdValue.TryGetValue<int>(out var updatedId) || updatedId != id)
                    {
                        return Results.BadRequest(new { error = "Invalid schedule record or ID mismatch" });
                    }

                    if (existing["history"] is not null and not JsonArray)
                    {
                        return Results.BadRequest(new { error = "The schedule has invalid revision history." });
                    }

                    string updatedAt = DateTimeOffset.UtcNow.ToString("O");
                    var history = existing["history"] is JsonArray existingHistory
                        ? (JsonArray)existingHistory.DeepClone()
                        : new JsonArray();
                    var previousSchedule = (JsonObject)existing.DeepClone();
                    previousSchedule.Remove("history");
                    history.Add(new JsonObject
                    {
                        ["updatedAt"] = updatedAt,
                        ["schedule"] = previousSchedule
                    });

                    var scheduleToSave = (JsonObject)existing.DeepClone();
                    foreach (var property in updatedSchedule)
                    {
                        if (property.Key is "history" or "last-revised")
                        {
                            continue;
                        }

                        scheduleToSave[property.Key] = property.Value?.DeepClone();
                    }
                    scheduleToSave["history"] = history;
                    scheduleToSave["last-revised"] = updatedAt;

                    Database.writeSchedulesDatabase($"{id}.json", scheduleToSave.ToJsonString());
                    PushDatabaseChanges($"Update schedule {id}");
                    return Results.Ok(scheduleToSave);
                }
            });

            app.MapDelete("/api/Schedules/{id:int}", (HttpContext context, int id) =>
            {
                if (!TryGetDevelopmentRole(context, app.Environment, out var role) || role == "user")
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                lock (databaseWriteLock)
                {
                    var existing = GetDataFromDirectory(GetCollectionDirectory("Schedules"))
                        .OfType<JsonObject>()
                        .FirstOrDefault(record => record["id"] is JsonValue idValue && idValue.TryGetValue<int>(out var existingId) && existingId == id);

                    if (existing is null) return Results.NotFound();

                    Database.deleteSchedulesDatabase($"{id}.json");
                    PushDatabaseChanges($"Delete schedule {id}");
                    return Results.NoContent();
                }
            });

            // ==========================================
            // PROFILE ENDPOINTS
            // ==========================================

            app.MapGet("/api/Profiles", () =>
            {
                var data = GetDataFromDirectory(GetCollectionDirectory("Profiles"));
                return Results.Ok(new { Data = data, Status = "Success", Timestamp = DateTime.UtcNow });
            });

            app.MapGet("/api/Profiles/{id:int}", (int id) =>
            {
                var profile = GetDataFromDirectory(GetCollectionDirectory("Profiles"))
                    .OfType<JsonObject>()
                    .FirstOrDefault(record => record["id"]?.GetValue<int>() == id);

                if (profile is null) return Results.NotFound();
                return Results.Ok(profile);
            });

            app.MapPost("/api/Profiles", (HttpContext context, JsonObject profile) =>
            {
                // Profile creation typically restricted to Admin
                if (!TryGetDevelopmentRole(context, app.Environment, out var role) || role != "admin")
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                if (profile["id"] is not JsonValue idValue || !idValue.TryGetValue<int>(out var id) || id <= 0)
                {
                    return Results.BadRequest(new { error = "A positive int id is required for profile" });
                }

                lock (databaseWriteLock)
                {
                    bool exists = GetDataFromDirectory(GetCollectionDirectory("Profiles"))
                        .OfType<JsonObject>()
                        .Any(record => record["id"] is JsonValue recordId && recordId.TryGetValue<int>(out var existingId) && existingId == id);

                    if (exists) return Results.Conflict(new { error = $"Profile id {id} already exists." });

                    Database.writeProfilesDatabase($"{id}.json", profile.ToJsonString());
                    PushDatabaseChanges($"Create profile {id}");
                    return Results.Created($"/api/Profiles/{id}", profile);
                }
            });

            app.MapPut("/api/Profiles/{id:int}", (HttpContext context, int id, JsonObject updatedProfile) =>
            {
                if (!TryGetDevelopmentRole(context, app.Environment, out var role) || role != "admin")
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                lock (databaseWriteLock)
                {
                    var existing = GetDataFromDirectory(GetCollectionDirectory("Profiles"))
                        .OfType<JsonObject>()
                        .FirstOrDefault(record => record["id"] is JsonValue idValue && idValue.TryGetValue<int>(out var existingId) && existingId == id);

                    if (existing is null) return Results.NotFound();

                    if (updatedProfile["id"] is not JsonValue updatedIdValue || !updatedIdValue.TryGetValue<int>(out var updatedId) || updatedId != id)
                    {
                        return Results.BadRequest(new { error = "Invalid profile record or ID mismatch" });
                    }

                    Database.writeProfilesDatabase($"{id}.json", updatedProfile.ToJsonString());
                    PushDatabaseChanges($"Update profile {id}");
                    return Results.Ok(updatedProfile);
                }
            });

            app.MapDelete("/api/Profiles/{id:int}", (HttpContext context, int id) =>
            {
                if (!TryGetDevelopmentRole(context, app.Environment, out var role) || role != "admin")
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                lock (databaseWriteLock)
                {
                    var existing = GetDataFromDirectory(GetCollectionDirectory("Profiles"))
                        .OfType<JsonObject>()
                        .FirstOrDefault(record => record["id"] is JsonValue idValue && idValue.TryGetValue<int>(out var existingId) && existingId == id);

                    if (existing is null) return Results.NotFound();

                    Database.deleteProfilesDatabase($"{id}.json");
                    PushDatabaseChanges($"Delete profile {id}");
                    return Results.NoContent();
                }
            });

            // ==========================================
            // SIGN IN ENDPOINT
            // ==========================================

            app.MapPost("/api/Profiles/signup", (JsonObject request) =>
            {
                if (request["username"] is not JsonValue usernameValue ||
                    !usernameValue.TryGetValue<string>(out var username) ||
                    string.IsNullOrWhiteSpace(username) ||
                    username.Length > 50)
                {
                    return Results.BadRequest(new { error = "Username is required and must be 50 characters or less." });
                }

                if (request["displayname"] is not JsonValue displayNameValue ||
                    !displayNameValue.TryGetValue<string>(out var displayName) ||
                    string.IsNullOrWhiteSpace(displayName) ||
                    displayName.Length > 100)
                {
                    return Results.BadRequest(new { error = "Display name is required and must be 100 characters or less." });
                }

                if (request["password"] is not JsonValue passwordValue ||
                    !passwordValue.TryGetValue<string>(out var password) ||
                    string.IsNullOrWhiteSpace(password) ||
                    password.Length < 8)
                {
                    return Results.BadRequest(new { error = "Password is required and must be at least 8 characters long." });
                }

                string phoneNumber = "";
                if (request["phone-number"] is JsonNode phoneNode)
                {
                    if (phoneNode is not JsonValue phoneValue ||
                        !phoneValue.TryGetValue<string>(out phoneNumber) ||
                        phoneNumber.Length > 30)
                    {
                        return Results.BadRequest(new { error = "Phone number must be a non-empty string and no more than 30 characters." });
                    }
                }

                lock (databaseWriteLock)
                {
                    var profiles = GetDataFromDirectory(GetCollectionDirectory("Profiles"))
                        .OfType<JsonObject>()
                        .ToList();

                    bool usernameExists = profiles.Any(p =>
                        p["username"] is JsonValue value &&
                        value.TryGetValue<string>(out var existingUsername) &&
                        string.Equals(existingUsername, username.Trim(), StringComparison.OrdinalIgnoreCase));

                    if (usernameExists)
                    {
                        return Results.Conflict(new { error = "Username already exists." });
                    }

                    int maxId = profiles
                        .Select(profile =>
                            profile["id"] is JsonValue idValue &&
                            idValue.TryGetValue<int>(out var id)
                                ? id
                                : 0)
                        .DefaultIfEmpty(0)
                        .Max();

                    if (maxId == int.MaxValue)
                    {
                        return Results.Conflict(new { error = "No profile IDs are available." });
                    }

                    int id = maxId + 1;
                    var profile = new JsonObject
                    {
                        ["id"] = id,
                        ["username"] = username.Trim(),
                        ["displayname"] = displayName.Trim(),
                        ["password"] = password,
                        ["phone-number"] = phoneNumber,
                        ["role"] = "user",
                        ["truckIds"] = new JsonArray()
                    };

                    Database.writeProfilesDatabase($"{id}.json", profile.ToJsonString());
                    PushDatabaseChanges($"Create profile {id}");

                    return Results.Created($"/api/Profiles/{id}", profile);
                }
            });

            // HEALTH CHECK
            // ==========================================

            app.MapGet("/api/health", () => Results.Ok(new { Status = "ok" }));
            app.MapGet("/healthz", () => Results.Ok(new { Status = "ok" }));
            app.MapFallback("/api/{**path}", () => Results.NotFound());
            app.MapFallbackToFile("index.html");

            app.Run();
        }

        private static string GetCollectionDirectory(string collectionName)
        {
            return Path.Combine("localRepoCopy", "Database", collectionName);
        }

        private static bool TryGetDevelopmentOwnerProfileId(HttpContext context, out int profileId)
        {
            profileId = 0;
            if (!int.TryParse(context.Request.Headers["X-Dev-Profile-Id"], out profileId) || profileId <= 0)
            {
                return false;
            }

            JsonObject? profile = Database.getProfileDatabase(profileId);
            return profile?["role"] is JsonValue roleValue &&
                roleValue.TryGetValue<string>(out var profileRole) &&
                string.Equals(profileRole, "owner", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsTruckLinkedToProfile(JsonObject truck, int profileId, int truckId)
        {
            if (truck["profileIds"] is not JsonArray truckProfileIds || !ContainsId(truckProfileIds, profileId))
            {
                return false;
            }

            JsonObject? profile = Database.getProfileDatabase(profileId);
            return profile?["role"] is JsonValue roleValue &&
                roleValue.TryGetValue<string>(out var profileRole) &&
                string.Equals(profileRole, "owner", StringComparison.OrdinalIgnoreCase) &&
                profile["truckIds"] is JsonArray profileTruckIds &&
                ContainsId(profileTruckIds, truckId);
        }

        private static bool ContainsId(JsonArray values, int id)
        {
            return values.Any(value =>
                value is JsonValue jsonValue &&
                jsonValue.TryGetValue<int>(out var valueId) &&
                valueId == id);
        }

        private static List<object> GetDataFromDirectory(string folderPath)
        {
            var list = new List<object>();
            var di = new DirectoryInfo(folderPath);

            if (!di.Exists) return list;

            foreach (FileInfo file in di.GetFiles("*.json"))
            {
                if (file.Name.Equals("template.json", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var record = JsonNode.Parse(File.ReadAllText(file.FullName));
                if (record is not null)
                {
                    list.Add(record);
                }
            }

            return list;
        }

        private static void PushDatabaseChanges(string commitMessage)
        {
            string token = Environment.GetEnvironmentVariable("API_PRIVATE_KEY")
                ?? throw new InvalidOperationException("API_PRIVATE_KEY is not configured.");
            if (string.IsNullOrWhiteSpace(token))
            {
                throw new InvalidOperationException("API_PRIVATE_KEY is not configured.");
            }

            Database.pushGitDatabase(commitMessage, "octowalrus", token);
        }
    }
}
