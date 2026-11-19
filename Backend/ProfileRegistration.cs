using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Backend;

public sealed record ProfileRegistration(string Username, string DisplayName, string Password, string PhoneNumber)
{
    public static bool TryRead(JsonObject request, out ProfileRegistration registration, out string error)
    {
        registration = null!;
        error = "";
        string? username = ReadString(request, "username")?.Trim();
        string? displayName = ReadString(request, "displayname")?.Trim();
        string? password = ReadString(request, "password");
        string? confirmation = ReadString(request, "confirm-password");
        string? phone = request.ContainsKey("phone-number") ? ReadString(request, "phone-number")?.Trim() : "";

        if (string.IsNullOrEmpty(username) || username.Length > 50 ||
            !Regex.IsMatch(username, @"\A[A-Za-z0-9._@+\-]+\z"))
            error = "Username must be 1–50 characters: letters, numbers, or . _ @ + -";
        else if (string.IsNullOrEmpty(displayName) || displayName.Length > 100 || displayName.Any(char.IsControl))
            error = "Enter a display name of 1–100 characters without control characters.";
        else if (string.IsNullOrWhiteSpace(password) || password.Length < 8 || password.Length > 1024)
            error = "Password must be between 8 and 1024 characters.";
        else if (confirmation != password)
            error = "Your passwords don’t match.";
        else if (phone is null || phone.Length > 30 || (phone.Length > 0 &&
            (!Regex.IsMatch(phone, @"\A[0-9+(). \-]+\z") || phone.Count(char.IsAsciiDigit) is < 7 or > 15)))
            error = "Enter a phone number with 7–15 digits, or leave it blank.";
        else
        {
            registration = new ProfileRegistration(username, displayName, password, phone);
            return true;
        }
        return false;
    }

    private static string? ReadString(JsonObject request, string key) =>
        request[key] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
}
