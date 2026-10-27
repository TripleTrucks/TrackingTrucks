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
import { getTruckStatus } from "../truckStatus";

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

const truckPositions: Record<number, [number, number]> = {
  1: [36.3033, -82.3692],
};

function VisibleTruckReporter({
  onVisibleTrucksChange,
}: Pick<MapViewProps, "onVisibleTrucksChange">) {
  const map = useMap();

  useEffect(() => {
    const updateVisibleTrucks = () => {
      const bounds = map.getBounds();
      const center = map.getCenter();
      const visibleTrucks = trucks
        .flatMap((truck) => {
          const position = truckPositions[truck.id];

          if (!position || !bounds.contains(position)) {
            return [];
          }

          return [{ truck, distance: map.distance(center, position) }];
        })
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
  const center: [number, number] = [36.3033, -82.3692];

  return (
    <main className="map-container">
      <MapContainer
        center={center}
        zoom={17}
        style={{ height: "100%", width: "100%" }}
      >
        <VisibleTruckReporter
          onVisibleTrucksChange={onVisibleTrucksChange}
        />

        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {trucks.map((truck) => {
          const position = truckPositions[truck.id];

          if (!position) {
            return null;
          }

          return (
            <Marker
              key={truck.id}
              position={position}
              eventHandlers={{
                click: () => onTruckSelect(truck),
              }}
            >
              <Popup>
                <strong>{truck.truckname}</strong>
                <br />
                {truck.tags.join(" • ")}
                <br />
                {getTruckStatus(truck.scheduleIds ?? [], currentTime).name}
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </main>
  );
}

export default MapView;