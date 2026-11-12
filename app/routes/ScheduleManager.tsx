import { useEffect, useState, type FormEvent } from "react";
import {
  formatRevisionDate,
  fetchSchedules,
  fetchTrucks,
  updateSchedule,
} from "../src/schedulesApi";
import type { Truck } from "../src/dataTypes";
import {
  type DayKey,
  type Schedule,
  type TimeRange,
} from "../src/truckStatus";
import "./ScheduleManager.css";

const days: { label: string; key: DayKey }[] = [
  { label: "Monday", key: "monday" },
  { label: "Tuesday", key: "tuesday" },
  { label: "Wednesday", key: "wednesday" },
  { label: "Thursday", key: "thursday" },
  { label: "Friday", key: "friday" },
  { label: "Saturday", key: "saturday" },
  { label: "Sunday", key: "sunday" },
];

function ScheduleManager() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [drafts, setDrafts] = useState<Record<number, Schedule>>({});
  const [expandedScheduleIds, setExpandedScheduleIds] = useState<Set<number>>(
    new Set()
  );
  const [collapsedScheduleDetailsIds, setCollapsedScheduleDetailsIds] =
    useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setErrorMessage(null);

    Promise.all([
      fetchSchedules(controller.signal),
      fetchTrucks(controller.signal),
    ])
      .then(([records, loadedTrucks]) => {
        setSchedules(records);
        setTrucks(loadedTrucks);
        setDrafts(
          Object.fromEntries(records.map((schedule) => [schedule.id, schedule]))
        );
        setExpandedScheduleIds(
          records[0] ? new Set([records[0].id]) : new Set()
        );
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Unable to load schedules."
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [loadAttempt]);

  function toggleSchedule(id: number) {
    setExpandedScheduleIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  function setScheduleDetailsCollapsed(id: number, collapsed: boolean) {
    setCollapsedScheduleDetailsIds((current) => {
      if (current.has(id) === collapsed) {
        return current;
      }

      const next = new Set(current);
      if (collapsed) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function updateDay(scheduleId: number, day: DayKey, ranges: TimeRange[]) {
    setDrafts((current) => ({
      ...current,
      [scheduleId]: { ...current[scheduleId], [day]: ranges },
    }));
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  async function saveSchedule(
    event: FormEvent<HTMLFormElement>,
    scheduleId: number
  ) {
    event.preventDefault();
    const draft = drafts[scheduleId];
    if (!draft) {
      return;
    }

    const hasInvalidRange = days.some((day) =>
      (draft[day.key] ?? []).some(
        (range) =>
          !range.startTime ||
          !range.endTime ||
          range.startTime === range.endTime
      )
    );
    if (hasInvalidRange) {
      setErrorMessage("Each time range needs different start and end times.");
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const savedSchedule = await updateSchedule(draft);
      setSchedules((current) =>
        current.map((schedule) =>
          schedule.id === savedSchedule.id ? savedSchedule : schedule
        )
      );
      setDrafts((current) => ({
        ...current,
        [savedSchedule.id]: savedSchedule,
      }));
      setSuccessMessage(
        "Schedule saved. The previous version has been kept in history."
      );
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to save schedule."
      );
    } finally {
      setIsSaving(false);
    }
  }

  const scheduleLoadFailed =
    !isLoading && schedules.length === 0 && errorMessage !== null;

  return (
    <div className="home">
      <main className="schedule-page">
        <header className="schedule-page-header">
          <div>
            <p className="schedule-eyebrow">Schedule administration</p>
            <h1>Manage schedules</h1>
            <p>
              Update upcoming weekly hours. Each save records the previous
              version so earlier schedule information remains available.
            </p>
          </div>
        </header>

        {errorMessage && !scheduleLoadFailed && (
          <p className="schedule-message schedule-message-error" role="alert">
            {errorMessage}
          </p>
        )}
        {successMessage && (
          <p className="schedule-message schedule-message-success" role="status">
            {successMessage}
          </p>
        )}

        {isLoading ? (
          <p className="schedule-empty-state" role="status">
            Loading schedules…
          </p>
        ) : scheduleLoadFailed ? (
          <section className="schedule-empty-state" role="alert">
            <h2>Unable to load schedules</h2>
            <p>{errorMessage}</p>
            <button
              className="schedule-save-button"
              type="button"
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            >
              Try again
            </button>
          </section>
        ) : schedules.length === 0 ? (
          <section className="schedule-empty-state">
            <h2>No schedules found</h2>
            <p>
              Add a schedule record before making changes. Historical schedule
              data will be retained each time an existing schedule is updated.
            </p>
          </section>
        ) : (
          <div className="schedule-manager-layout">
            <aside className="schedule-list-panel">
              <h2>Schedules</h2>
              <div className="schedule-list">
                {schedules.map((schedule) => (
                  <button
                    key={schedule.id}
                    type="button"
                    className={`schedule-list-item ${
                      expandedScheduleIds.has(schedule.id) ? "is-selected" : ""
                    }`}
                    onClick={() => toggleSchedule(schedule.id)}
                    aria-expanded={expandedScheduleIds.has(schedule.id)}
                    aria-controls={`schedule-editor-${schedule.id}`}
                  >
                    <span className="schedule-list-name">
                      {schedule.location?.name || `Schedule ${schedule.id}`}
                    </span>
                    <span className="schedule-list-trucks">
                      {schedule.truckIds
                        .map(
                          (truckId) =>
                            trucks.find((truck) => truck.id === truckId)
                              ?.truckname ?? `Truck ${truckId}`
                        )
                        .join(", ") || "No trucks assigned"}
                    </span>
                    <span className="schedule-list-meta">
                      ID {schedule.id}
                      {schedule["last-revised"] &&
                        ` · Updated ${formatRevisionDate(schedule["last-revised"])}`}
                    </span>
                    <span className="schedule-list-toggle" aria-hidden="true">
                      {expandedScheduleIds.has(schedule.id) ? "−" : "+"}
                    </span>
                  </button>
                ))}
              </div>
            </aside>

            <div className="schedule-editor-column">
              {schedules.map((schedule) => {
                const draft = drafts[schedule.id];
                if (!draft) {
                  return null;
                }

                return (
                  <details
                    className="schedule-editor-item"
                    id={`schedule-editor-${schedule.id}`}
                    open={!collapsedScheduleDetailsIds.has(schedule.id)}
                    onToggle={(event) =>
                      setScheduleDetailsCollapsed(
                        schedule.id,
                        !event.currentTarget.open
                      )
                    }
                    key={schedule.id}
                  >
                    <summary className="schedule-editor-tab">
                      <span className="schedule-editor-tab-title">
                        {draft.location?.name || `Schedule ${draft.id}`}
                      </span>
                      <span className="schedule-editor-tab-trucks">
                        {draft.truckIds
                          .map(
                            (truckId) =>
                              trucks.find((truck) => truck.id === truckId)
                                ?.truckname ?? `Truck ${truckId}`
                          )
                          .join(", ") || "No trucks assigned"}
                      </span>
                      <span className="schedule-editor-tab-description">
                        Weekly hours and revision history
                      </span>
                    </summary>
                    <div
                      className="schedule-editor-content"
                      id={`schedule-details-${schedule.id}`}
                    >
                <form
                  className="schedule-editor-panel"
                  onSubmit={(event) => saveSchedule(event, schedule.id)}
                >
                  <div className="schedule-editor-heading">
                    <div>
                      <p className="schedule-eyebrow">
                        {draft.location?.name || `Schedule ${draft.id}`}
                      </p>
                      <h2>Upcoming weekly hours</h2>
                    </div>
                    <span className="schedule-id">ID {draft.id}</span>
                  </div>

                  <p className="schedule-editor-help">
                    Times use the schedule&apos;s local time zone
                    {draft.timezone ? ` (${draft.timezone})` : ""}. Leave a
                    day empty when it is closed.
                  </p>

                  <div className="schedule-days">
                    {days.map((day) => {
                      const ranges = draft[day.key] ?? [];
                      return (
                        <section className="schedule-day-editor" key={day.key}>
                          <div className="schedule-day-heading">
                            <h3>{day.label}</h3>
                            <button
                              className="schedule-text-button"
                              type="button"
                              disabled={isSaving}
                              onClick={() =>
                                updateDay(schedule.id, day.key, [
                                  ...ranges,
                                  { startTime: "09:00", endTime: "17:00" },
                                ])
                              }
                            >
                              Add hours
                            </button>
                          </div>
                          {ranges.length === 0 ? (
                            <p className="schedule-closed">Closed</p>
                          ) : (
                            ranges.map((range, index) => (
                              <div
                                className="schedule-time-range"
                                key={`${day.key}-${index}`}
                              >
                                <label>
                                  <span className="visually-hidden">
                                    {day.label} range {index + 1} start time
                                  </span>
                                  <input
                                    type="time"
                                    required
                                    disabled={isSaving}
                                    value={range.startTime}
                                    onChange={(event) =>
                                      updateDay(
                                        schedule.id,
                                        day.key,
                                        ranges.map((currentRange, rangeIndex) =>
                                          rangeIndex === index
                                            ? {
                                                ...currentRange,
                                                startTime: event.target.value,
                                              }
                                            : currentRange
                                        )
                                      )
                                    }
                                  />
                                </label>
                                <span aria-hidden="true">to</span>
                                <label>
                                  <span className="visually-hidden">
                                    {day.label} range {index + 1} end time
                                  </span>
                                  <input
                                    type="time"
                                    required
                                    disabled={isSaving}
                                    value={range.endTime}
                                    onChange={(event) =>
                                      updateDay(
                                        schedule.id,
                                        day.key,
                                        ranges.map((currentRange, rangeIndex) =>
                                          rangeIndex === index
                                            ? {
                                                ...currentRange,
                                                endTime: event.target.value,
                                              }
                                            : currentRange
                                        )
                                      )
                                    }
                                  />
                                </label>
                                <button
                                  className="schedule-remove-button"
                                  type="button"
                                  aria-label={`Remove ${day.label} range ${index + 1}`}
                                  disabled={isSaving}
                                  onClick={() =>
                                    updateDay(
                                      schedule.id,
                                      day.key,
                                      ranges.filter(
                                        (_, rangeIndex) => rangeIndex !== index
                                      )
                                    )
                                  }
                                >
                                  Remove
                                </button>
                              </div>
                            ))
                          )}
                        </section>
                      );
                    })}
                  </div>

                  <div className="schedule-save-row">
                    <p>
                      Last revised:{" "}
                      {draft["last-revised"]
                        ? formatRevisionDate(draft["last-revised"])
                        : "Not recorded"}
                    </p>
                    <button
                      className="schedule-save-button"
                      type="submit"
                      disabled={isSaving}
                    >
                      {isSaving ? "Saving…" : "Save schedule"}
                    </button>
                  </div>
                </form>

                <section className="schedule-history-panel">
                  <div className="schedule-history-heading">
                    <h2>Revision history</h2>
                    <span>{draft.history?.length ?? 0} previous versions</span>
                  </div>
                  {!draft.history?.length ? (
                    <p className="schedule-history-empty">
                      Previous versions will appear here after the first
                      schedule change.
                    </p>
                  ) : (
                    <ol className="schedule-history-list">
                      {[...draft.history].reverse().map((revision, index) => (
                        <li key={`${revision.updatedAt}-${index}`}>
                          <details>
                            <summary>
                              Updated {formatRevisionDate(revision.updatedAt)}
                            </summary>
                            <div className="schedule-history-days">
                              {days.map((day) => (
                                <p key={day.key}>
                                  <strong>{day.label}</strong>
                                  {(revision.schedule[day.key] ?? [])
                                    .map(
                                      (range) =>
                                        `${range.startTime}–${range.endTime}`
                                    )
                                    .join(", ") || "Closed"}
                                </p>
                              ))}
                            </div>
                          </details>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default ScheduleManager;
