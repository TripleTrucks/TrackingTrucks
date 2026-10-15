using LibGit2Sharp;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.IO;
using System.Dynamic;
using System.Text.Json;

namespace Backend
{
    public class Database
    {
        static Dictionary<string, string> databaseProfileVars = new Dictionary<string, string>();
        static Dictionary<string, string> databaseSchedulesVars = new Dictionary<string, string>();
        static Dictionary<string, string> databaseTrucksVars = new Dictionary<string, string>();

        public static void parseProfilesDatabase()
        {
            DirectoryInfo di = new DirectoryInfo("localRepoCopy\\Database\\Profiles");
            foreach (FileInfo file in di.GetFiles())
            {
                string jsonString = File.ReadAllText(file.FullName);
                Console.WriteLine(jsonString);
            }
        }

        public static void parseSchedulesDatabase()
        {
            DirectoryInfo di = new DirectoryInfo("localRepoCopy\\Database\\Schedules");
            foreach (FileInfo file in di.GetFiles())
            {
                string jsonString = File.ReadAllText(file.FullName);
                Console.WriteLine(jsonString);
            }
        }

        public static void parseTrucksDatabase()
        {
            DirectoryInfo di = new DirectoryInfo("localRepoCopy\\Database\\Trucks");
            foreach (FileInfo file in di.GetFiles())
            {
                string jsonString = File.ReadAllText(file.FullName);
                Console.WriteLine(jsonString);
            }
        }
        public static void writeProfilesDatabase(string fileName, string json)
        {
            var options = new JsonSerializerOptions { WriteIndented = true };
            string jsonString = JsonSerializer.Serialize(json);
            File.WriteAllText("localRepoCopy\\Database\\Profiles\\" + fileName, jsonString);
        }

        public static void writeSchedulesDatabase(string fileName, string json)
        {
            var options = new JsonSerializerOptions { WriteIndented = true };
            string jsonString = JsonSerializer.Serialize(json);
            File.WriteAllText("localRepoCopy\\Database\\Schedules\\" + fileName, jsonString);
        }

        public static void writeTrucksDatabase(string fileName, string json)
        {
            var options = new JsonSerializerOptions { WriteIndented = true };
            string jsonString = JsonSerializer.Serialize(json);
            File.WriteAllText("localRepoCopy\\Database\\Trucks\\" + fileName, jsonString);
        }

        public static void pushGitDatabase(string commitMessage, string username, string token)
        {
            string localPath = "localRepoCopy";
            string targetBranch = "octowalrus/Scrum-218";
            try
            {
                using (var repo = new Repository(localPath))
                {
                    // 1. Stage all changes (new, modified, or deleted JSON files)
                    Commands.Stage(repo, "*");

                    // 2. Check if there are actually changes to commit
                    var status = repo.RetrieveStatus();
                    if (!status.IsDirty)
                    {
                        Console.WriteLine("No changes detected to push.");
                        return;
                    }

                    // 3. Create a signature (Author & Committer info)
                    var signature = new Signature("TrackingTrucksBot", "bot@trackingtrucks.local", DateTimeOffset.Now);

                    // 4. Commit changes locally
                    repo.Commit(commitMessage, signature, signature);
                    Console.WriteLine("Changes committed locally.");

                    // 5. Setup remote and push options with authentication
                    Remote remote = repo.Network.Remotes["origin"];

                    var pushOptions = new PushOptions
                    {
                        CredentialsProvider = (url, usernameFromUrl, allowedTypes) =>
                            new UsernamePasswordCredentials
                            {
                                Username = username,
                                Password = token // GitHub Personal Access Token (PAT)
                            }
                    };

                    // 6. Push to the remote branch
                    string pushRefSpec = $@"refs/heads/{targetBranch}";
                    repo.Network.Push(remote, pushRefSpec, pushOptions);

                    Console.WriteLine($"Successfully pushed changes to branch '{targetBranch}'!");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error pushing to repository: {ex.Message}");
            }
        }

        public static void clearFolder(string folderName)
        {
            if (Directory.Exists(folderName))
            {
                DirectoryInfo di = new DirectoryInfo(folderName);

                foreach (FileInfo file in di.EnumerateFiles())
                {
                    file.Delete();
                }
                di = new DirectoryInfo(folderName);

                foreach (FileInfo file in di.GetFiles("*", SearchOption.AllDirectories))
                {
                    try
                    {
                        file.Attributes = FileAttributes.Normal;
                        file.Delete();
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Could not delete file {file.Name}: {ex.Message}");
                    }
                }
                foreach (DirectoryInfo subDir in di.GetDirectories("*", SearchOption.AllDirectories).OrderByDescending(d => d.FullName.Length))
                {
                    try
                    {
                        subDir.Attributes = FileAttributes.Normal;
                        subDir.Delete(true);
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Could not delete directory {subDir.Name}: {ex.Message}");
                    }
                }
            }
        }
        public static void pullGitDatabase()
        {
            string repoUrl = "https://github.com/ZenMastering/TrackingTrucks.git";
            string localPath = "localRepoCopy";
            string targetBranch = "octowalrus/Scrum-218";
            var cloneOptions = new CloneOptions
            {
                BranchName = targetBranch
            };
            try
            {
                // Clone the specific branch
                Repository.Clone(repoUrl, localPath, cloneOptions);
                Console.WriteLine($"Repository cloned successfully on branch '{targetBranch}'!");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error cloning repository: {ex.Message}");
            }
        }
    }
}
