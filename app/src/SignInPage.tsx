import { useState, type FormEvent } from "react";
import "./SignInPage.css";

function SigninPage() {
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const formData = new FormData(event.currentTarget);
    const username = formData.get("username");
    const password = formData.get("password");

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (response.status === 401) {
        setError("Username or password is incorrect.");
        return;
      }

      if (!response.ok) {
        setError(`Sign-in failed (HTTP ${response.status}).`);
        return;
      }

      window.location.assign("/");
    } catch {
      setError("Could not reach the sign-in service. Check that the backend is running.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="sign-in-page">
      <h1>Login</h1>

      <form onSubmit={handleSubmit}>
        <label>
          Username
          <input
            type="text"
            name="username"
            autoComplete="username"
            required
          />
        </label>

        <label>
          Password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
          />
        </label>

        {error && <p role="alert">{error}</p>}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Signing In..." : "Sign In"}
        </button>
      </form>

      <a href="/">Back to TrackingTrucks</a>
    </main>
  );
}

export default SigninPage;