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
