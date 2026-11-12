import { useRef, useState, type FormEvent } from "react";
import { login } from "../src/profilesApi";
import "./auth.css";

export default function Login() {
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitting = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setMessage(null);
    submitting.current = true;
    setIsSubmitting(true);
    try {
      await login({
        username: String(data.get("username") ?? "").trim(),
        password: String(data.get("password") ?? ""),
      });
      form.reset();
      window.location.assign("/");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card auth-card-login" aria-labelledby="login-title">
        <header className="auth-header">
          <h1 id="login-title">Login</h1>
        </header>
        <form className="auth-form" onSubmit={handleSubmit} aria-busy={isSubmitting}>
          <fieldset disabled={isSubmitting}>
          <label>
            Username
            <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={50} required />
          </label>
          <label>
            Password
            <input type="password" name="password" autoComplete="current-password" required />
          </label>
          </fieldset>
          {message && <p className="auth-message" role="alert">{message}</p>}
          <button className="auth-button" type="submit" disabled={isSubmitting}>{isSubmitting ? "Signing in…" : "Sign in"}</button>
        </form>
        <footer className="auth-footer"><a href="/signin">Register as an operator</a></footer>
      </section>
    </main>
  );
}
