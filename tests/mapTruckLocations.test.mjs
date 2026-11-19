import assert from "node:assert/strict";
import test from "node:test";
import { getTruckLocations } from "../.cache/tests/mapTruckLocations.js";

const trucks = [
  {
    id: 1,
    truckname: "Schedule-linked truck",
    tags: [],
    profileIds: [],
    scheduleIds: [],
  },
  {
    id: 2,
    truckname: "Truck-linked truck",
    tags: [],
    profileIds: [],
    scheduleIds: [10],
  },
];

test("places trucks from schedule assignments and preserves truck assignments", () => {
  const schedules = [
    {
      id: 10,
      truckIds: [1, 1, 999],
      location: { coordinates: { latitude: 36.3, longitude: -82.3 } },
    },
    {
      id: 11,
      truckIds: [2],
      location: { coordinates: { latitude: 37, longitude: -83 } },
    },
  ];

  const locations = getTruckLocations(trucks, schedules);

  assert.deepEqual(
    locations.map(({ truck, schedule, position }) => [
      truck.id,
      schedule.id,
      position,
    ]),
    [
      [1, 10, [36.3, -82.3]],
      [2, 10, [36.3, -82.3]],
      [2, 11, [37, -83]],
    ]
  );
});

test("ignores schedules with invalid coordinates", () => {
  const locations = getTruckLocations(trucks, [
    {
      id: 10,
      truckIds: [1],
      location: { coordinates: { latitude: 91, longitude: -82.3 } },
    },
  ]);

  assert.deepEqual(locations, []);
});
