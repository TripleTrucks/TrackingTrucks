import {
  useEffect,
  useState,
  type FormEvent,
} from "react";
import Navbar from "./components/Navbar";
import { fetchProfiles, fetchSchedules, fetchTrucks, updateTruck } from "./schedulesApi";
import type { Profile, SocialMediaLink, Truck } from "./dataTypes";
import type { Schedule } from "./truckStatus";
import "./Home.css";
import "./AddTruckPage.css";

interface EditTruckPageProps {
  truckId: number;
}

const templateSocialPlatforms = [
  "Facebook",
  "Instagram",
  "TikTok",
  "X",
  "YouTube",
] as const;

function EditTruckPage({ truckId }: EditTruckPageProps) {
  const [truck, setTruck] = useState<Truck | null>(null);
  const [truckname, setTruckname] = useState("");
  const [tags, setTags] = useState("");
  const [socialLinks, setSocialLinks] = useState<SocialMediaLink[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setLoadError(null);

    Promise.all([
      fetchTrucks(controller.signal),
      fetchProfiles(controller.signal),
      fetchSchedules(controller.signal),
    ])
      .then(([trucks, loadedProfiles, loadedSchedules]) => {
        const loadedTruck = trucks.find((candidate) => candidate.id === truckId);
        if (loadedTruck) {
          setTruck(loadedTruck);
          setTruckname(loadedTruck.truckname);
          setTags(loadedTruck.tags.join(", "));
          setSocialLinks(
            loadedTruck["social-media"]?.length
              ? loadedTruck["social-media"]
              : templateSocialPlatforms.map((platform) => ({ platform, url: "" }))
          );
        }
        setProfiles(loadedProfiles);
        setSchedules(loadedSchedules);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(
            error instanceof Error ? error.message : "Unable to load this truck."
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [loadAttempt, truckId]);

  function updateSocialLink(
    index: number,
    property: keyof SocialMediaLink,
    value: string
  ) {
    setSocialLinks((current) =>
      current.map((link, linkIndex) =>
        linkIndex === index ? { ...link, [property]: value } : link
      )
    );
    setErrorMessage(null);
  }

  async function submitTruck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!truck) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const socialMedia: SocialMediaLink[] = socialLinks.flatMap((link) => {
        const platform = link.platform.trim();
        const url = link.url.trim();
        if (!url) {
          return [];
        }
        if (!platform) {
          throw new Error("Each social media URL needs a platform.");
        }
        return [{ platform, url }];
      });

      await updateTruck({
        ...truck,
        truckname: truckname.trim(),
        tags: [...new Set(tags.split(",").map((tag) => tag.trim()).filter(Boolean))],
        "social-media": socialMedia,
      });
      window.location.assign("/");
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to update this truck."
      );
    } finally {
      setIsSaving(false);
    }
  }

  const truckProfiles = (truck?.profileIds ?? [])
    .map((id) => profiles.find((profile) => profile.id === id))
    .filter((profile): profile is Profile => profile !== undefined);
  const truckSchedules = (truck?.scheduleIds ?? [])
    .map((id) => schedules.find((schedule) => schedule.id === id))
    .filter((schedule): schedule is Schedule => schedule !== undefined);

  return (
    <div className="home">
      <Navbar />
      <main className="add-truck-page">
        <header className="add-truck-header">
          <p className="add-truck-eyebrow">Truck administration</p>
          <h1>Edit truck</h1>
          <p>Update the truck’s name, cuisine tags, and social media links.</p>
        </header>

        {isLoading ? (
          <p className="add-truck-message" role="status">Loading truck details…</p>
        ) : loadError ? (
          <div className="add-truck-message add-truck-error" role="alert">
            <p>{loadError}</p>
            <button
              className="add-truck-add-link"
              type="button"
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            >
              Try again
            </button>
          </div>
        ) : !truck ? (
          <div className="add-truck-message add-truck-error" role="alert">
            Truck {truckId} was not found. <a href="/">Back to trucks</a>
          </div>
        ) : (
          <>
            {errorMessage && (
              <p className="add-truck-message add-truck-error" role="alert">
                {errorMessage}
              </p>
            )}

            <form className="add-truck-form" onSubmit={submitTruck}>
              <section className="add-truck-section">
                <h2>Truck details</h2>
                <label className="add-truck-field">
                  <span>Truck ID</span>
                  <input type="number" value={truck.id} readOnly />
                </label>
                <label className="add-truck-field">
                  <span>Truck name</span>
                  <input
                    type="text"
                    value={truckname}
                    onChange={(event) => {
                      setTruckname(event.target.value);
                      setErrorMessage(null);
                    }}
                    maxLength={100}
                    required
                  />
                </label>
                <label className="add-truck-field">
                  <span>Cuisine tags</span>
                  <input
                    type="text"
                    value={tags}
                    onChange={(event) => {
                      setTags(event.target.value);
                      setErrorMessage(null);
                    }}
                    placeholder="For example: Mexican, Tacos"
                  />
                  <small>Separate multiple tags with commas.</small>
                </label>
              </section>

              <section className="add-truck-section">
                <h2>Social media</h2>
                <p className="add-truck-section-help">
                  Configure the platform and URL for each link.
                </p>
                {socialLinks.map((link, index) => (
                  <div className="add-truck-social-row" key={index}>
                    <label className="add-truck-field">
                      <span>Platform</span>
                      <input
                        type="text"
                        value={link.platform}
                        onChange={(event) =>
                          updateSocialLink(index, "platform", event.target.value)
                        }
                        maxLength={50}
                        placeholder="For example, Instagram"
                        required={Boolean(link.url)}
                      />
                    </label>
                    <label className="add-truck-field">
                      <span>URL</span>
                      <input
                        type="url"
                        value={link.url}
                        onChange={(event) =>
                          updateSocialLink(index, "url", event.target.value)
                        }
                        placeholder="https://"
                      />
                    </label>
                    <button
                      type="button"
                      className="add-truck-remove-link"
                      aria-label={`Remove ${link.platform || "social media"} link`}
                      onClick={() =>
                        setSocialLinks((current) =>
                          current.filter((_, linkIndex) => linkIndex !== index)
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  className="add-truck-add-link"
                  type="button"
                  onClick={() =>
                    setSocialLinks((current) => [
                      ...current,
                      { platform: "", url: "" },
                    ])
                  }
                >
                  Add social link
                </button>
              </section>

              <section className="add-truck-section">
                <h2>Associations</h2>
                <p className="add-truck-section-help">
                  Profile and schedule associations remain unchanged when you save.
                </p>
                <div className="add-truck-associations">
                  <div className="add-truck-field">
                    <span>Profiles</span>
                    <p>
                      {truckProfiles.length
                        ? truckProfiles.map((profile) => profile.displayname).join(", ")
                        : "None"}
                    </p>
                  </div>
                  <div className="add-truck-field">
                    <span>Schedules</span>
                    <p>
                      {truckSchedules.length
                        ? truckSchedules
                            .map((schedule) => schedule.location?.name || `Schedule ${schedule.id}`)
                            .join(", ")
                        : "None"}
                    </p>
                  </div>
                </div>
              </section>

              <div className="add-truck-actions">
                <a href="/">Cancel</a>
                <button
                  type="submit"
                  disabled={isSaving || !import.meta.env.DEV}
                >
                  {isSaving ? "Saving changes…" : "Save changes"}
                </button>
              </div>
              {!import.meta.env.DEV && (
                <p className="add-truck-dev-note">
                  Truck updates are unavailable here because the production API
                  does not yet provide an authenticated update operation.
                </p>
              )}
            </form>
          </>
        )}
      </main>
    </div>
  );
}

export default EditTruckPage;
