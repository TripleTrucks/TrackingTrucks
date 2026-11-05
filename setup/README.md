# Environment setup

These scripts prepare your computer to work on TrackingTrucks. They install
React, TypeScript, Vite, Electron, .NET 8 SDK/runtime, and their development dependencies. Node 24 or
newer is required. Docker is optional.

Run the commands below from the **TrackingTrucks repository folder**. You need
Internet access. The scripts update the repository's `package.json`, lockfile,
`.nvmrc`, and `.gitignore`; review those changes before committing.

## Windows (PowerShell)

Open your local repository in VS Code and open a PowerShell terminal:

```powershell
cd G:\fall2026\TrackingTrucks
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup\setup-environment.ps1
```

Use your own clone's path if it is different. If Node is missing, the script uses
WinGet to install Node LTS. Reopen the terminal if prompted; restart VS Code if
its terminal still sees the old version.

**Already using nvm for Windows?** Activate the repository's Node version first:

```powershell
$projectNodeVersion = (Get-Content .nvmrc).Trim()
nvm install $projectNodeVersion
nvm use $projectNodeVersion
node -v
```

If nvm reports a permissions error, run these nvm commands in an administrator
PowerShell. Then rerun the setup script. Updating npm alone does not update Node.

To also install Docker Desktop:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup\setup-environment.ps1 -InstallDocker
```

Open Docker Desktop afterward to finish its setup. A restart may be required.

## Linux server or WSL (Bash)

Use your Linux terminal. In VS Code Remote SSH, this is the terminal connected
to the server:

```bash
cd ~/TrackingTrucks
bash setup/setup-environment.sh
```

The script uses nvm to install or switch Node when it is missing or too old.
Follow the activation commands printed at the end to use that Node version in
your current terminal. Run the script as your normal user, not with `sudo`.

If it reports that curl is missing on Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates
bash setup/setup-environment.sh
```

To also install Docker Engine on Ubuntu:

```bash
bash setup/setup-environment.sh --install-docker
```

It requests sudo when needed and keeps an existing Docker installation. Docker
commands may require `sudo` depending on your user's permissions. The Bash script
also supports Node/dependency setup on macOS, but Docker installation is Ubuntu-only.

## Run the website

From the repository root on Windows:

```powershell
npm.cmd run dev
```

On Linux/macOS:

```bash
npm run dev
```

Open the URL printed in the terminal. Vite and the backend start together. Stop both with **Ctrl+C**.
When running on the remote Linux server, forward the printed port through VS
Code's **Ports** tab to open it in your local browser.

To build and preview on Windows:

```powershell
npm.cmd run build
npm.cmd start
```

On Linux/macOS, use `npm` instead of `npm.cmd`. The production build goes into
`build/app/` (including the frontend in `wwwroot/`). `npm start` serves the full app on port 5173.

## After pulling changes

Use the Node version recorded in `.nvmrc`, then run `npm ci` (`npm.cmd ci` on
Windows) to install the exact versions from the lockfile. You do not need to rerun
the setup script for everyday development.

Commit the setup files and intended changes to `package.json`,
`package-lock.json`, `.nvmrc`, and `.gitignore`. Do not commit `node_modules` or
secrets. Each computer installs its own dependencies; do not copy Windows
`node_modules` onto Linux.
