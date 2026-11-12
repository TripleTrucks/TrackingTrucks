import { useRef, useState, type FormEvent } from "react";
import { registerOperator } from "../src/profilesApi";
import "./auth.css";

export default function OperatorRegister() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const submitting = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const username = String(data.get("username") ?? "").trim();
    const displayname = String(data.get("displayname") ?? "").trim();
    const password = String(data.get("password") ?? "");
    setError(null);

    if (!displayname || !username || !password.trim()) {
      setError("Enter your display name, username, and password.");
      return;
    }
    if (password !== data.get("confirm-password")) {
      setError("Your passwords don’t match. Please try again.");
      const confirmation = form.elements.namedItem("confirm-password");
      if (confirmation instanceof HTMLInputElement) confirmation.focus();
      return;
    }

    submitting.current = true;
    setIsSubmitting(true);
    try {
      await registerOperator({
        username,
        displayname,
        password,
        "phone-number": String(data.get("phone-number") ?? "").trim(),
      });
      form.reset();
      setShowPassword(false);
      setIsRegistered(true);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Unable to create your account. Please try again.");
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="register-title">
        <header className="auth-header">
          <h1 id="register-title">{isRegistered ? "Account created" : "Create account"}</h1>
        </header>

        {isRegistered ? (
          <div className="auth-success" role="status">
            <p>Your profile is ready.</p>
            <a className="auth-button" href="/">Explore trucks</a>
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit} aria-busy={isSubmitting}>
            <fieldset disabled={isSubmitting}>
              <div className="auth-field-row">
                <label>
                  Display name
                  <input name="displayname" autoComplete="name" maxLength={100} required />
                </label>
                <label>
                  Username
                  <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={50} required />
                </label>
              </div>
              <label>
                <span>Phone number <span className="auth-optional">(optional)</span></span>
                <input type="tel" name="phone-number" autoComplete="tel" maxLength={30} />
              </label>
              <label>
                Password
                <span className="auth-password-field">
                  <input type={showPassword ? "text" : "password"} name="password" autoComplete="new-password" minLength={8} aria-describedby="password-hint" required />
                  <button type="button" className="auth-password-toggle" aria-label={showPassword ? "Hide passwords" : "Show passwords"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </span>
                <span id="password-hint" className="auth-field-hint">At least 8 characters.</span>
              </label>
              <label>
                Confirm password
                <input type={showPassword ? "text" : "password"} name="confirm-password" autoComplete="new-password" minLength={8} required />
              </label>
            </fieldset>
            {error && <p className="auth-message" role="alert">{error}</p>}
            <button className="auth-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating account…" : "Create account"}
            </button>
          </form>
        )}

        <footer className="auth-footer">Already have an account? <a href="/login">Log in</a></footer>
      </section>
    </main>
  );
}
