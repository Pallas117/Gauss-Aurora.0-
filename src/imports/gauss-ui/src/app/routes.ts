import { createBrowserRouter } from "react-router";
import { Layout } from "./layout";
import { CommandPage } from "./pages/CommandPage";
import { SDAPage } from "./pages/SDAPage";
import { AutomationPage } from "./pages/AutomationPage";
import { IntelPage } from "./pages/IntelPage";
import { ChronosPage } from "./pages/ChronosPage";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: CommandPage },
      { path: "sda", Component: SDAPage },
      { path: "automation", Component: AutomationPage },
      { path: "intel", Component: IntelPage },
      { path: "chronos", Component: ChronosPage },
      { path: "*", Component: CommandPage },
    ],
  },
]);
