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
        public static void startAPI()
        {
            var builder = WebApplication.CreateBuilder();
            var app = builder.Build();

            app.MapGet("/api/Trucks", () =>
            {
                var data = GetDataFromDirectory("localRepoCopy\\Database\\Trucks");
                return Results.Ok(new { Data = data, Status = "Success", Timestamp = DateTime.UtcNow });
            });

            app.MapGet("/api/Schedules", () =>
            {
                var data = GetDataFromDirectory("localRepoCopy\\Database\\Schedules");
                return Results.Ok(new { Data = data, Status = "Success", Timestamp = DateTime.UtcNow });
            });

            app.MapGet("/api/Profiles", () =>
            {
                var data = GetDataFromDirectory("localRepoCopy\\Database\\Profiles");
                return Results.Ok(new { Data = data, Status = "Success", Timestamp = DateTime.UtcNow });
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