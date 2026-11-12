# TrackingTrucks

Start with the [environment setup guide](setup/README.md) for Windows and Linux
installation commands, optional Docker setup, and running the website.

For server deployment, Jenkins, registry and GitHub Actions setup, see the [DevOps guide](devops/README.md).

## Run the full app

```bash
npm ci
npm run dev
```

`dev` starts Vite and the backend together; Ctrl+C stops both. The npm commands
find .NET 8 or install its SDK and ASP.NET runtime into `~/.dotnet8` using
Microsoft's installer. No system package changes are needed. Installation needs
internet access and the OS native dependencies for .NET (included in Jenkins's
Debian build image).

For a compiled app:

```bash
npm run build
npm start
```

`build` checks TypeScript, bundles the frontend and publishes the backend into
`build/app`, then exits. `start` serves both at `http://127.0.0.1:5173` with
ASP.NET Core. Set `ASPNETCORE_URLS` to change the bind address. `start` defaults
to Production; the existing development-only role headers are enabled only by
`npm run dev` (or an explicit `ASPNETCORE_ENVIRONMENT=Development`).

## Frontend routes

Page views and their styles live in `app/routes`, with the route table in
`app/routes/index.tsx`. `app/src/App.tsx` provides the shared navbar for every
page; reusable components and API clients remain in `app/src`.

- `/`: truck map and directory.
- `/schedules`: schedule management.
- `/trucks/new` and `/trucks/:id/edit`: truck creation and editing.
- `/signin`: operator registration, posting to `/api/Profiles/signup` with a
  display name, username, password, `confirm-password`, and optional phone number.
- `/login`: username/password login through `/api/auth/login`.

Registration follows the existing API contract, which creates a profile with
the `user` role; it does not grant owner permissions or start a login session.
After registration, select **Log in**. Successful login returns to the map;
the navbar shows the account name and **Log out**. Sessions use an HttpOnly
cookie with eight-hour tickets and require HTTPS outside Development.

`GET /api/auth/session` restores the current account and
`POST /api/auth/logout` clears the browser session. Authentication POST requests
must include `X-Requested-With: TrackingTrucks`; the frontend API client sends
this automatically. Login and signup share a limit of 20 requests per minute
per connecting IP.

New registrations store password hashes. Existing plaintext records are
upgraded on successful login, and profile API responses omit credentials and
phone numbers. This does not remove old plaintext values from Git history.

Signup validates all fields before writing: a 1–50 character username using
letters, digits, `. _ @ + -`; a 1–100 character display name; an 8–1024 character
password with matching confirmation; and, when provided, a phone number with
7–15 digits. Duplicate usernames are rejected case-insensitively. Invalid
requests create no profile. A failed save returns an error and removes the
new profile file so the signup can be retried.

## Database location

With `npm run dev`, the backend reads and writes this checkout's `Database`
directory. A successful signup creates `Database/Profiles/<id>.json`, and login
reads that same file. Accounts remain available after restarting the backend.
Local development does not clone, push, or require Git credentials.

Set `TRACKINGTRUCKS_DATABASE_PATH` to an absolute database-directory path to use
another local directory or a persistent volume. Relative paths are resolved
against the backend's content root. All collections use that directory.

Production without this setting retains the existing Git-backed storage:
`localRepoCopy/Database` from the database repository's `main` branch. Writes
and legacy-password upgrades in that mode require `API_PRIVATE_KEY` with write
access. Use HTTPS for production cookie sessions.

Run frontend API tests with `npm test`. Run the isolated backend authentication
checks with `dotnet run --project tests/Backend.Integration/Backend.Integration.csproj`
(use `~/.dotnet8/dotnet` if .NET is not on PATH). These checks use temporary
records, including failed-save and restart scenarios; they do not clone or
push the live database.

## Geocode schedule locations

Schedule addresses can be geocoded once and saved as latitude/longitude values
in their schedule JSON files. The map reads those saved coordinates; the
Geoapify key is not included in the website bundle.

1. Rotate any Geoapify key shared in chat or committed to source control.
2. Copy `.env.example` to `.env` and set `GEOAPIFY_API_KEY` to the new key.
   `.env` is ignored by Git.
3. Run `npm run geocode:schedules` from the repository root.

The script skips the schedule template, skips records whose address and saved
coordinates have not changed, and respects Geoapify's advertised five
requests-per-second limit. It geocodes only schedules with address components.
The map displays OpenStreetMap and Geoapify attribution as required.

## Manage schedules

Open **Schedules** in the website navigation to edit upcoming weekly
hours. Each save records the previous schedule version in its `history` array
and writes the UTC time of the change to `last-revised`. The schedule sidebar
shows the latest recorded revision time.

Use **Specific date exceptions** to override weekly hours for a single date.
Give each exception a title to identify its purpose. An exception with no
hours closes the truck for that date; add hours to make a special opening
instead. Exceptions can be set to **One time**, **Monthly** (the same day of
each month), or **Yearly** (the same month and day each year). They are stored
in the schedule's `dateExceptions` array and are included in schedule revision
history.

The website loads profiles, trucks, and schedules through the .NET API; it does
not load database JSON files directly. See **Database location** above for local
and production storage behavior.
Run `npm run dev` to start both Vite and the .NET backend. Vite
forwards `/api` requests to the backend's HTTP port (`62926`). Set
`API_PROXY_TARGET` in `.env` if the API is running at a different address.
Schedule updates use the same configured database directory as profiles.

## Show driving routes

The truck detail panel can request a driving route from 325 Treasure Lane,
Johnson City, TN 37614 to a scheduled truck location. Routes are requested only
when someone selects **Show driving route**.

Set `VITE_GEOAPIFY_API_KEY` in the root `.env` file to a Geoapify key with the
Routing API enabled. Vite embeds `VITE_` variables in the client bundle, so this
key is visible to website users; restrict it in Geoapify to the Routing API and
the app's allowed development/production referrers. Do not reuse a secret
server-side key without applying those restrictions. Restart Vite after editing
`.env`.

The route is drawn over the existing OpenStreetMap map, which already displays
OpenStreetMap and Geoapify attribution. The truck details show Geoapify's
estimated driving distance in miles. Routing requests consume credits based on
the route's waypoints and distance; see Geoapify's
[Routing API documentation](https://apidocs.geoapify.com/docs/routing/) and
[pricing details](https://www.geoapify.com/pricing-details/).
