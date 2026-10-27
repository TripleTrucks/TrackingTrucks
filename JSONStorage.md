# JSON storage

The `Database` directory stores JSON records in `Profiles`, `Trucks`, and
`Schedules`.

- A profile's `truckIds` lists the trucks associated with that profile.
- A profile with the `owner` role has a `displayname`; profiles with other
  roles may omit `displayname`.
- Profile roles are `user`, `owner`, or `admin`; JSON stores these values as
  lowercase strings.
- A truck's `profileIds` and `scheduleIds` list its associated profiles and
  schedules.
- A schedule's `truckIds` lists the trucks that use that schedule.

These ID arrays represent many-to-many relationships. Keep the references on
both sides in sync when adding or removing a relationship. IDs must be unique
within each record type.

The backend reads profiles, schedules, and trucks from the JSON store. Truck
create, update, and delete endpoints use the `Database` functions and push
changes to the `development` branch. New trucks must have an empty
`scheduleIds` array. Owner-created trucks are linked to the selected owner
profile by the server; truck/profile references are kept in sync. Updates
cannot change either relationship list. Deleting a truck removes its ID from
linked profile and schedule records.

In Development, set the `X-Dev-Role` request header to `user`, `owner`, or
`admin`. Users may read but not write. Owners may create trucks and update or
delete trucks linked to their profile. Their requests must include
`X-Dev-Profile-Id` with an existing profile whose role is `owner`. Admins may
create, update, and delete any truck. Writes are denied outside Development.
These caller-controlled headers simulate roles for testing and do not
authenticate users; anyone able to reach the development API can claim any
role.

Configure `API_PRIVATE_KEY` in the backend environment with a GitHub token
authorized to push to `development`. Reads do not require GitHub credentials;
a failed push is reported as an API error rather than a successful remote
update.
