# TrackingTrucks

Start with the [environment setup guide](setup/README.md) for Windows and Linux
installation commands, optional Docker setup, and running the website.

For server deployment, Jenkins, registry and GitHub Actions setup, see the [DevOps guide](devops/README.md).

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
