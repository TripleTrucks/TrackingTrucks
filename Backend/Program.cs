using System;
using System.IO;
using DotNetEnv;
using Microsoft.Data.Sqlite;
using LibGit2Sharp;

namespace Backend
{
    internal class Program
    {
        static string connectionString = "Data Source=app.db";

        static void Main(string[] args)
        {
            string apiKey = "";
            DotNetEnv.Env.TraversePath().Load();
            apiKey = Environment.GetEnvironmentVariable("API_PRIVATE_KEY");
            Database.clearFolder("localRepoCopy");
            Database.pullGitDatabase();
            API.startAPI(args);
            Database.parseProfilesDatabase();
            Database.parseSchedulesDatabase();
            Console.Write("Would you like to add Profile(1) or Schedule(2)? Please enter 1 or 2: ");
            int input = Convert.ToInt32(Console.ReadLine());
            if (input == 1)
            {
                Console.WriteLine("Please input profile name:");
                string profileName = Console.ReadLine();
                Console.WriteLine("Please input profile json:");
                string jsonInput = Console.ReadLine();
                Database.writeProfilesDatabase(profileName, jsonInput);
            }
            if (input == 2)
            {
                Console.WriteLine("Please input schedule name:");
                string scheduleName = Console.ReadLine();
                Console.WriteLine("Please input schedule json:");
                string jsonInput = Console.ReadLine();
                Database.writeSchedulesDatabase(scheduleName, jsonInput);
            }
            Database.pushGitDatabase("Backend Automated Commit", "octowalrus", apiKey);
            Database.clearFolder("..\\localRepoCopy");
        }
    }
}