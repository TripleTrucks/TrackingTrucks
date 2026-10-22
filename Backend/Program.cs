using System;
using DotNetEnv;

namespace Backend
{
    internal class Program
    {
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
            Console.Write("Would you like to add Profile(1), Schedule(2), or Trucks(3)? Please enter 1, 2, or 3: ");
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
            if (input == 3)
            {
                Console.WriteLine("Please input truck name:");
                string truckName = Console.ReadLine();
                Console.WriteLine("Please input truck json:");
                string jsonInput = Console.ReadLine();
                Database.writeTrucksDatabase(truckName, jsonInput);
            }
            Database.pushGitDatabase("Backend Automated Commit", "octowalrus", apiKey);
            Database.clearFolder("..\\localRepoCopy");
        }
    }
}
