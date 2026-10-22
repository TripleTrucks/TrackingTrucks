using System;
using DotNetEnv;

namespace Backend
{
    internal class Program
    {
        static void Main(string[] args)
        {
            DotNetEnv.Env.TraversePath().Load();
            Database.clearFolder("localRepoCopy");
            Database.pullGitDatabase();
            API.startAPI(args);
        }
    }
}