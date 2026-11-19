using Microsoft.AspNetCore.Identity;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace Backend;

public static class ProfilePasswords
{
    private static readonly PasswordHasher<JsonObject> Hasher = new();

    public static string Hash(JsonObject profile, string password) => Hasher.HashPassword(profile, password);

    public static bool Verify(JsonObject profile, string password, out bool needsUpgrade)
    {
        needsUpgrade = false;
        if (profile["password-hash"] is JsonValue hashValue && hashValue.TryGetValue<string>(out var hash))
        {
            try
            {
                var result = Hasher.VerifyHashedPassword(profile, hash, password);
                needsUpgrade = result == PasswordVerificationResult.SuccessRehashNeeded;
                return result != PasswordVerificationResult.Failed;
            }
            catch (FormatException)
            {
                return false;
            }
        }

        // Existing records are migrated after a successful login.
        if (profile["password"] is not JsonValue value || !value.TryGetValue<string>(out var legacy))
            return false;
        needsUpgrade = CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(legacy)),
            SHA256.HashData(Encoding.UTF8.GetBytes(password)));
        return needsUpgrade;
    }
}
