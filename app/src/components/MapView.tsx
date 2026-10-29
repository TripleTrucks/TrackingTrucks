import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";

import "leaflet/dist/leaflet.css";

import type { Truck } from "../Home";
import { getTruckStatus, schedules } from "../truckStatus";

interface MapViewProps {
  selectedTruck: Truck | null;
  onTruckSelect: (truck: Truck) => void;
  onVisibleTrucksChange: (trucks: Truck[]) => void;
  currentTime: Date;
}

const truckFiles = import.meta.glob<Truck>(
  "../../../Database/Trucks/*.json",
  {
    eager: true,
    import: "default",
  }
);

const trucks = Object.values(truckFiles);

const truckLocations = trucks.flatMap((truck) =>
  (truck.scheduleIds ?? [])
    .map((scheduleId) =>
      schedules.find((schedule) => schedule.id === scheduleId)
    )
    .flatMap((schedule) => {
      if (!schedule) {
        return [];
      }

      const coordinates = schedule.location?.coordinates;

      if (
        typeof coordinates?.latitude !== "number" ||
        typeof coordinates.longitude !== "number" ||
        !Number.isFinite(coordinates.latitude) ||
        !Number.isFinite(coordinates.longitude)
      ) {
        return [];
      }

      return [
        {
          truck,
          schedule,
          position: [coordinates.latitude, coordinates.longitude] as [
            number,
            number,
          ],
        },
      ];
    })
);

function FitTruckLocations() {
  const map = useMap();

  useEffect(() => {
    if (truckLocations.length === 0) {
      return;
    }

    map.fitBounds(
      truckLocations.map(({ position }) => position),
      { padding: [40, 40], maxZoom: 17 }
    );
  }, [map]);

  return null;
}

function VisibleTruckReporter({
  onVisibleTrucksChange,
}: Pick<MapViewProps, "onVisibleTrucksChange">) {
  const map = useMap();

  useEffect(() => {
    const updateVisibleTrucks = () => {
      const bounds = map.getBounds();
      const center = map.getCenter();
      const nearestLocations = new Map<
        number,
        { truck: Truck; distance: number }
      >();

      for (const { truck, position } of truckLocations) {
        if (!bounds.contains(position)) {
          continue;
        }

        const distance = map.distance(center, position);
        const nearest = nearestLocations.get(truck.id);
        if (!nearest || distance < nearest.distance) {
          nearestLocations.set(truck.id, { truck, distance });
        }
      }

      const visibleTrucks = Array.from(nearestLocations.values())
        .sort((first, second) => first.distance - second.distance)
        .map(({ truck }) => truck);

      onVisibleTrucksChange(visibleTrucks);
    };

    updateVisibleTrucks();
    map.on("moveend", updateVisibleTrucks);

    return () => {
      map.off("moveend", updateVisibleTrucks);
    };
  }, [map, onVisibleTrucksChange]);

  return null;
}

function MapView({
  onTruckSelect,
  onVisibleTrucksChange,
  currentTime,
}: MapViewProps) {
  return (
    <main className="map-container">
      <MapContainer
        center={[36.3033, -82.3692]}
        zoom={17}
        style={{ height: "100%", width: "100%" }}
      >
        <FitTruckLocations />
        <VisibleTruckReporter
          onVisibleTrucksChange={onVisibleTrucksChange}
        />

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> | Powered by <a href="https://www.geoapify.com/">Geoapify</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {truckLocations.map(({ truck, schedule, position }) => (
          <Marker
            key={`${truck.id}-${schedule.id}`}
            position={position}
            eventHandlers={{
              click: () => onTruckSelect(truck),
            }}
          >
            <Popup>
              <strong>{truck.truckname}</strong>
              {schedule.location?.name && (
                <>
                  <br />
                  {schedule.location.name}
                </>
              )}
              <br />
              {truck.tags.join(" • ")}
              <br />
              {getTruckStatus(truck.scheduleIds ?? [], currentTime).name}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </main>
  );
}

export default MapView;