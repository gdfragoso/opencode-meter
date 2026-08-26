import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import Layout from "./components/Layout";
import OverviewTab from "./components/OverviewTab";
import SessionsTab from "./components/SessionsTab";
import SessionDetail from "./components/SessionDetail";
import AnalyticsTab from "./components/AnalyticsTab";
import ModelsTab from "./components/ModelsTab";
import CostTab from "./components/CostTab";
import ProjectsTab from "./components/ProjectsTab";
import ProjectDetail from "./components/ProjectDetail";
import ErrorsTab from "./components/ErrorsTab";

/* ── refresh context ─────────────────────────────────────────────────── */

interface RefreshCtx {
  refreshKey: number;
  refresh: () => void;
}

const RefreshContext = createContext<RefreshCtx | null>(null);

export function useRefresh(): RefreshCtx {
  const ctx = useContext(RefreshContext);
  if (!ctx) {
    throw new Error("useRefresh must be used within a RefreshProvider");
  }
  return ctx;
}

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  // Memoised: a fresh object here re-renders every consumer of the context on
  // every render of this provider, which is the whole tree.
  const value = useMemo(() => ({ refreshKey, refresh }), [refreshKey, refresh]);
  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
}

/* ── range context ───────────────────────────────────────────────────── */

interface RangeCtx {
  days: number;
  setDays: (days: number) => void;
}

const RangeContext = createContext<RangeCtx>({ days: 0, setDays: () => {} });

export function useRange(): RangeCtx {
  return useContext(RangeContext);
}

export function RangeProvider({ children }: { children: ReactNode }) {
  const [days, setDays] = useState(7);
  const value = useMemo(() => ({ days, setDays }), [days]);
  return <RangeContext.Provider value={value}>{children}</RangeContext.Provider>;
}

/* ── project context ────────────────────────────────────────────────── */

interface ProjectCtx {
  project: string | null;
  branch: string | null;
  setProject: (p: string | null) => void;
  setBranch: (b: string | null) => void;
}

const ProjectContext = createContext<ProjectCtx>({
  project: null,
  branch: null,
  setProject: () => {},
  setBranch: () => {},
});

export function useProject(): ProjectCtx {
  return useContext(ProjectContext);
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProjectState] = useState<string | null>(null);
  const [branch, setBranch] = useState<string | null>(null);

  // Picking a project clears the branch: a branch only means something within
  // the project it belongs to.
  const setProject = useCallback((p: string | null) => {
    setProjectState(p);
    setBranch(null);
  }, []);

  const value = useMemo(
    () => ({ project, branch, setProject, setBranch }),
    [project, branch, setProject],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

/* ── App ─────────────────────────────────────────────────────────────── */

export default function App() {
  return (
    <RefreshProvider>
      <ProjectProvider>
        <RangeProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route
                  path="/"
                  element={<Navigate to="/overview" replace />}
                />
                <Route path="/overview" element={<OverviewTab />} />
                <Route path="/sessions" element={<SessionsTab />} />
                <Route
                  path="/sessions/:id"
                  element={<SessionDetail />}
                />
                <Route path="/analytics" element={<AnalyticsTab />} />
                <Route path="/models" element={<ModelsTab />} />
                <Route path="/cost" element={<CostTab />} />
                <Route path="/projects" element={<ProjectsTab />} />
                <Route
                  path="/projects/:directory"
                  element={<ProjectDetail />}
                />
                <Route path="/errors" element={<ErrorsTab />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </RangeProvider>
      </ProjectProvider>
    </RefreshProvider>
  );
}
