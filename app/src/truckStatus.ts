export interface TimeRange {
  startTime: string;
  endTime: string;
}

export type DayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export interface Schedule {
  id: number;
  truckIds: number[];
  "last-revised"?: string;
  canceled?: boolean;
  soldOut?: boolean;
  timezone?: string;
  location?: {
    name?: string;
    address_components?: {
      street_address?: string;
      extended_address?: string;
      city?: string;
      state_province?: string;
      postal_code?: string;
      country?: string;
    };
  };
  monday?: TimeRange[];
  tuesday?: TimeRange[];
  wednesday?: TimeRange[];
  thursday?: TimeRange[];
  friday?: TimeRange[];
  saturday?: TimeRange[];
  sunday?: TimeRange[];
}

export type TruckStatusName =
  | "Open"
  | "Scheduled Later"
  | "Closed"
  | "Canceled"
  | "Sold Out"
  | "Stale";

export interface TruckStatus {
  name: TruckStatusName;
  className: string;
}

const STALE_AFTER_DAYS = 7;

const scheduleFiles = import.meta.glob<Schedule>(
  "/Database/Schedules/*.json",
  {
    eager: true,
    import: "default",
  }
);

export const schedules = Object.values(scheduleFiles);

const dayKeys: DayKey[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const statusClassNames: Record<TruckStatusName, string> = {
  Open: "open",
  "Scheduled Later": "scheduled",
  Closed: "closed",
  Canceled: "canceled",
  "Sold Out": "sold-out",
  Stale: "stale",
};

function parseTime(time: string): number | undefined {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);

  if (!match) {
    return undefined;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function parseRevisionDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) ??
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);

  if (!match) {
    return undefined;
  }

  const isIsoDate = value.includes("-");
  const year = Number(isIsoDate ? match[1] : match[3]);
  const month = Number(isIsoDate ? match[2] : match[1]);
  const day = Number(isIsoDate ? match[3] : match[2]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return undefined;
  }

  return date;
}

function isStale(schedule: Schedule, now: Date): boolean {
  const revised = parseRevisionDate(schedule["last-revised"]);

  if (!revised) {
    return true;
  }

  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const revisedUtc = Date.UTC(
    revised.getFullYear(),
    revised.getMonth(),
    revised.getDate()
  );
  const ageInDays = (todayUtc - revisedUtc) / 86_400_000;

  return ageInDays > STALE_AFTER_DAYS;
}

function getScheduleStatus(
  schedule: Schedule,
  now: Date
): TruckStatusName {
  if (schedule.canceled) {
    return "Canceled";
  }

  if (schedule.soldOut) {
    return "Sold Out";
  }

  if (isStale(schedule, now)) {
    return "Stale";
  }

  const today = now.getDay();
  const currentMinute = now.getHours() * 60 + now.getMinutes();
  const todayRanges = schedule[dayKeys[today]] ?? [];
  let hasUpcomingOpening = false;

  for (const range of todayRanges) {
    const start = parseTime(range.startTime);
    const end = parseTime(range.endTime);

    if (start === undefined || end === undefined || start === end) {
      continue;
    }

    if (start < end) {
      if (currentMinute >= start && currentMinute < end) {
        return "Open";
      }

      if (currentMinute < start) {
        hasUpcomingOpening = true;
      }
    } else {
      if (currentMinute >= start || currentMinute < end) {
        return "Open";
      }

      if (currentMinute < start) {
        hasUpcomingOpening = true;
      }
    }
  }

  const previousDay = dayKeys[(today + 6) % dayKeys.length];
  const isOpenFromPreviousDay = (schedule[previousDay] ?? []).some((range) => {
    const start = parseTime(range.startTime);
    const end = parseTime(range.endTime);

    return (
      start !== undefined &&
      end !== undefined &&
      start > end &&
      currentMinute < end
    );
  });

  if (isOpenFromPreviousDay) {
    return "Open";
  }

  for (let offset = 1; offset <= dayKeys.length; offset += 1) {
    const day = dayKeys[(today + offset) % dayKeys.length];
    if (
      (schedule[day] ?? []).some((range) => {
        const start = parseTime(range.startTime);
        const end = parseTime(range.endTime);
        return start !== undefined && end !== undefined && start !== end;
      })
    ) {
      hasUpcomingOpening = true;
      break;
    }
  }

  return hasUpcomingOpening ? "Scheduled Later" : "Closed";
}

function toTruckStatus(name: TruckStatusName): TruckStatus {
  return { name, className: statusClassNames[name] };
}

export function getTruckStatus(
  scheduleIds: number[],
  now: Date
): TruckStatus {
  const truckSchedules = scheduleIds
    .map((id) => schedules.find((schedule) => schedule.id === id))
    .filter((schedule): schedule is Schedule => schedule !== undefined);
  const statuses = truckSchedules.map((schedule) =>
    getScheduleStatus(schedule, now)
  );

  if (statuses.includes("Open")) {
    return toTruckStatus("Open");
  }

  if (statuses.includes("Scheduled Later")) {
    return toTruckStatus("Scheduled Later");
  }

  if (statuses.length > 0 && statuses.every((status) => status === "Canceled")) {
    return toTruckStatus("Canceled");
  }

  if (statuses.includes("Sold Out")) {
    return toTruckStatus("Sold Out");
  }

  if (statuses.includes("Stale")) {
    return toTruckStatus("Stale");
  }

  if (statuses.includes("Canceled")) {
    return toTruckStatus("Canceled");
  }

  if (statuses.includes("Closed")) {
    return toTruckStatus("Closed");
  }

  return toTruckStatus("Stale");
}
