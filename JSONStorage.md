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

The backend reads profiles, schedules, and trucks from the JSON store. Its
current CRUD endpoints write truck records only. New trucks must have empty
`profileIds` and `scheduleIds`; updates cannot change either relationship list,
and a truck cannot be deleted while it has linked profiles or schedules.
Profiles and schedules are currently read-only through the API.

Truck create, update, and delete requests write through the backend's
`Database` functions and push a commit to the `development` branch. Configure
`API_PRIVATE_KEY` in the backend environment with a GitHub token authorized to
push to that branch. Reads do not require GitHub credentials; a failed push is
reported as an API error rather than a successful remote update.
