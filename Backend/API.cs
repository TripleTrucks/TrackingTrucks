using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Linq;


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
            var app = builder.Build();

            // Endpoint to get all trucks.
            app.MapGet("/api/Trucks", () =>
            {
                var data = GetDataFromDirectory(GetCollectionDirectory("Trucks"));
                return Results.Ok(new { Data = data, Status = "Success", Timestamp = DateTime.UtcNow });
            });

            // Endpoint to get a truck by Id. Fauls gracefully if truck data is invalid
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

            // Endpoint to add a new truck. Fails gracefully if Id already exists
            app.MapPost("/api/Trucks", (HttpContext context, JsonObject truck) =>
            {
                if (!TryGetDevelopmentRole(context, app.Environment, out var role) ||
                    role == "user")
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

                if (truck["id"] is not JsonValue idValue ||
                    !idValue.TryGetValue<int>(out var id) ||
                    id <= 0)
                {
                    return Results.BadRequest(new { error = "A positive int id is required" });
                }

                if (truck["truckname"] is not JsonValue nameValue ||
                    !nameValue.TryGetValue<string>(out var truckname) ||
                    string.IsNullOrWhiteSpace(truckname))
                {
                    return Results.BadRequest(new { error = "A truckname is required" });
                }

                if (truck["tags"] is not JsonArray ||
                    truck["profileIds"] is not JsonArray profileIds ||
                    profileIds.Count != 0 ||
                    truck["scheduleIds"] is not JsonArray scheduleIds ||
                    scheduleIds.Count != 0)
                {
                    return Results.BadRequest(new
                    {
                        error = "For now, tags must be an array and profileIds/scheduleIds must be empty arrays."
                    });
                }

                lock (databaseWriteLock)
                {
                    bool existingTruck = GetDataFromDirectory(GetCollectionDirectory("Trucks"))
                        .OfType<JsonObject>()
                        .Any(record =>
                            record["id"] is JsonValue recordId &&
                            recordId.TryGetValue<int>(out var existingId) &&
                            existingId == id);
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

            // Endpoint to edit an existing truck
            app.MapPut("/api/Trucks/{id:int}", (HttpContext context, int id, JsonObject updatedTruck) =>
            {
                if (!TryGetDevelopmentRole(context, app.Environment, out var role) ||
                    role == "user")
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
                        .FirstOrDefault(record =>
                            record["id"] is JsonValue idValue &&
                            idValue.TryGetValue<int>(out var existingId) &&
                            existingId == id);

                    if (existingTruck is null)
                    {
                        return Results.NotFound();
                    }

                    if (ownerProfileId is int profileId &&
                        !IsTruckLinkedToProfile(existingTruck, profileId, id))
                    {
                        return Results.StatusCode(StatusCodes.Status403Forbidden);
                    }

                    if (updatedTruck["id"] is not JsonValue updatedIdValue ||
                        !updatedIdValue.TryGetValue<int>(out var updatedId) ||
                        updatedId != id ||
                        updatedTruck["truckname"] is not JsonValue nameValue ||
                        !nameValue.TryGetValue<string>(out var truckName) ||
                        string.IsNullOrWhiteSpace(truckName) ||
                        updatedTruck["tags"] is not JsonArray ||
                        updatedTruck["profileIds"] is not JsonArray profileIds ||
                        updatedTruck["scheduleIds"] is not JsonArray scheduleIds)
                    {
                        return Results.BadRequest(new { error = "Invalid truck record" });
                    }

                    if (existingTruck["profileIds"]?.ToJsonString() != profileIds.ToJsonString() ||
                        existingTruck["scheduleIds"]?.ToJsonString() != scheduleIds.ToJsonString())
                    {
                        return Results.BadRequest(new
                        {
                            error = "Changing profileIds or scheduleIds is not supported yet."
                        });
                    }

                    Database.writeTrucksDatabase($"{id}.json", updatedTruck.ToJsonString());
                    PushDatabaseChanges($"Update truck {id}");
                    return Results.Ok(updatedTruck);
                }
            });

            // Endpoint to Delete a truck
            app.MapDelete("/api/Trucks/{id:int}", (HttpContext context, int id) =>
            {
                if (!TryGetDevelopmentRole(context, app.Environment, out var role) ||
                    role == "user")
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
                        .FirstOrDefault(record =>
                            record["id"] is JsonValue idValue &&
                            idValue.TryGetValue<int>(out var existingId) &&
                            existingId == id);

                    if (existingTruck is null)
                    {
                        return Results.NotFound();
                    }

                    if (ownerProfileId is int profileId &&
                        !IsTruckLinkedToProfile(existingTruck, profileId, id))
                    {
                        return Results.StatusCode(StatusCodes.Status403Forbidden);
                    }

                    Database.removeTruckLinksDatabase(id);
                    Database.deleteTrucksDatabase($"{id}.json");
                    PushDatabaseChanges($"Delete truck {id}");
                    return Results.NoContent();
                }
            });

            // Endpoint to get all schedules
            app.MapGet("/api/Schedules", () =>
            {
                var data = GetDataFromDirectory(GetCollectionDirectory("Schedules"));
                return Results.Ok(new { Data = data, Status = "Success", Timestamp = DateTime.UtcNow });
            });

            // Endpoint to get all profiles
            app.MapGet("/api/Profiles", () =>
            {
                var data = GetDataFromDirectory(GetCollectionDirectory("Profiles"));
                return Results.Ok(new { Data = data, Status = "Success", Timestamp = DateTime.UtcNow });
            });

            // Endpoint to just check the status of the API
            app.MapGet("/api/health", () =>
            {
                return Results.Ok(new { Status = "ok" });
            });

            app.Run();
        }

        private static string GetCollectionDirectory(string collectionName)
        {
            return Path.Combine("localRepoCopy", "Database", collectionName);
        }

        private static bool TryGetDevelopmentOwnerProfileId(HttpContext context, out int profileId)
        {
            profileId = 0;
            if (!int.TryParse(context.Request.Headers["X-Dev-Profile-Id"], out profileId) ||
                profileId <= 0)
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
            if (truck["profileIds"] is not JsonArray truckProfileIds ||
                !ContainsId(truckProfileIds, profileId))
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