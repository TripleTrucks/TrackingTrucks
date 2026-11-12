export interface TimeRange {
  startTime: string;
  endTime: string;
}

export interface ScheduleHistoryEntry {
  updatedAt: string;
  schedule: Omit<Schedule, "history">;
}

export type DateExceptionRecurrence = "once" | "monthly" | "yearly";

export interface ScheduleDateException {
  date: string;
  title?: string;
  recurrence: DateExceptionRecurrence;
  ranges: TimeRange[];
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
  history?: ScheduleHistoryEntry[];
  dateExceptions?: ScheduleDateException[];
  canceled?: boolean;
  soldOut?: boolean;
  timezone?: string;
  location?: {
    name?: string;
    coordinates?: {
      latitude?: number;
      longitude?: number;
    };
    geocodedAddress?: string;
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

function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDateException(
  schedule: Schedule,
  date: Date
): ScheduleDateException | undefined {
  const dateKey = getLocalDateKey(date);
  const monthAndDay = dateKey.slice(5);
  const dayOfMonth = dateKey.slice(8);
  const matchingExceptions = (schedule.dateExceptions ?? []).filter(
    (exception) =>
      (exception.recurrence === "once" && exception.date === dateKey) ||
      (exception.recurrence === "monthly" &&
        date >= new Date(`${exception.date}T00:00:00`) &&
        exception.date.slice(8) === dayOfMonth) ||
      (exception.recurrence === "yearly" &&
        date >= new Date(`${exception.date}T00:00:00`) &&
        exception.date.slice(5) === monthAndDay)
  );

  return (
    matchingExceptions.find((exception) => exception.recurrence === "once") ??
    matchingExceptions.find((exception) => exception.recurrence === "monthly") ??
    matchingExceptions.find((exception) => exception.recurrence === "yearly")
  );
}

function getRangesForDate(
  schedule: Schedule,
  date: Date,
  day: DayKey
): TimeRange[] {
  return getDateException(schedule, date)?.ranges ?? schedule[day] ?? [];
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
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayException = getDateException(schedule, todayDate);
  const todayRanges = todayException?.ranges ?? schedule[dayKeys[today]] ?? [];
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

  const previousDate = new Date(todayDate);
  previousDate.setDate(previousDate.getDate() - 1);
  const previousDay = dayKeys[previousDate.getDay()];
  const previousRanges = getRangesForDate(schedule, previousDate, previousDay);
  const isOpenFromPreviousDay = !todayException && previousRanges.some((range) => {
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
    const futureDate = new Date(todayDate);
    futureDate.setDate(futureDate.getDate() + offset);
    const day = dayKeys[futureDate.getDay()];
    if (
      getRangesForDate(schedule, futureDate, day).some((range) => {
        const start = parseTime(range.startTime);
        const end = parseTime(range.endTime);
        return start !== undefined && end !== undefined && start !== end;
      })
    ) {
      hasUpcomingOpening = true;
      break;
    }
  }

  if (!hasUpcomingOpening) {
    for (let offset = dayKeys.length + 1; offset <= 366; offset += 1) {
      const futureDate = new Date(todayDate);
      futureDate.setDate(futureDate.getDate() + offset);
      const exception = getDateException(schedule, futureDate);
      if (
        exception?.ranges.some((range) => {
          const start = parseTime(range.startTime);
          const end = parseTime(range.endTime);
          return start !== undefined && end !== undefined && start !== end;
        })
      ) {
        hasUpcomingOpening = true;
        break;
      }
    }
  }

  return hasUpcomingOpening ? "Scheduled Later" : "Closed";
}

function toTruckStatus(name: TruckStatusName): TruckStatus {
  return { name, className: statusClassNames[name] };
}

export function getTruckStatus(
  scheduleIds: number[],
  now: Date,
  availableSchedules: Schedule[]
): TruckStatus {
  const truckSchedules = scheduleIds
    .map((id) => availableSchedules.find((schedule) => schedule.id === id))
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
