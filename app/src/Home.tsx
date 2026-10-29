import { useEffect, useState } from "react";
import "./Home.css";

import Navbar from "./components/Navbar";
import MapView from "./components/MapView";
import SideBar from "./components/SideBar";
import {
  getDrivingRoute,
  type DrivingRoute,
} from "./geoapifyRouting";
import { schedules } from "./truckStatus";

type RouteState = {
  scheduleId: number;
  status: "loading" | "success" | "error";
  message: string;
  route?: DrivingRoute;
};

export interface Truck {
  id: number;
  truckname: string;
  tags: string[];
  profileIds: number[];
  scheduleIds: number[];
}

function Home() {
  const [selectedTruck, setSelectedTruck] = useState<Truck | null>(null);
  const [visibleTrucks, setVisibleTrucks] = useState<Truck[]>([]);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [routeState, setRouteState] = useState<RouteState | null>(null);
  const [routeRequest, setRouteRequest] = useState<{
    scheduleId: number;
  } | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!routeRequest) {
      return;
    }

    const schedule = schedules.find(
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
  }, [routeRequest]);

  function showRoute(scheduleId: number) {
    setRouteRequest({ scheduleId });
  }

  return (
    <div className="home">
      <Navbar />

      <div className="main-layout">
        <SideBar
          selectedTruck={selectedTruck}
          visibleTrucks={visibleTrucks}
          onTruckSelect={setSelectedTruck}
          currentTime={currentTime}
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