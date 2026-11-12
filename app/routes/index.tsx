import Home from "./Home";
import ScheduleManager from "./ScheduleManager";
import OperatorRegister from "./OperatorRegister";
import Login from "./Login";
import NotFound from "./NotFound";

const routes = {
  "/": Home,
  "/schedules": ScheduleManager,
  "/signin": OperatorRegister,
  "/login": Login,
};

export default function AppRoutes({ pathname }: { pathname: string }) {
  const Page = Object.hasOwn(routes, pathname)
    ? routes[pathname as keyof typeof routes]
    : NotFound;
  return <Page />;
}
