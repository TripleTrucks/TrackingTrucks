import {
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import Navbar from "./components/Navbar";
import {
  createTruck,
  fetchProfiles,
  fetchSchedules,
  fetchTrucks,
} from "./schedulesApi";
import type { Profile, SocialMediaLink, Truck } from "./dataTypes";
import type { Schedule } from "./truckStatus";
import "./Home.css";
import "./AddTruckPage.css";

const templateSocialPlatforms = [
  "Facebook",
  "Instagram",
  "TikTok",
  "X",
  "YouTube",
] as const;

function AddTruckPage() {
  const [truckId, setTruckId] = useState("");
  const [truckname, setTruckname] = useState("");
  const [tags, setTags] = useState("");
  const [socialLinks, setSocialLinks] = useState<SocialMediaLink[]>(
    () =>
      templateSocialPlatforms.map((platform) => ({ platform, url: "" }))
  );
  const [profileIds, setProfileIds] = useState<number[]>([]);
  const [scheduleIds, setScheduleIds] = useState<number[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoadingOptions(true);
    setOptionsError(null);

    Promise.all([
      fetchTrucks(controller.signal),
      fetchProfiles(controller.signal),
      fetchSchedules(controller.signal),
    ])
      .then(([trucks, loadedProfiles, loadedSchedules]) => {
        const maxId = trucks.reduce(
          (maximum, truck) => Math.max(maximum, truck.id),
          0
        );
        if (maxId >= 2_147_483_647) {
          setTruckId("");
        } else {
          setTruckId(String(maxId + 1));
        }
        setProfiles(loadedProfiles);
        setSchedules(loadedSchedules);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setOptionsError(
            error instanceof Error
              ? error.message
              : "Unable to load profiles and schedules."
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingOptions(false);
        }
      });

    return () => controller.abort();
  }, [loadAttempt]);

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
    setSuccessMessage(null);
  }

  function updateSelectedIds(
    event: ChangeEvent<HTMLSelectElement>,
    update: (ids: number[]) => void
  ) {
    update(
      Array.from(event.target.selectedOptions, (option) => Number(option.value))
    );
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  async function submitTruck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const id = Number(truckId);
      if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) {
        throw new Error("Enter a positive whole-number truck ID.");
      }

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

      const draft: Truck = {
        id,
        truckname: truckname.trim(),
        tags: [
          ...new Set(tags.split(",").map((tag) => tag.trim()).filter(Boolean)),
        ],
        "social-media": socialMedia,
        profileIds,
        scheduleIds,
      };
      await createTruck(draft);
      window.location.assign("/");
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to add this truck."
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="home">
      <Navbar />
      <main className="add-truck-page">
        <header className="add-truck-header">
          <p className="add-truck-eyebrow">Truck administration</p>
          <h1>Add a truck</h1>
          <p>
            Configure every field in the truck record, including its
            associations with existing profiles and schedules.
          </p>
        </header>

        {errorMessage && (
          <p className="add-truck-message add-truck-error" role="alert">
            {errorMessage}
          </p>
        )}
        {successMessage && (
          <p className="add-truck-message add-truck-success" role="status">
            {successMessage}
          </p>
        )}

        <form className="add-truck-form" onSubmit={submitTruck}>
          <section className="add-truck-section">
            <h2>Truck details</h2>
            <label className="add-truck-field">
              <span>Truck ID</span>
              <input
                type="number"
                name="id"
                value={truckId}
                onChange={(event) => {
                  setTruckId(event.target.value);
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                min={1}
                max={2_147_483_647}
                step={1}
                required
              />
              <small>Prefilled with the next available ID; you can change it.</small>
            </label>
            <label className="add-truck-field">
              <span>Truck name</span>
              <input
                type="text"
                name="truckname"
                value={truckname}
                onChange={(event) => {
                  setTruckname(event.target.value);
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                maxLength={100}
                required
              />
            </label>
            <label className="add-truck-field">
              <span>Cuisine tags</span>
              <input
                type="text"
                name="tags"
                value={tags}
                onChange={(event) => {
                  setTags(event.target.value);
                  setErrorMessage(null);
                  setSuccessMessage(null);
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
                  onClick={() => {
                    setSocialLinks((current) =>
                      current.filter((_, linkIndex) => linkIndex !== index)
                    );
                    setErrorMessage(null);
                    setSuccessMessage(null);
                  }}
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
            {isLoadingOptions ? (
              <p className="add-truck-section-help" role="status">
                Loading available profiles and schedules…
              </p>
            ) : optionsError ? (
              <div>
                <p className="add-truck-section-help">
                  {optionsError}
                </p>
                <button
                  className="add-truck-add-link"
                  type="button"
                  onClick={() => setLoadAttempt((attempt) => attempt + 1)}
                >
                  Try loading options again
                </button>
              </div>
            ) : (
              <div className="add-truck-associations">
                <label className="add-truck-field">
                  <span>Profiles</span>
                  <select
                    multiple
                    value={profileIds.map(String)}
                    onChange={(event) =>
                      updateSelectedIds(event, setProfileIds)
                    }
                    disabled={isLoadingOptions}
                  >
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.displayname} (ID {profile.id})
                      </option>
                    ))}
                  </select>
                  <small>Select one or more profiles (Ctrl/Command-click for multiple).</small>
                </label>
                <label className="add-truck-field">
                  <span>Schedules</span>
                  <select
                    multiple
                    value={scheduleIds.map(String)}
                    onChange={(event) =>
                      updateSelectedIds(event, setScheduleIds)
                    }
                    disabled={isLoadingOptions}
                  >
                    {schedules.map((schedule) => (
                      <option key={schedule.id} value={schedule.id}>
                        {schedule.location?.name || `Schedule ${schedule.id}`} (ID{" "}
                        {schedule.id})
                      </option>
                    ))}
                  </select>
                  <small>Select one or more schedules to link to this truck.</small>
                </label>
              </div>
            )}
          </section>

          <div className="add-truck-actions">
            <a href="/">Cancel</a>
            <button
              type="submit"
              disabled={
                isSaving ||
                isLoadingOptions ||
                optionsError !== null ||
                !import.meta.env.DEV
              }
            >
              {isSaving ? "Adding truck…" : "Add truck"}
            </button>
          </div>
          {import.meta.env.DEV && (
            <p className="add-truck-dev-note">
              Local development only: this form uses the API’s development
              admin role. Production truck creation requires authenticated
              API support.
            </p>
          )}
          {!import.meta.env.DEV && (
            <p className="add-truck-dev-note">
              Truck creation is unavailable here because the production API
              does not yet provide an authenticated create operation.
            </p>
          )}
        </form>
      </main>
    </div>
  );
}

export default AddTruckPage;
