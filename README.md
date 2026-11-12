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

Open **Manage schedules** in the website navigation to edit upcoming weekly
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
not load database JSON files directly. The backend clones the `main` branch of
`ZenMastering/TrackingTrucks` at startup and serves records from that clone.
Run `npm run dev` to start both Vite and the .NET backend. Vite
forwards `/api` requests to the backend's HTTP port (`62926`). Set
`API_PROXY_TARGET` in `.env` if the API is running at a different address.
Schedule updates are saved to the backend's working clone and pushed to `main`,
so configure `API_PRIVATE_KEY` for the backend before saving.

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
