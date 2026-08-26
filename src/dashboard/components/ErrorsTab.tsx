import { useMemo, useState } from "react";
import { Doughnut, Line } from "react-chartjs-2";
import { Link } from "react-router-dom";
import { useProject, useRefresh, useRange } from "@/dashboard/App";
import { useApi } from "@/dashboard/hooks/useApi";
import KPICard from "@/dashboard/components/KPICard";
import { Section, LoadingPlaceholder, EmptyState } from "@/dashboard/components/ui";
import { fmtTime } from "@/dashboard/lib/format";
import { bg, chartColors, cyan, danger, magenta } from "@/dashboard/lib/colors";
import type { ErrorsResponse } from "@/data/domain/errors";

function formatTypeLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatShortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/* ── base chart option factory (mirrors AnalyticsTab) ─────────────────── */

function baseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: chartColors.color,
          font: { family: "'Share Tech Mono', monospace", size: 11 },
          boxWidth: 12,
          boxHeight: 2,
        },
      },
      tooltip: {
        backgroundColor: bg,
        titleColor: cyan,
        bodyColor: chartColors.color,
        borderColor: cyan,
        borderWidth: 1,
        bodyFont: { family: "'Share Tech Mono', monospace" },
      },
    },
    scales: {
      x: {
        grid: { color: chartColors.scale.grid.color },
        ticks: { color: chartColors.scale.ticks.color, font: { size: 10 } },
      },
      y: {
        grid: { color: chartColors.scale.grid.color },
        ticks: { color: chartColors.scale.ticks.color, font: { size: 10 } },
        beginAtZero: true,
      },
    },
  } as const;
}

function lineDataset(label: string, color: string, data: number[], fillAlpha = 0.08) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: `${color}${Math.round(fillAlpha * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase()}`,
    pointBackgroundColor: color,
    pointBorderColor: color,
    pointRadius: 2,
    pointHoverRadius: 4,
    tension: 0.3,
    fill: true,
    borderWidth: 1.5,
  };
}

/* ── chart color palette ──────────────────────────────────────────────── */

const DOUGHNUT_COLORS = [
  cyan,
  magenta,
  danger,
  "#00aaff",
  "#ffcc00",
  "#9966ff",
  "#66ff99",
];

/* ── chart sub-components ─────────────────────────────────────────────── */

function ErrorsByTypeChart({ byType }: { byType: Record<string, number> }) {
  const { chartData, options } = useMemo(() => {
    const entries = Object.entries(byType)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);

    return {
      chartData: {
        labels: entries.map(([key, count]) => `${formatTypeLabel(key)} (${count})`),
        datasets: [
          {
            data: entries.map(([, count]) => count),
            backgroundColor: entries.map(
              (_, i) => DOUGHNUT_COLORS[i % DOUGHNUT_COLORS.length]
            ),
            borderColor: bg,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom" as const,
            labels: {
              color: chartColors.color,
              font: { family: "'Share Tech Mono', monospace", size: 11 },
              boxWidth: 12,
              boxHeight: 2,
            },
          },
          tooltip: {
            backgroundColor: bg,
            titleColor: magenta,
            bodyColor: chartColors.color,
            borderColor: magenta,
            borderWidth: 1,
            bodyFont: { family: "'Share Tech Mono', monospace" },
          },
        },
      },
    };
  }, [byType]);

  if (chartData.labels.length === 0) return null;

  return (
    <Section title="Errors by Type">
      <div className="h-[240px]">
        <Doughnut data={chartData} options={options} />
      </div>
    </Section>
  );
}

function ErrorsDailyLine({ data }: { data: { date: string; count: number }[] }) {
  const chartData = useMemo(
    () => ({
      labels: data.map((d) => formatShortDate(d.date)),
      datasets: [lineDataset("Errors", danger, data.map((d) => d.count), 0.1)],
    }),
    [data],
  );

  const options = useMemo(() => {
    const opts = baseOptions();
    return {
      ...opts,
      scales: {
        ...opts.scales,
        x: {
          ...opts.scales.x,
          title: {
            display: true,
            text: "Date",
            color: chartColors.color,
            font: { family: "'Share Tech Mono', monospace", size: 11 },
          },
        },
        y: {
          ...opts.scales.y,
          title: {
            display: true,
            text: "Errors",
            color: chartColors.color,
            font: { family: "'Share Tech Mono', monospace", size: 11 },
          },
        },
      },
    };
  }, []);

  return (
    <Section
      title="Errors / Day"
      meta={`${data.reduce((sum, d) => sum + d.count, 0)} total`}
    >
      <div className="h-[200px]">
        <Line data={chartData} options={options} />
      </div>
    </Section>
  );
}

interface ErrorRowProps {
  error: ErrorsResponse["errors"][number];
  isExpanded: boolean;
  onToggle: () => void;
}

function ErrorRow({ error, isExpanded, onToggle }: ErrorRowProps) {
  const [copied, setCopied] = useState(false);

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(error.error_message ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // noop
    }
  };

  return (
    <div className="border-b border-cyber-danger/10">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left py-3 px-4 flex items-center justify-between hover:bg-cyber-danger/5 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-4 overflow-hidden">
          <span className="text-cyber-danger/70 text-xs uppercase tracking-wider min-w-[100px]">
            {error.error_type ?? "unknown"}
          </span>
          <span className="text-cyber-danger/50 text-xs">
            {fmtTime(error.started_at)}
          </span>
          <span className="text-cyber-danger/80 text-sm truncate">
            {error.error_message ?? "No message"}
          </span>
        </div>
        <span
          className={`text-cyber-danger/50 text-xs transition-transform ${
            isExpanded ? "rotate-90" : ""
          }`}
        >
          &#9656;
        </span>
      </button>
      {error.session_id ? (
        <Link
          to={`/sessions/${error.session_id}`}
          className="block px-4 pb-2 text-cyber-cyan/60 hover:text-cyber-cyan text-xs truncate underline-offset-2 hover:underline"
        >
          {error.title ?? error.session_id}
          <span className="ml-1">&#8594;</span>
        </Link>
      ) : error.title ? (
        <span className="block px-4 pb-2 text-cyber-cyan/60 text-xs truncate">
          {error.title}
        </span>
      ) : null}
      <div
        className="overflow-y-auto transition-[max-height] duration-300 ease-in-out"
        style={{ maxHeight: isExpanded ? "200px" : "0px" }}
      >
        <div className="px-4 pb-4 pt-1">
          <div className="border border-cyber-danger/20 bg-cyber-danger/5 p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-cyber-danger/70 text-xs tracking-[0.1em] uppercase">
                Full Message
              </p>
              <button
                type="button"
                onClick={copyMessage}
                className="text-xs border border-cyber-cyan/20 text-cyber-cyan/60 hover:text-cyber-cyan px-2 py-0.5 rounded"
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <pre className="text-cyber-danger/90 text-xs font-mono whitespace-pre-wrap break-words">
              {error.error_message ?? "No message"}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorTable({ errors }: { errors: ErrorsResponse["errors"] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <Section title="Error Log" meta={`${errors.length} entries`}>
      <div className="max-h-[500px] overflow-y-auto">
        {errors.map((err) => (
          <ErrorRow
            key={err.id}
            error={err}
            isExpanded={expandedId === err.id}
            onToggle={() => setExpandedId((id) => (id === err.id ? null : err.id))}
          />
        ))}
      </div>
    </Section>
  );
}

export default function ErrorsTab() {
  const { days } = useRange();
  const { project, branch } = useProject();
  const { refreshKey } = useRefresh();
  const params = new URLSearchParams();
  if (days > 0) params.set("days", String(days));
  if (project) params.set("project", project);
  if (branch) params.set("branch", branch);
  const query = params.toString();
  const url = query ? `/api/errors?${query}` : "/api/errors";
  const { data, loading, error } = useApi<ErrorsResponse>(url, refreshKey);

  if (error) {
    return (
      <div className="border border-cyber-danger/20 bg-cyber-danger/5 p-6">
        <p className="text-cyber-danger text-sm">{error}</p>
      </div>
    );
  }

  const byType = data?.byType ?? {
    rate_limit: 0,
    context_length: 0,
    api_error: 0,
    timeout: 0,
  };

  return (
    <div className="space-y-6">
      {loading ? (
        <div className="space-y-6">
          {[0, 1, 2].map((i) => (
            <Section key={i} title="">
              <LoadingPlaceholder />
            </Section>
          ))}
        </div>
      ) : data && data.total > 0 ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Object.keys(byType)
              .sort()
              .map((key) => (
                <KPICard key={key} label={formatTypeLabel(key)} value={byType[key] ?? 0} />
              ))}
          </div>

          <ErrorsByTypeChart byType={byType} />
          {data.daily.length > 0 && <ErrorsDailyLine data={data.daily} />}
          <ErrorTable errors={data.errors} />
        </>
      ) : (
        <EmptyState />
      )}
    </div>
  );
}
