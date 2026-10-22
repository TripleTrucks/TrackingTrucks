using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;


namespace Backend
{
    public class API
    {
        public record scheduleFields(int id, string truckIds, string lastRevised, string location, string monday, string tuesday, string wednesday, string thursday, string friday, string saturday, string sunday);
        public record profileFields(int id, string username, string password, string displayname, string phoneNumber, string role, string truckIDs);
        public record truckFields(int id, string truckName, string tags, string profileIds, string scheduleIds);
        public static void startAPI()
        {
            var builder = WebApplication.CreateBuilder();
            var app = builder.Build();

            app.MapGet("/api/Trucks.json", () =>
            {
                var data = GetDataFromDirectory("localRepoCopy\\Database\\Trucks");
                return Results.Ok(new { Data = data, Status = "Success", Timestamp = DateTime.UtcNow });
            });

            app.MapGet("/api/Schedules.json", () =>
            {
                var data = GetDataFromDirectory("localRepoCopy\\Database\\Schedules");
                return Results.Ok(new { Data = data, Status = "Success", Timestamp = DateTime.UtcNow });
            });

            app.MapGet("/api/Profiles.json", () =>
            {
                var data = GetDataFromDirectory("localRepoCopy\\Database\\Profiles");
                return Results.Ok(new { Data = data, Status = "Success", Timestamp = DateTime.UtcNow });
            });

            app.MapPost("/api/TrucksAdd", (string truckString) =>
            {
                // Validate or handle your data here
                if (truckString == null)
                {
                    return Results.BadRequest(new { Status = "Error", Message = "Invalid profile data." });
                }

                var truckJSON = JsonSerializer.Deserialize<scheduleFields>(truckString);

                if (truckJSON.id == null || truckJSON.id == 0)
                {
                    return Results.BadRequest(new { Status = "Error", Message = "Invalid profile data." });
                }

                Database.writeProfilesDatabase(truckJSON.id.ToString(), truckString);

                // Return a 201 Created response with the result
                return Results.Created($"/api/truck.json", new
                {
                    Data = truckString,
                    Status = "Success",
                    Timestamp = DateTime.UtcNow
                });
            });

            app.MapPost("/api/ProfilesAdd", (string profileString) =>
            {
                // Validate or handle your data here
                if (profileString == null)
                {
                    return Results.BadRequest(new { Status = "Error", Message = "Invalid profile data." });
                }

                var profileJSON = JsonSerializer.Deserialize<scheduleFields>(profileString);

                if (profileJSON.id == null || profileJSON.id == 0)
                {
                    return Results.BadRequest(new { Status = "Error", Message = "Invalid profile data." });
                }

                Database.writeProfilesDatabase(profileJSON.id.ToString(), profileString);

                // Return a 201 Created response with the result
                return Results.Created($"/api/profile.json", new
                {
                    Data = profileString,
                    Status = "Success",
                    Timestamp = DateTime.UtcNow
                });
            });

            app.MapPost("/api/SchedulesAdd", (string scheduleString) =>
            {
                // Validate or handle your data here
                if (scheduleString == null)
                {
                    return Results.BadRequest(new { Status = "Error", Message = "Invalid profile data." });
                }
                
                var scheduleJSON = JsonSerializer.Deserialize<scheduleFields>(scheduleString);

                if (scheduleJSON.id == null || scheduleJSON.id == 0)
                {
                    return Results.BadRequest(new { Status = "Error", Message = "Invalid profile data." });
                }

                Database.writeProfilesDatabase(scheduleJSON.id.ToString(), scheduleString);

                // Return a 201 Created response with the result
                return Results.Created($"/api/schedule.json", new
                {
                    Data = scheduleString,
                    Status = "Success",
                    Timestamp = DateTime.UtcNow
                });
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
                string jsonString = File.ReadAllText(file.FullName);

                using var doc = JsonDocument.Parse(jsonString);
                list.Add(JsonSerializer.Deserialize<object>(doc.RootElement.GetRawText()));
            }

            return list;
        }
    }
}