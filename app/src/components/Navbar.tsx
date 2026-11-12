function Navbar() {
  const isSchedulePage = window.location.pathname === "/schedules";
  const isAddTruckPage = window.location.pathname === "/trucks/new";

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        Tracking Trucks
      </div>

      <div className="navbar-links">
        <a href="/" aria-current={!isSchedulePage ? "page" : undefined}>
          Home
        </a>
        <a
          href="/schedules"
          aria-current={isSchedulePage ? "page" : undefined}
        >
          Manage schedules
        </a>
        <a
          href="/trucks/new"
          aria-current={isAddTruckPage ? "page" : undefined}
        >
          Add truck
        </a>
        <a href="/signin">Login</a>
      </div>
    </nav>
  );
}

export default Navbar;