/** Field Ledger routing: a focused investigation desk plus one public consumer verification surface. */
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import ConsumerVerification from "./pages/ConsumerVerification";
import Home from "./pages/Home";
import HandoffDesk from "./pages/HandoffDesk";
import MembershipDesk from "./pages/MembershipDesk";
import BatchRegistration from "./pages/BatchRegistration";
import EventDesk from "./pages/EventDesk";
import GovernmentCases from "./pages/GovernmentCases";
import Guidance from "./pages/Guidance";
import MemberDirectory from "./pages/MemberDirectory";
import Workspace from "./pages/Workspace";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/workspace"} component={Workspace} />
      <Route path={"/handoffs"} component={HandoffDesk} />
      <Route path={"/membership"} component={MembershipDesk} />
      <Route path={"/batches/new"} component={BatchRegistration} />
      <Route path={"/events/new"} component={EventDesk} />
      <Route path={"/cases"} component={GovernmentCases} />
      <Route path={"/guide"} component={Guidance} />
      <Route path={"/members"} component={MemberDirectory} />
      <Route path={"/verify/:batchCode"} component={ConsumerVerification} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <Router />
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
