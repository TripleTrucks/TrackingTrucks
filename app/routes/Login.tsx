import { useState } from "react";
import "./auth.css";

export default function Login() {
  const [message, setMessage] = useState<string | null>(null);

  return (
    <main className="auth-page">
      <section className="auth-card auth-card-login" aria-labelledby="login-title">
        <header className="auth-header">
          <h1 id="login-title">Login</h1>
        </header>
        <form className="auth-form" onSubmit={(event) => {
          event.preventDefault();
          setMessage("Login isn’t available yet.");
        }}>
          <label>
            Email
            <input type="email" name="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input type="password" name="password" autoComplete="current-password" required />
          </label>
          {message && <p className="auth-message" role="status">{message}</p>}
          <button className="auth-button" type="submit">Sign in</button>
        </form>
        <footer className="auth-footer"><a href="/signin">Register as an operator</a></footer>
      </section>
    </main>
  );
}
