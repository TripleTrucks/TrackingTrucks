import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
} from "react-leaflet";

import "leaflet/dist/leaflet.css";

import type { Truck } from "../Home";

interface MapViewProps {
  selectedTruck: Truck | null;
  onTruckSelect: (truck: Truck) => void;
}

const truckFiles = import.meta.glob(
  "../../Database/Trucks/*.json",
  {
    eager: true,
    import: "default",
  }
);

const trucks = Object.values(truckFiles) as Truck[];

const truckPositions: Record<number, [number, number]> = {
  1: [36.3134, -82.3535],
  2: [36.3182, -82.3651],
  3: [36.3058, -82.3472],
};

function MapView({
  onTruckSelect,
}: MapViewProps) {
  const center: [number, number] = [36.3033, -82.3692];

  return (
    <main className="map-container">
      <MapContainer
        center={center}
        zoom={17}
        style={{ height: "100%", width: "100%" }}
      >
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
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </main>
  );
}

export default MapView;