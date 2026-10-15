# JSON storage

The `Database` directory stores JSON records in `Profiles`, `Trucks`, and
`Schedules`.

- A profile's `truckIds` lists the trucks associated with that profile.
- A profile with the `owner` role has a `displayname`; profiles with other
  roles may omit `displayname`.
- Profile roles are limited to `owner`, `admin`, `employee`, and `customer`.
  JSON stores these enum values as lowercase strings.
- A truck's `profileIds` and `scheduleIds` list its associated profiles and
  schedules.
- A schedule's `truckIds` lists the trucks that use that schedule.

These ID arrays represent many-to-many relationships. Keep the references on
both sides in sync when adding or removing a relationship. IDs must be unique
within each record type.

The current backend reads and writes profile and schedule files only; Truck
file handling and relationship validation still need to be added there.
