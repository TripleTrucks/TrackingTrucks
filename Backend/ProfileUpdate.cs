using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Backend;

/// <summary>Profile fields and identifiers visible to the authenticated profile owner.</summary>
public sealed record OwnProfileResponse(
    int Id,
    string Username,
    [property: JsonPropertyName("displayname")] string DisplayName,
    [property: JsonPropertyName("phone-number")] string PhoneNumber,
    string Role,
    int[] TruckIds);

/// <summary>Editable profile values and the current password required to authorize a change.</summary>
public sealed record UpdateOwnProfileRequest
{
    public string? CurrentPassword { get; init; }
    public string? Username { get; init; }
    [JsonPropertyName("displayname")]
    public string? DisplayName { get; init; }
    [JsonPropertyName("phone-number")]
    public string? PhoneNumber { get; init; }
    [JsonPropertyName("new-password")]
    public string? NewPassword { get; init; }
    [JsonPropertyName("confirm-new-password")]
    public string? ConfirmNewPassword { get; init; }
    public string? Role { get; init; }
}

public sealed record NormalizedProfileUpdate(
    string CurrentPassword,
    string Username,
    string DisplayName,
    string PhoneNumber,
    string? NewPassword,
    string Role);

public static class ProfileUpdateValidation
{
    public static bool TryNormalize(
        UpdateOwnProfileRequest request,
        out NormalizedProfileUpdate update,
        out string error)
    {
        update = null!;
        error = "";

        var currentPassword = request.CurrentPassword;
        var username = request.Username?.Trim();
        var displayName = request.DisplayName?.Trim();
        var phoneNumber = request.PhoneNumber?.Trim();
        var newPassword = request.NewPassword;
        var confirmNewPassword = request.ConfirmNewPassword;
        var role = request.Role?.Trim().ToLowerInvariant();

        if (string.IsNullOrWhiteSpace(currentPassword) || currentPassword.Length > 1024)
            error = "Enter your current password to confirm these changes.";
        else if (string.IsNullOrEmpty(username) || username.Length > 50 ||
            !Regex.IsMatch(username, @"\A[A-Za-z0-9._@+\-]+\z"))
            error = "Username must be 1–50 characters: letters, numbers, or . _ @ + -";
        else if (string.IsNullOrEmpty(displayName) || displayName.Length > 100 || displayName.Any(char.IsControl))
            error = "Enter a display name of 1–100 characters without control characters.";
        else if (phoneNumber is null || phoneNumber.Length > 30 || (phoneNumber.Length > 0 &&
            (!Regex.IsMatch(phoneNumber, @"\A[0-9+(). \-]+\z") || phoneNumber.Count(char.IsAsciiDigit) is < 7 or > 15)))
            error = "Enter a phone number with 7–15 digits, or leave it blank.";
        else if (newPassword != confirmNewPassword)
            error = "Your new passwords don’t match.";
        else if (!string.IsNullOrEmpty(newPassword) &&
            (string.IsNullOrWhiteSpace(newPassword) || newPassword.Length < 8 || newPassword.Length > 1024))
            error = "A new password must be between 8 and 1024 characters.";
        else if (role is not ("user" or "owner" or "admin"))
            error = "Choose a valid profile role.";
        else
        {
            update = new NormalizedProfileUpdate(
                currentPassword,
                username,
                displayName,
                phoneNumber,
                string.IsNullOrEmpty(newPassword) ? null : newPassword,
                role);
            return true;
        }

        return false;
    }
}
