import AppRoutes from "../routes";
import Navbar from "./components/Navbar";

export default function App() {
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";

  return (
    <>
      <Navbar pathname={pathname} />
      <AppRoutes pathname={pathname} />
    </>
  );
}
