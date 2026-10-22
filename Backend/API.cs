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
        public static void startAPI(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);
            var app = builder.Build();

            // Endpoint to get all trucks.
            app.MapGet("/api/Trucks", () =>
            {
                var data = GetDataFromDirectory("localRepoCopy\\Database\\Trucks");
                return Results.Ok(new { Data = data, Status = "Success", Timestamp = DateTime.UtcNow });
            });

            // Endpoint to get a truck by Id. Fauls gracefully if truck data is invalid
            app.MapGet("/api/Trucks/{id:int}", (int id) =>
            {
                var truck = GetDataFromDirectory("localRepoCopy\\Database\\Trucks")
                    .OfType<JsonObject>()
                    .FirstOrDefault(record => record["id"]?.GetValue<int>() == id);

                if (truck is null)
                {
                    return Results.NotFound();
                }

                return Results.Ok(truck);
            });

            // Endpoint to add a new truck. Fails gracefully if Id already exists
            app.MapPost("/api/Trucks", (JsonObject truck) =>
            {
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

                var existingTruck = GetDataFromDirectory("localRepoCopy\\Database\\Trucks")
                    .OfType<JsonObject>()
                    .Any(record =>
                        record["id"] is JsonValue recordId &&
                        recordId.TryGetValue<int>(out var existingId) &&
                        existingId == id);

                if (existingTruck)
                {
                    return Results.Conflict(new { error = $"Truck id {id} already exists." });
                }

                var filePath = Path.Combine(
                    "localRepoCopy",
                    "Database",
                    "Trucks",
                    $"{id}.json");

                File.WriteAllText(
                    filePath,
                    truck.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));

                return Results.Created($"/api/Trucks/{id}", truck);
            });

            // Endpoint to edit an existing truck
            app.MapPut("/api/Trucks/{id:int}", (int id, JsonObject updatedTruck) =>
            {
                var trucksDirectory = Path.Combine("localRepoCopy", "Database", "Trucks");
                var existingTruck = GetDataFromDirectory(trucksDirectory)
                    .OfType<JsonObject>()
                    .FirstOrDefault(record =>
                        record["id"] is JsonValue idValue &&
                        idValue.TryGetValue<int>(out var existingId) &&
                        existingId == id);

                if (existingTruck is null)
                {
                    return Results.NotFound();
                }

                if (updatedTruck["id"] is not JsonValue updatedIdValue ||
                    !updatedIdValue.TryGetValue<int>(out var updatedId) ||
                    updatedId != id ||
                    updatedTruck["truckname"] is not JsonValue nameValue ||
                    !nameValue.TryGetValue<string>(out var truckName) ||
                    string.IsNullOrWhiteSpace(truckName) ||
                    updatedTruck["tags"] is not JsonArray tags ||
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

                var filePath = Path.Combine(trucksDirectory, $"{id}.json");
                File.WriteAllText(
                    filePath,
                    updatedTruck.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));

                return Results.Ok(updatedTruck);
            });

            // Endpoint to Delete a truck
            app.MapDelete("/api/Trucks/{id:int}", (int id) =>
            {
                var trucksDirectory = Path.Combine("localRepoCopy", "Database", "Trucks");
                var existingTruck = GetDataFromDirectory(trucksDirectory)
                    .OfType<JsonObject>()
                    .FirstOrDefault(record =>
                        record["id"] is JsonValue idValue &&
                        idValue.TryGetValue<int>(out var existingId) &&
                        existingId == id);

                if (existingTruck is null)
                {
                    return Results.NotFound();
                }

                if ((existingTruck["profileIds"] as JsonArray)?.Count > 0 ||
                    (existingTruck["scheduleIds"] as JsonArray)?.Count > 0)
                {
                    return Results.Conflict(new
                    {
                        error = "Cannot delete a truck while it has profile or schedule links."
                    });
                }

                var filePath = Path.Combine(trucksDirectory, $"{id}.json");
                File.Delete(filePath);

                return Results.NoContent();
            });

            // Endpoint to get all schedules
            app.MapGet("/api/Schedules", () =>
            {
                var data = GetDataFromDirectory("localRepoCopy\\Database\\Schedules");
                return Results.Ok(new { Data = data, Status = "Success", Timestamp = DateTime.UtcNow });
            });

            // Endpoint to get all profiles
            app.MapGet("/api/Profiles", () =>
            {
                var data = GetDataFromDirectory("localRepoCopy\\Database\\Profiles");
                return Results.Ok(new { Data = data, Status = "Success", Timestamp = DateTime.UtcNow });
            });

            // Endpoint to just check the status of the API
            app.MapGet("/api/health", () =>
            {
                return Results.Ok(new { Status = "ok" });
            });

            app.Run();
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
    }
}