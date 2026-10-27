using LibGit2Sharp;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.IO;
using System.Dynamic;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Backend
{
    public class Database
    {
        static Dictionary<string, string> databaseProfileVars = new Dictionary<string, string>();
        static Dictionary<string, string> databaseSchedulesVars = new Dictionary<string, string>();
        static Dictionary<string, string> databaseTrucksVars = new Dictionary<string, string>();

        public static void parseProfilesDatabase()
        {
            DirectoryInfo di = new DirectoryInfo(GetCollectionDirectory("Profiles"));
            foreach (FileInfo file in di.GetFiles())
            {
                string jsonString = File.ReadAllText(file.FullName);
                Console.WriteLine(jsonString);
            }
        }

        public static void parseSchedulesDatabase()
        {
            DirectoryInfo di = new DirectoryInfo(GetCollectionDirectory("Schedules"));
            foreach (FileInfo file in di.GetFiles())
            {
                string jsonString = File.ReadAllText(file.FullName);
                Console.WriteLine(jsonString);
            }
        }

        public static void parseTrucksDatabase()
        {
            DirectoryInfo di = new DirectoryInfo(GetCollectionDirectory("Trucks"));
            foreach (FileInfo file in di.GetFiles())
            {
                string jsonString = File.ReadAllText(file.FullName);
                Console.WriteLine(jsonString);
            }
        }
        public static void writeProfilesDatabase(string fileName, string json)
        {
            WriteDatabaseRecord("Profiles", fileName, json);
        }

        public static void writeSchedulesDatabase(string fileName, string json)
        {
            WriteDatabaseRecord("Schedules", fileName, json);
        }

        public static void writeTrucksDatabase(string fileName, string json)
        {
            WriteDatabaseRecord("Trucks", fileName, json);
        }

        public static JsonObject? getProfileDatabase(int profileId)
        {
            return FindRecord("Profiles", profileId)?.Record;
        }

        public static void addTruckToProfileDatabase(int profileId, int truckId)
        {
            var profile = FindRecord("Profiles", profileId)
                ?? throw new FileNotFoundException($"Profile {profileId} was not found.");

            if (profile.Record["truckIds"] is not JsonArray truckIds)
            {
                throw new InvalidDataException($"Profile {profileId} has no valid truckIds array.");
            }

            if (!ContainsId(truckIds, truckId))
            {
                truckIds.Add(truckId);
                WriteDatabaseRecord("Profiles", profile.FileName, profile.Record.ToJsonString());
            }
        }

        public static void removeTruckLinksDatabase(int truckId)
        {
            RemoveTruckLinksFromCollection("Profiles", truckId);
            RemoveTruckLinksFromCollection("Schedules", truckId);
        }

        public static void deleteTrucksDatabase(string fileName)
        {
            string filePath = GetDatabaseRecordPath("Trucks", fileName);
            if (!File.Exists(filePath))
            {
                throw new FileNotFoundException("Truck record was not found.", filePath);
            }

            File.Delete(filePath);
        }

        private static (string FileName, JsonObject Record)? FindRecord(string collectionName, int id)
        {
            string directory = GetCollectionDirectory(collectionName);
            if (!Directory.Exists(directory))
            {
                return null;
            }

            (string FileName, JsonObject Record)? match = null;
            foreach (string path in Directory.EnumerateFiles(directory, "*.json"))
            {
                if (Path.GetFileName(path).Equals("template.json", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                JsonNode? node = JsonNode.Parse(File.ReadAllText(path));
                if (node is not JsonObject record ||
                    record["id"] is not JsonValue recordId ||
                    !recordId.TryGetValue<int>(out int recordIdValue) ||
                    recordIdValue != id)
                {
                    continue;
                }

                if (match.HasValue)
                {
                    throw new InvalidDataException($"Multiple {collectionName} records have id {id}.");
                }

                match = (Path.GetFileName(path), record);
            }

            return match;
        }

        private static bool ContainsId(JsonArray values, int id)
        {
            return values.Any(value =>
                value is JsonValue jsonValue &&
                jsonValue.TryGetValue<int>(out int valueId) &&
                valueId == id);
        }

        private static void RemoveTruckLinksFromCollection(string collectionName, int truckId)
        {
            string directory = GetCollectionDirectory(collectionName);
            if (!Directory.Exists(directory))
            {
                return;
            }

            foreach (string path in Directory.EnumerateFiles(directory, "*.json"))
            {
                if (Path.GetFileName(path).Equals("template.json", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (JsonNode.Parse(File.ReadAllText(path)) is not JsonObject record ||
                    record["truckIds"] is not JsonArray truckIds)
                {
                    continue;
                }

                bool changed = false;
                for (int index = truckIds.Count - 1; index >= 0; index--)
                {
                    if (truckIds[index] is JsonValue value &&
                        value.TryGetValue<int>(out int linkedTruckId) &&
                        linkedTruckId == truckId)
                    {
                        truckIds.RemoveAt(index);
                        changed = true;
                    }
                }

                if (changed)
                {
                    WriteDatabaseRecord(collectionName, Path.GetFileName(path), record.ToJsonString());
                }
            }
        }

        public static void pushGitDatabase(string commitMessage, string username, string token)
        {
            string localPath = "localRepoCopy";
            string targetBranch = "development";
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

        private static string GetCollectionDirectory(string collectionName)
        {
            return Path.Combine("localRepoCopy", "Database", collectionName);
        }

        private static string GetDatabaseRecordPath(string collectionName, string fileName)
        {
            if (string.IsNullOrWhiteSpace(fileName) ||
                fileName != Path.GetFileName(fileName) ||
                fileName is "." or "..")
            {
                throw new ArgumentException("A record file name is required.", nameof(fileName));
            }

            return Path.Combine(GetCollectionDirectory(collectionName), fileName);
        }

        private static void WriteDatabaseRecord(string collectionName, string fileName, string json)
        {
            var record = JsonNode.Parse(json)
                ?? throw new JsonException("A database record cannot be JSON null.");
            string filePath = GetDatabaseRecordPath(collectionName, fileName);
            Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);
            File.WriteAllText(
                filePath,
                record.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
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
            string repoUrl = "https://github.com/TripleTrucks/TrackingTrucks.git";
            string localPath = "localRepoCopy";
            string targetBranch = "development";
            var cloneOptions = new CloneOptions
            {
                BranchName = targetBranch
            };
            // Clone the specific branch
            Repository.Clone(repoUrl, localPath, cloneOptions);
            Console.WriteLine($"Repository cloned successfully on branch '{targetBranch}'!");
        }
    }
}
