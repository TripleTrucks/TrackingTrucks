export type MapPosition = [latitude: number, longitude: number];

export interface DrivingRoute {
  positions: MapPosition[];
  distance: number;
  distanceUnits: string;
}

export const routeOrigin = {
  address: "325 Treasure Lane, Johnson City, TN 37614",
  position: [36.300969, -82.359442] as MapPosition,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCoordinatePair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function getDrivingRouteResult(body: unknown): DrivingRoute {
  if (!isRecord(body) || !Array.isArray(body.features)) {
    throw new Error("Geoapify returned an invalid routing response.");
  }

  const feature = body.features[0];
  if (!isRecord(feature) || !isRecord(feature.geometry)) {
    throw new Error("Geoapify did not return a route for this location.");
  }

  if (
    !isRecord(feature.properties) ||
    typeof feature.properties.distance !== "number" ||
    !Number.isFinite(feature.properties.distance) ||
    feature.properties.distance < 0 ||
    typeof feature.properties.distance_units !== "string"
  ) {
    throw new Error("Geoapify returned invalid route distance information.");
  }

  const { type, coordinates } = feature.geometry;
  const rawPositions =
    type === "LineString"
      ? coordinates
      : type === "MultiLineString" && Array.isArray(coordinates)
        ? coordinates.flat()
        : undefined;

  if (
    !Array.isArray(rawPositions) ||
    rawPositions.length < 2 ||
    !rawPositions.every(isCoordinatePair)
  ) {
    throw new Error("Geoapify returned invalid route coordinates.");
  }

  return {
    positions: rawPositions.map(
      ([longitude, latitude]) => [latitude, longitude]
    ),
    distance: feature.properties.distance,
    distanceUnits: feature.properties.distance_units,
  };
}

export async function getDrivingRoute(
  destination: MapPosition,
  signal: AbortSignal
): Promise<DrivingRoute> {
  const apiKey = import.meta.env.VITE_GEOAPIFY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Routing is not configured. Set VITE_GEOAPIFY_API_KEY in .env and restart the app."
    );
  }

  const [originLatitude, originLongitude] = routeOrigin.position;
  const [destinationLatitude, destinationLongitude] = destination;
  const url = new URL("https://api.geoapify.com/v1/routing");
  url.searchParams.set(
    "waypoints",
    `lonlat:${originLongitude},${originLatitude}|lonlat:${destinationLongitude},${destinationLatitude}`
  );
  url.searchParams.set("mode", "drive");
  url.searchParams.set("format", "geojson");
  url.searchParams.set("units", "imperial");
  url.searchParams.set("apiKey", apiKey);

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Geoapify routing failed (HTTP ${response.status}).`);
  }

  return getDrivingRouteResult(await response.json());
}
