import { useEffect, useState } from "react";
import "./Home.css";

import MapView from "../src/components/MapView";
import SideBar from "../src/components/SideBar";
import {
  getDrivingRoute,
  type DrivingRoute,
} from "../src/geoapifyRouting";
import {
  fetchProfiles,
  fetchSchedules,
  fetchTrucks,
} from "../src/schedulesApi";
import type { Profile, Truck } from "../src/dataTypes";
import type { Schedule } from "../src/truckStatus";

type RouteState = {
  scheduleId: number;
  status: "loading" | "success" | "error";
  message: string;
  route?: DrivingRoute;
};

function Home() {
  const [selectedTruck, setSelectedTruck] = useState<Truck | null>(null);
  const [visibleTrucks, setVisibleTrucks] = useState<Truck[]>([]);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [currentTrucks, setCurrentTrucks] = useState<Truck[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentSchedules, setCurrentSchedules] = useState<Schedule[]>([]);
  const [scheduleLoadStatus, setScheduleLoadStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [apiError, setApiError] = useState<string | null>(null);
  const [routeState, setRouteState] = useState<RouteState | null>(null);
  const [routeRequest, setRouteRequest] = useState<{
    scheduleId: number;
  } | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let controller: AbortController | null = null;

    function loadDashboardData() {
      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;

      Promise.all([
        fetchTrucks(signal),
        fetchProfiles(signal),
        fetchSchedules(signal),
      ])
        .then(([trucks, loadedProfiles, schedules]) => {
          setCurrentTrucks(trucks);
          setProfiles(loadedProfiles);
          setCurrentSchedules(schedules);
          setScheduleLoadStatus("ready");
          setApiError(null);
        })
        .catch((error: unknown) => {
          if (!signal.aborted) {
            setApiError(
              error instanceof Error
                ? error.message
                : "The API is unavailable."
            );
            setScheduleLoadStatus("error");
          }
        });
    }

    loadDashboardData();
    window.addEventListener("focus", loadDashboardData);

    return () => {
      controller?.abort();
      window.removeEventListener("focus", loadDashboardData);
    };
  }, []);

  useEffect(() => {
    if (!routeRequest) {
      return;
    }

    const schedule = currentSchedules.find(
      (candidate) => candidate.id === routeRequest.scheduleId
    );
    const coordinates = schedule?.location?.coordinates;

    if (
      typeof coordinates?.latitude !== "number" ||
      typeof coordinates.longitude !== "number" ||
      !Number.isFinite(coordinates.latitude) ||
      !Number.isFinite(coordinates.longitude) ||
      coordinates.latitude < -90 ||
      coordinates.latitude > 90 ||
      coordinates.longitude < -180 ||
      coordinates.longitude > 180
    ) {
      setRouteState({
        scheduleId: routeRequest.scheduleId,
        status: "error",
        message:
          "This schedule has no valid coordinates. Geocode its address before routing.",
      });
      return;
    }

    const controller = new AbortController();
    setRouteState({
      scheduleId: routeRequest.scheduleId,
      status: "loading",
      message: "Loading driving route…",
    });

    getDrivingRoute(
      [coordinates.latitude, coordinates.longitude],
      controller.signal
    )
      .then((route) => {
        setRouteState({
          scheduleId: routeRequest.scheduleId,
          status: "success",
          message: "Driving route is shown on the map.",
          route,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setRouteState({
          scheduleId: routeRequest.scheduleId,
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to load the driving route.",
        });
      });

    return () => controller.abort();
  }, [currentSchedules, routeRequest]);

  function showRoute(scheduleId: number) {
    setRouteRequest({ scheduleId });
  }

  return (
    <div className="home">

      <div className="main-layout">
        <SideBar
          selectedTruck={selectedTruck}
          visibleTrucks={visibleTrucks}
          onTruckSelect={setSelectedTruck}
          currentTime={currentTime}
          trucks={currentTrucks}
          profiles={profiles}
          schedules={currentSchedules}
          scheduleLoadStatus={scheduleLoadStatus}
          apiError={apiError}
          onRouteToSchedule={showRoute}
          routeState={
            routeState
              ? {
                  scheduleId: routeState.scheduleId,
                  status: routeState.status,
                  message: routeState.message,
                  distance: routeState.route?.distance,
                  distanceUnits: routeState.route?.distanceUnits,
                }
              : null
          }
        />

        <MapView
          selectedTruck={selectedTruck}
          onTruckSelect={setSelectedTruck}
          onVisibleTrucksChange={setVisibleTrucks}
          currentTime={currentTime}
          trucks={currentTrucks}
          schedules={currentSchedules}
          routeState={
            routeState?.route
              ? { status: routeState.status, route: routeState.route }
              : null
          }
        />
      </div>
    </div>
  );
}

export default Home;