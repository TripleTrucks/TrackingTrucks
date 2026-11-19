import { useRef, useState, type FormEvent } from "react";
import {
  getOwnProfile,
  login,
  updateOwnProfile,
  type OwnProfile,
} from "../src/profilesApi";
import "./auth.css";
import "./ProfileEditPage.css";

function notifyAccountUpdated() {
  window.dispatchEvent(new Event("trackingtrucks:account-updated"));
}

export default function ProfileEditPage() {
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [username, setUsername] = useState("");
  const [displayname, setDisplayname] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [role, setRole] = useState<OwnProfile["role"]>("user");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const submitting = useRef(false);

  async function handleAuthenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;

    const data = new FormData(event.currentTarget);
    setError(null);
    setIsSubmitting(true);
    submitting.current = true;
    try {
      await login({
        username: String(data.get("username") ?? "").trim(),
        password: String(data.get("password") ?? ""),
      });
      const ownProfile = await getOwnProfile();
      setProfile(ownProfile);
      setUsername(ownProfile.username);
      setDisplayname(ownProfile.displayname);
      setPhoneNumber(ownProfile["phone-number"]);
      setRole(ownProfile.role);
      notifyAccountUpdated();
    } catch (submitError: unknown) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to verify your account."
      );
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || submitting.current) return;

    setError(null);
    setSuccess(null);
    setIsSubmitting(true);
    submitting.current = true;
    try {
      const updatedProfile = await updateOwnProfile({
        currentPassword,
        username,
        displayname,
        "phone-number": phoneNumber,
        "new-password": newPassword,
        "confirm-new-password": confirmNewPassword,
        role,
      });
      setProfile(updatedProfile);
      setUsername(updatedProfile.username);
      setDisplayname(updatedProfile.displayname);
      setPhoneNumber(updatedProfile["phone-number"]);
      setRole(updatedProfile.role);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setSuccess("Your profile has been updated.");
      notifyAccountUpdated();
    } catch (submitError: unknown) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to update your profile."
      );
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page profile-edit-page">
      <section className="auth-card" aria-labelledby="profile-edit-title">
        <header className="auth-header">
          <h1 id="profile-edit-title">Edit operator profile</h1>
          <p>
            Update your public-facing account details. Your profile ID and
            assigned trucks are protected.
          </p>
        </header>

        {!profile ? (
          <form
            className="auth-form"
            onSubmit={handleAuthenticate}
            aria-busy={isSubmitting}
          >
            <p className="profile-edit-help">
              Verify with your existing username and password to load your
              profile.
            </p>
            <fieldset disabled={isSubmitting}>
              <label>
                Username
                <input
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={50}
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  maxLength={1024}
                  required
                />
              </label>
            </fieldset>
            {error && <p className="auth-message" role="alert">{error}</p>}
            <button className="auth-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Verifying…" : "Verify and continue"}
            </button>
          </form>
        ) : (
          <form
            className="auth-form"
            onSubmit={handleSave}
            aria-busy={isSubmitting}
          >
            <fieldset disabled={isSubmitting}>
              <label>
                Profile ID
                <input value={profile.id} readOnly aria-readonly="true" />
                <span className="auth-field-hint">Protected system identifier.</span>
              </label>
              <label>
                Assigned truck IDs
                <input
                  value={profile.truckIds.join(", ") || "No trucks assigned"}
                  readOnly
                  aria-readonly="true"
                />
                <span className="auth-field-hint">Truck assignments are managed separately.</span>
              </label>
              <label>
                Username
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={50}
                  required
                />
              </label>
              <label>
                Display name
                <input
                  value={displayname}
                  onChange={(event) => setDisplayname(event.target.value)}
                  autoComplete="name"
                  maxLength={100}
                  required
                />
              </label>
              <label>
                Phone number
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(event) => setPhoneNumber(event.target.value)}
                  autoComplete="tel"
                  maxLength={30}
                />
              </label>
              <label>
                Role
                {profile.role === "admin" ? (
                  <>
                    <input value="Administrator (admin-managed)" readOnly aria-readonly="true" />
                    <span className="auth-field-hint">Administrator roles cannot be changed here.</span>
                  </>
                ) : (
                  <>
                    <select
                      value={role}
                      onChange={(event) => {
                        if (
                          event.target.value === "user" ||
                          event.target.value === "owner"
                        ) {
                          setRole(event.target.value);
                        }
                      }}
                    >
                      <option value="user">User</option>
                      <option value="owner" disabled={profile.truckIds.length === 0}>
                        Owner
                      </option>
                    </select>
                    {profile.truckIds.length === 0 && (
                      <span className="auth-field-hint">
                        An assigned truck is required to become an owner.
                      </span>
                    )}
                  </>
                )}
              </label>
              <label>
                Current password
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  maxLength={1024}
                  required
                />
                <span className="auth-field-hint">
                  Confirm your identity before saving profile changes.
                </span>
              </label>
              <label>
                New password <span className="auth-optional">(optional)</span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={1024}
                />
                <span className="auth-field-hint">
                  Leave blank to keep your current password.
                </span>
              </label>
              <label>
                Confirm new password
                <input
                  type="password"
                  value={confirmNewPassword}
                  onChange={(event) => setConfirmNewPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={1024}
                />
              </label>
            </fieldset>
            {error && <p className="auth-message" role="alert">{error}</p>}
            {success && <p className="auth-message profile-edit-success" role="status">{success}</p>}
            <button className="auth-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save profile"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
