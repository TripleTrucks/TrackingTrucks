import assert from "node:assert/strict";
import test from "node:test";
import { getTruckStatus } from "../.cache/tests/truckStatus.js";

test("schedule age does not change a truck's operating status", () => {
  const now = new Date(2026, 10, 17, 10, 0);
  const status = getTruckStatus(
    [1],
    now,
    [
      {
        id: 1,
        truckIds: [1],
        "last-revised": "2020-01-01",
        tuesday: [{ startTime: "08:00", endTime: "17:00" }],
      },
    ]
  );

  assert.deepEqual(status, { name: "Open", className: "open" });
});

test("a truck without schedules defaults to closed", () => {
  assert.deepEqual(getTruckStatus([], new Date(2026, 10, 17, 10, 0), []), {
    name: "Closed",
    className: "closed",
  });
});
