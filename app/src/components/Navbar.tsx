function Navbar() {
  return (
    <nav className="navbar">
      <div className="navbar-brand">
        Tracking Trucks
      </div>

      <div className="navbar-links">
        <a href="/">Home</a>
        <a href="/signin">Login</a>
      </div>
    </nav>
  );
}

export default Navbar;