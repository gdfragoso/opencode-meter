import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useRefresh } from "@/dashboard/App";
import { useAutoRefresh } from "@/dashboard/hooks/useAutoRefresh";
import RangeSelector from "@/dashboard/components/RangeSelector";
import ProjectSelector from "@/dashboard/components/ProjectSelector";

const TABS = [
  { id: "overview", label: "Overview", theme: "cyan" as const },
  { id: "sessions", label: "Sessions", theme: "cyan" as const },
  { id: "analytics", label: "Analytics", theme: "cyan" as const },
  { id: "models", label: "Models", theme: "cyan" as const },
  { id: "cost", label: "Cost", theme: "cyan" as const },
  { id: "projects", label: "Projects", theme: "cyan" as const },
  { id: "errors", label: "Errors", theme: "danger" as const },
];

const THEME = {
  cyan: {
    active: "text-cyber-cyan border-cyber-cyan bg-cyber-cyan/10 shadow-[0_0_12px_rgba(0,255,204,0.15)]",
    inactive: "text-cyber-cyan/40 border-transparent hover:text-cyber-cyan/70 hover:border-cyber-cyan/20",
    caret: "text-cyber-cyan",
  },
  magenta: {
    active: "text-cyber-magenta border-cyber-magenta bg-cyber-magenta/10 shadow-[0_0_12px_rgba(255,0,255,0.15)]",
    inactive: "text-cyber-magenta/40 border-transparent hover:text-cyber-magenta/70 hover:border-cyber-magenta/20",
    caret: "text-cyber-magenta",
  },
  danger: {
    active: "text-cyber-danger border-cyber-danger bg-cyber-danger/10 shadow-[0_0_12px_rgba(255,68,102,0.15)]",
    inactive: "text-cyber-danger/40 border-transparent hover:text-cyber-danger/70 hover:border-cyber-danger/20",
    caret: "text-cyber-danger",
  },
};

export type TabId = (typeof TABS)[number]["id"];

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function AutoRefreshBadge() {
  const { secondsSinceUpdate, interval, setInterval: setRefreshInterval } = useAutoRefresh(30000);
  const isPaused = interval === 0;

  const options = [
    { label: "30s", value: 30000 },
    { label: "60s", value: 60000 },
    { label: "120s", value: 120000 },
    { label: "Paused", value: 0 },
  ];

  return (
    <div className="flex items-center gap-2 text-xs">
      {!isPaused && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full bg-cyber-cyan animate-pulse"
          title={`Last updated ${secondsSinceUpdate}s ago`}
          aria-label={`Last updated ${secondsSinceUpdate} seconds ago`}
        />
      )}
      <select
        value={interval}
        onChange={(e) => setRefreshInterval(Number(e.target.value))}
        aria-label="Auto-refresh interval"
        className="bg-cyber-bg border border-cyber-cyan/20 text-cyber-cyan/70 text-xs px-2 py-0.5 tracking-wider uppercase cursor-pointer focus:outline-none focus:border-cyber-cyan/50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-cyber-bg text-cyber-cyan">
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function Layout() {
  const { refresh } = useRefresh();
  const location = useLocation();
  const hiddenOn = ["/sessions/"];
  const showRange =
    !hiddenOn.some((p) => location.pathname.includes(p)) &&
    location.pathname !== "/analytics";
  const showProject = showRange;

  return (
    <div className="min-h-screen bg-cyber-bg font-[family-name:var(--font-family-mono)] flex flex-col">
      {/* Scanline overlay */}
      <div className="pointer-events-none fixed inset-0 z-50 opacity-[0.03] bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(0,0,0,0.15)_2px,rgba(0,0,0,0.15)_4px)]" />

      {/* Header (branding) — title (left) ⯯ auto-refresh + manual refresh (far right) */}
      <header className="border-b border-cyber-cyan/20 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          {/* Left: title */}
          <div className="flex items-center gap-3">
            <h1 className="text-cyber-cyan text-2xl tracking-[0.2em] uppercase">
              OpenCode Meter
            </h1>
            <span className="text-cyber-cyan text-2xl animate-pulse">
              &#9608;
            </span>
          </div>

          {/* Right: day range + auto-refresh interval + manual refresh */}
          <div className="flex items-center gap-3">
            {showRange && <RangeSelector />}
            {showProject && <ProjectSelector />}
            <AutoRefreshBadge />
            <button
              type="button"
              title="Refresh data"
              aria-label="Refresh all data"
              onClick={refresh}
              className="px-2 py-1 text-cyber-cyan/50 hover:text-cyber-cyan border border-cyber-cyan/20 hover:border-cyber-cyan/50 rounded transition-all duration-200 hover:bg-cyber-cyan/5 cursor-pointer"
            >
              <RefreshIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Controls bar: tabs + range (left) */}
      <nav
        role="tablist"
        aria-label="Dashboard sections"
        className="border-b border-cyber-cyan/10 px-6 py-3"
      >
        <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-3">
          {/* Left: tabs */}
          <div className="flex flex-wrap items-center gap-1">
            {TABS.map((tab) => {
              const theme = THEME[tab.theme];
              return (
                <NavLink
                  key={tab.id}
                  to={`/${tab.id}`}
                  end
                  role="tab"
                  aria-selected={location.pathname === `/${tab.id}` ? "true" : "false"}
                  className={({ isActive }) =>
                    `px-5 py-2 text-sm uppercase tracking-[0.15em] border transition-all duration-200 cursor-pointer ${
                      isActive ? theme.active : theme.inactive
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span className={`mr-2 ${theme.caret} animate-pulse`}>
                          &#9656;
                        </span>
                      )}
                      {tab.label}
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="flex-1 px-6 py-8">
        <div className="max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-cyber-cyan/10 px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-xs tracking-[0.1em] uppercase">
          <span className="text-cyber-cyan/50">
            System Online
            <span className="inline-block w-2 h-2 ml-2 rounded-full bg-cyber-cyan animate-pulse" />
          </span>
          <span className="text-cyber-cyan/50">All Systems Nominal</span>
        </div>
      </footer>
    </div>
  );
}
