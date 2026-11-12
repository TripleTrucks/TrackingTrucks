import "./Navbar.css";

function Navbar({ pathname }: { pathname: string }) {
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
        <a className="navbar-login" href="/login" aria-current={pathname === "/login" ? "page" : undefined}>Login</a>
      </div>
    </nav>
  );
}

export default Navbar;
