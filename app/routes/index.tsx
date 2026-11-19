import Home from "./Home";
import ScheduleManager from "./ScheduleManager";
import OperatorRegister from "./OperatorRegister";
import Login from "./Login";
import NotFound from "./NotFound";
import AddTruckPage from "./AddTruckPage";
import EditTruckPage from "./EditTruckPage";

const routes = {
  "/": Home,
  "/schedules": ScheduleManager,
  "/signin": OperatorRegister,
  "/login": Login,
  "/trucks/new": AddTruckPage,
};

export default function AppRoutes({ pathname }: { pathname: string }) {
  const editTruckMatch = /^\/trucks\/(\d+)\/edit$/.exec(pathname);
  if (editTruckMatch) return <EditTruckPage truckId={Number(editTruckMatch[1])} />;
  const Page = Object.hasOwn(routes, pathname)
    ? routes[pathname as keyof typeof routes]
    : NotFound;
  return <Page />;
}
