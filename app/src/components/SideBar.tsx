
import type { Truck } from "../Home";
import {
  getTruckStatus,
  schedules,
  type DayKey,
  type TimeRange,
  type TruckStatus,
} from "../truckStatus";
import { routeOrigin } from "../geoapifyRouting";

interface SideBarProps {
  selectedTruck: Truck | null;
  visibleTrucks: Truck[];
  onTruckSelect: (truck: Truck | null) => void;
  currentTime: Date;
  onRouteToSchedule: (scheduleId: number) => void;
  routeState: {
    scheduleId: number;
    status: "loading" | "success" | "error";
    message: string;
    distance?: number;
    distanceUnits?: string;
  } | null;
}

interface Profile {
  id: number;
  displayname: string;
  truckIds: number[];
}

const profileFiles = import.meta.glob<Profile>(
  "/Database/Profiles/*.json",
  {
    eager: true,
    import: "default",
  }
);

const profiles = Object.values(profileFiles);

const days: { label: string; key: DayKey }[] = [
  { label: "Monday", key: "monday" },
  { label: "Tuesday", key: "tuesday" },
  { label: "Wednesday", key: "wednesday" },
  { label: "Thursday", key: "thursday" },
  { label: "Friday", key: "friday" },
  { label: "Saturday", key: "saturday" },
  { label: "Sunday", key: "sunday" },
];

function formatTime(time: string): string {
  const [hoursText, minutesText] = time.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return time;
  }

  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;

  return `${displayHours}:${String(minutes).padStart(2, "0")} ${period}`;
}

function formatSchedule(ranges: TimeRange[] | undefined): string {
  if (!ranges || ranges.length === 0) {
    return "Closed";
  }

  return ranges
    .map(
      (range) =>
        `${formatTime(range.startTime)} – ${formatTime(range.endTime)}`
    )
    .join(", ");
}

function StatusBadge({ status }: { status: TruckStatus }) {
  return (
    <div
      className={`status-badge status-${status.className}`}
      role="status"
    >
      {status.name}
    </div>
  );
}

function SideBar({
  selectedTruck,
  visibleTrucks,
  onTruckSelect,
  currentTime,
  onRouteToSchedule,
  routeState,
}: SideBarProps) {
  if (selectedTruck) {
    const truckProfiles = (selectedTruck.profileIds ?? [])
      .map((id) => profiles.find((profile) => profile.id === id))
      .filter((profile) => profile !== undefined);

    const truckSchedules = (selectedTruck.scheduleIds ?? [])
      .map((id) => schedules.find((schedule) => schedule.id === id))
      .filter((schedule) => schedule !== undefined);
    const truckStatus = getTruckStatus(
      selectedTruck.scheduleIds ?? [],
      currentTime
    );

    return (
      <aside className="sidebar">
        <button
          className="back-button"
          onClick={() => onTruckSelect(null)}
        >
          ← Back to Trucks
        </button>

        <div className="truck-details">
          <h2>{selectedTruck.truckname}</h2>
          <StatusBadge status={truckStatus} />

          <div className="truck-tags">
            {selectedTruck.tags.map((tag) => (
              <span key={tag} className="truck-tag">
                {tag}
              </span>
            ))}
          </div>

          <section className="sidebar-section">
            <h3>Owner</h3>

            {truckProfiles.length > 0 ? (
              truckProfiles.map((profile) => (
                <p key={profile.id}>{profile.displayname}</p>
              ))
            ) : (
              <p>Owner information unavailable.</p>
            )}
          </section>

          <section className="sidebar-section">
            <h3>Location</h3>

            {truckSchedules.length > 0 ? (
              truckSchedules.map((schedule) => {
                const address = schedule.location?.address_components;

                const cityStatePostal = [
                  address?.city,
                  address?.state_province,
                  address?.postal_code,
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <div key={schedule.id}>
                    {schedule.location?.name && (
                      <p>{schedule.location.name}</p>
                    )}

                    {address?.street_address && (
                      <p>{address.street_address}</p>
                    )}

                    {address?.extended_address && (
                      <p>{address.extended_address}</p>
                    )}

                    {cityStatePostal && <p>{cityStatePostal}</p>}

                    {address?.country && <p>{address.country}</p>}

                    <p>Time zone: {schedule.timezone || "Not specified"}</p>
                    <button
                      className="route-button"
                      onClick={() => onRouteToSchedule(schedule.id)}
                      disabled={routeState?.status === "loading"}
                    >
                      {routeState?.scheduleId === schedule.id &&
                      routeState.status === "loading"
                        ? "Loading route…"
                        : "Show driving route"}
                    </button>
                    {routeState?.scheduleId === schedule.id && (
                      <>
                        {routeState.status === "success" &&
                          typeof routeState.distance === "number" &&
                          routeState.distanceUnits && (
                            <p>
                              Driving distance:{" "}
                              {routeState.distance.toFixed(2)}{" "}
                              {routeState.distanceUnits}
                            </p>
                          )}
                        {routeState.status !== "success" && (
                          <p
                            className={`route-message route-${routeState.status}`}
                            role="status"
                          >
                            {routeState.message}
                          </p>
                        )}
                      </>
                    )}
                    <p className="route-origin">
                      Route starts at {routeOrigin.address}.
                    </p>
                  </div>
                );
              })
            ) : (
              <p>Location information unavailable.</p>
            )}
          </section>

          <section className="sidebar-section">
            <h3>Phone Number</h3>
            <p>Not provided</p>
          </section>

          <section className="sidebar-section">
            <h3>Schedule</h3>

            {truckSchedules.length > 0 ? (
              truckSchedules.map((schedule) => (
                <div key={schedule.id}>
                  {days.map((day) => (
                    <div
                      key={day.key}
                      className="schedule-day"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "12px",
                        marginBottom: "10px",
                      }}
                    >
                      <span>{day.label}</span>
                      <span>
                        {formatSchedule(schedule[day.key])}
                      </span>
                    </div>
                  ))}
                </div>
              ))
            ) : (
              <p>Schedule information unavailable.</p>
            )}
          </section>
          
          <section className="sidebar-section">
            <h3>Social Media</h3>
            <p>Not provided</p>
          </section>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Available Trucks</h2>
      </div>

      <div className="truck-list">
        {visibleTrucks.length === 0 ? (
          <p style={{ padding: "20px" }}>No trucks visible in this map area.</p>
        ) : (
          visibleTrucks.map((truck) => (
            <button
              key={truck.id}
              className="truck-card"
              onClick={() => onTruckSelect(truck)}
            >
              <div className="truck-card-name">
                {truck.truckname}
              </div>

              <StatusBadge
                status={getTruckStatus(
                  truck.scheduleIds ?? [],
                  currentTime
                )}
              />

              <div className="truck-card-tags">
                {truck.tags.join(" • ")}
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

export default SideBar;