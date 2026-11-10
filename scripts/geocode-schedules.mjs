import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const schedulesDirectory = path.join(
  repositoryRoot,
  "Database",
  "Schedules"
);
const apiKey = process.env.GEOAPIFY_API_KEY?.trim();

if (!apiKey) {
  throw new Error(
    "GEOAPIFY_API_KEY is missing. Add it to the ignored .env file."
  );
}

function getAddress(location) {
  const address = location?.address_components;
  if (!address) {
    return "";
  }

  return [
    address.street_address,
    address.city,
    address.state_province,
    address.postal_code,
    address.country,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
}

function getCoordinates(responseBody) {
  const featureCoordinates = responseBody.features?.[0]?.geometry?.coordinates;
  if (Array.isArray(featureCoordinates)) {
    const [longitude, latitude] = featureCoordinates;
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { latitude, longitude };
    }
  }

  const result = responseBody.results?.[0];
  if (Number.isFinite(result?.lat) && Number.isFinite(result?.lon)) {
    return { latitude: result.lat, longitude: result.lon };
  }

  return undefined;
}

async function geocode(address) {
  const url = new URL("https://api.geoapify.com/v1/geocode/search");
  url.searchParams.set("text", address);
  url.searchParams.set("limit", "1");
  url.searchParams.set("apiKey", apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Geoapify request failed with HTTP ${response.status}.`);
  }

  const responseBody = await response.json();
  const coordinates = getCoordinates(responseBody);
  if (!coordinates) {
    throw new Error(`Geoapify returned no coordinates for "${address}".`);
  }

  if (
    coordinates.latitude < -90 ||
    coordinates.latitude > 90 ||
    coordinates.longitude < -180 ||
    coordinates.longitude > 180
  ) {
    throw new Error(`Geoapify returned invalid coordinates for "${address}".`);
  }

  return coordinates;
}

const scheduleFiles = (await readdir(schedulesDirectory))
  .filter(
    (fileName) =>
      fileName.endsWith(".json") &&
      fileName.toLowerCase() !== "template.json"
  )
  .sort();
let geocodedCount = 0;
let skippedCount = 0;

for (const fileName of scheduleFiles) {
  const filePath = path.join(schedulesDirectory, fileName);
  const schedule = JSON.parse(await readFile(filePath, "utf8"));
  const location = schedule.location;
  const address = getAddress(location);

  if (!address) {
    console.warn(`Skipping ${fileName}: no address components.`);
    skippedCount += 1;
    continue;
  }

  const coordinates = location.coordinates;
  if (
    coordinates &&
    location.geocodedAddress === address &&
    Number.isFinite(coordinates.latitude) &&
    Number.isFinite(coordinates.longitude)
  ) {
    console.log(`Already geocoded: ${fileName}`);
    skippedCount += 1;
    continue;
  }

  if (geocodedCount > 0) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const result = await geocode(address);
  location.coordinates = result;
  location.geocodedAddress = address;
  await writeFile(filePath, `${JSON.stringify(schedule, null, 2)}\n`);

  geocodedCount += 1;
  console.log(
    `Geocoded ${fileName}: ${result.latitude}, ${result.longitude}`
  );
}

console.log(
  `Finished: ${geocodedCount} geocoded, ${skippedCount} skipped across ${scheduleFiles.length} schedule files.`
);
