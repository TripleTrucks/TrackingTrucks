import type { Profile, Truck } from "./dataTypes";
import type { Schedule } from "./truckStatus";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSchedule(value: unknown): value is Schedule {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    Number.isInteger(value.id)
  );
}

function isTruck(value: unknown): value is Truck {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    Number.isInteger(value.id) &&
    typeof value.truckname === "string" &&
    Array.isArray(value.tags) &&
    (value["social-media"] === undefined ||
      (Array.isArray(value["social-media"]) &&
        value["social-media"].every(
          (link: unknown) =>
            isRecord(link) &&
            typeof link.platform === "string" &&
            typeof link.url === "string"
        ))) &&
    Array.isArray(value.profileIds) &&
    Array.isArray(value.scheduleIds)
  );
}

function isProfile(value: unknown): value is Profile {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    Number.isInteger(value.id) &&
    typeof value.displayname === "string" &&
    Array.isArray(value.truckIds)
  );
}

async function getErrorMessage(response: Response): Promise<string> {
  const responseText = await response.text();
  if (!responseText) {
    return `Request failed (HTTP ${response.status}).`;
  }

  try {
    const body: unknown = JSON.parse(responseText);
    if (isRecord(body) && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    return responseText;
  }

  return `Request failed (HTTP ${response.status}): ${responseText}`;
}

async function fetchCollection<T>(
  path: string,
  isItem: (value: unknown) => value is T,
  signal?: AbortSignal
): Promise<T[]> {
  const response = await fetch(path, { signal, cache: "no-store" });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  const body: unknown = await response.json();
  const records = isRecord(body) ? body.data ?? body.Data : undefined;
  if (!Array.isArray(records) || !records.every(isItem)) {
    throw new Error(`The API returned an invalid collection for ${path}.`);
  }

  return records;
}

export function fetchSchedules(signal?: AbortSignal): Promise<Schedule[]> {
  return fetchCollection("/api/Schedules", isSchedule, signal);
}

export function fetchTrucks(signal?: AbortSignal): Promise<Truck[]> {
  return fetchCollection("/api/Trucks", isTruck, signal);
}

export function fetchProfiles(signal?: AbortSignal): Promise<Profile[]> {
  return fetchCollection("/api/Profiles", isProfile, signal);
}

export async function createTruck(
  truck: Truck
): Promise<Truck> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (import.meta.env.DEV) {
    headers["X-Dev-Role"] = "admin";
  }

  const response = await fetch("/api/Trucks", {
    method: "POST",
    headers,
    body: JSON.stringify(truck),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  const createdTruck: unknown = await response.json();
  if (!isTruck(createdTruck)) {
    throw new Error("The truck service returned an invalid truck.");
  }

  return createdTruck;
}

export async function updateTruck(truck: Truck): Promise<Truck> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (import.meta.env.DEV) {
    headers["X-Dev-Role"] = "admin";
  }

  const response = await fetch(`/api/Trucks/${truck.id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(truck),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  const updatedTruck: unknown = await response.json();
  if (!isTruck(updatedTruck)) {
    throw new Error("The truck service returned an invalid update.");
  }

  return updatedTruck;
}

export async function updateSchedule(schedule: Schedule): Promise<Schedule> {
  const response = await fetch(`/api/Schedules/${schedule.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(schedule),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  const updatedSchedule: unknown = await response.json();
  if (!isSchedule(updatedSchedule)) {
    throw new Error("The schedule service returned an invalid update.");
  }

  return updatedSchedule;
}

export function getLatestScheduleRevision(
  schedules: Schedule[]
): string | null {
  return schedules.reduce<string | null>((latest, schedule) => {
    const revision = schedule["last-revised"];
    if (!revision || !Number.isFinite(Date.parse(revision))) {
      return latest;
    }

    return !latest || Date.parse(revision) > Date.parse(latest)
      ? revision
      : latest;
  }, null);
}

export function formatRevisionDate(revision: string): string {
  const timestamp = new Date(revision);
  if (!Number.isFinite(timestamp.getTime())) {
    return revision;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(timestamp);
}
