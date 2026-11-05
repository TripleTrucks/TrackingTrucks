import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import IndexRoute from "../routes/index";
import ScheduleManager from "./ScheduleManager";
import SignInPage from "./SignInPage";
import "./index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing application root.");
}

createRoot(root).render(
  <StrictMode>
    {window.location.pathname === "/" ? <IndexRoute /> : null}
    {window.location.pathname === "/schedules" ? <ScheduleManager /> : null}
    {window.location.pathname !== "/" &&
    window.location.pathname !== "/schedules" ? (
    {window.location.pathname === "/" ? (
      <IndexRoute />
    ) : window.location.pathname === "/signin" ? (
      <SignInPage />
    ) : (
      <main className="home">
        <h1>Page not found.</h1>
        <a href="/">Back to TrackingTrucks</a>
      </main>
    ) : null}
  </StrictMode>
);
