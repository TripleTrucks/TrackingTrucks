import { useEffect, useState } from "react";
import { getCurrentAccount, logout, type Account } from "../profilesApi";
import "./Navbar.css";

function Navbar({ pathname }: { pathname: string }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getCurrentAccount(controller.signal)
      .then(setAccount)
      .catch(() => {
        if (!controller.signal.aborted) setAccount(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCheckingSession(false);
      });
    return () => controller.abort();
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    setError(null);
    try {
      await logout();
      window.location.assign("/login");
    } catch {
      setError("Couldn’t log out. Try again.");
      setLoggingOut(false);
    }
  }

  return (
    <nav className="navbar" aria-label="Main navigation">
      <a className="navbar-brand" href="/">
        <span className="navbar-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h11v11H3zM14 10h4l3 4v3h-7" />
            <path d="M14 14h7" />
            <circle cx="7" cy="18" r="2" />
            <circle cx="18" cy="18" r="2" />
          </svg>
        </span>
        <span>Tracking Trucks</span>
      </a>

      <div className="navbar-links">
        <a href="/" aria-current={pathname === "/" ? "page" : undefined}>
          Home
        </a>
        <a
          href="/schedules"
          aria-current={pathname === "/schedules" ? "page" : undefined}
        >
          Schedules
        </a>
        <a href="/trucks/new" aria-current={pathname === "/trucks/new" ? "page" : undefined}>Add truck</a>
        {checkingSession ? (
          <span className="navbar-account" role="status" aria-label="Checking session">…</span>
        ) : account ? (
          <div className="navbar-session">
            <span className="navbar-account" title={account.displayname}>{account.displayname}</span>
            <button className="navbar-login" onClick={handleLogout} disabled={loggingOut}>
              {loggingOut ? "Logging out…" : "Log out"}
            </button>
            {error && <p className="navbar-error" role="alert">{error}</p>}
          </div>
        ) : (
          <a className="navbar-login" href="/login" aria-current={pathname === "/login" ? "page" : undefined}>Login</a>
        )}
      </div>
    </nav>
  );
}

export default Navbar;
