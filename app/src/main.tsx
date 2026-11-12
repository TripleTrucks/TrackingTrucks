import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import IndexRoute from "../routes/index";
import ScheduleManager from "./ScheduleManager";
import SignInPage from "./SignInPage";
import AddTruckPage from "./AddTruckPage";
import EditTruckPage from "./EditTruckPage";
import "./index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing application root.");
}

const editTruckMatch = /^\/trucks\/(\d+)\/edit$/.exec(window.location.pathname);

createRoot(root).render(
  <StrictMode>
    {window.location.pathname === "/" ? (
      <IndexRoute />
    ) : window.location.pathname === "/schedules" ? (
      <ScheduleManager />
    ) : window.location.pathname === "/trucks/new" ? (
      <AddTruckPage />
    ) : editTruckMatch ? (
      <EditTruckPage truckId={Number(editTruckMatch[1])} />
    ) : window.location.pathname === "/signin" ? (
      <SignInPage />
    ) : (
      <main className="home">
        <h1>Page not found.</h1>
        <a href="/">Back to TrackingTrucks</a>
      </main>
    )}
  </StrictMode>
);
