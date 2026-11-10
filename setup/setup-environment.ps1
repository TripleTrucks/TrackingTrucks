param([switch]$InstallDocker)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

function Invoke-Checked {
    param(
        [string]$Program,
        [string[]]$Arguments
    )
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program failed with exit code $LASTEXITCODE"
    }
}

# Install Node.js LTS, including npm, if needed.
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    Invoke-Checked winget @(
        "install", "--id", "OpenJS.NodeJS.LTS", "--exact",
        "--accept-source-agreements", "--accept-package-agreements"
    )

    $env:Path = (
        [Environment]::GetEnvironmentVariable("Path", "Machine"),
        [Environment]::GetEnvironmentVariable("Path", "User")
    ) -join ";"
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw "Close and reopen PowerShell, then run this script again."
}

$nodeVersion = (& node.exe --version).TrimStart("v")
if ($LASTEXITCODE -ne 0) { throw "Node failed to start." }

$nodeMajor = [int]($nodeVersion.Split(".")[0])
if ($nodeMajor -lt 24) {
    throw "Install current Node.js LTS, reopen PowerShell, and rerun. Current: $nodeVersion"
}

# Preserve an existing package.json.
if (-not (Test-Path package.json)) {
    $package = @{
        name    = "tracking-trucks"
        version = "0.0.0"
        private = $true
        type    = "module"
    } | ConvertTo-Json

    [IO.File]::WriteAllText(
        (Join-Path $PWD "package.json"), $package
    )
}

Invoke-Checked npm.cmd @(
    "install", "--engine-strict", "--save-exact",
    "react", "react-dom"
)

Invoke-Checked npm.cmd @(
    "install", "--engine-strict", "--save-dev", "--save-exact",
    "typescript", "vite", "@vitejs/plugin-react",
    "@types/react", "@types/react-dom", "@types/node@$nodeMajor",
    "electron"
)

# Record the Node version used to generate the lockfile.
[IO.File]::WriteAllText(
    (Join-Path $PWD ".nvmrc"), "$nodeVersion`n"
)

# Keep dependencies, build output, and local secrets out of Git.
if (-not (Test-Path .gitignore)) {
    New-Item .gitignore -ItemType File | Out-Null
}
$existing = @(Get-Content .gitignore)
$missing = @(
    "node_modules/", "dist/", "dist-electron/", "release/",
    ".env", ".env.*", "!.env.example"
) | Where-Object { $_ -notin $existing }

if ($missing) {
    Add-Content .gitignore ("`n" + ($missing -join "`n"))
}

if ($InstallDocker) {
    Invoke-Checked winget @(
        "install", "--id", "Docker.DockerDesktop", "--exact",
        "--accept-source-agreements", "--accept-package-agreements"
    )
}

Invoke-Checked npm.cmd @("run", "setup:backend")
Invoke-Checked npm.cmd @("ls", "--depth=0")
Write-Host "`nDependencies installed. Commit package.json and package-lock.json."
Write-Host "Other developers should install the recorded Node version, then run npm ci."
