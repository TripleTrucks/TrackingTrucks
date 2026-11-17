import type { Truck } from "./dataTypes";
import type { Schedule } from "./truckStatus";

export interface TruckLocation {
  truck: Truck;
  schedule: Schedule;
  position: [number, number];
}

export function getTruckLocations(
  trucks: Truck[],
  schedules: Schedule[]
): TruckLocation[] {
  const trucksById = new Map(trucks.map((truck) => [truck.id, truck]));

  return schedules.flatMap((schedule) => {
    const coordinates = schedule.location?.coordinates;
    const latitude = coordinates?.latitude;
    const longitude = coordinates?.longitude;

    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return [];
    }

    const assignedTruckIds = new Set(schedule.truckIds ?? []);
    for (const truck of trucks) {
      if (truck.scheduleIds?.includes(schedule.id)) {
        assignedTruckIds.add(truck.id);
      }
    }

    return Array.from(assignedTruckIds).flatMap((truckId) => {
      const truck = trucksById.get(truckId);
      return truck
        ? [
            {
              truck,
              schedule,
              position: [latitude, longitude],
            },
          ]
        : [];
    });
  });
}
