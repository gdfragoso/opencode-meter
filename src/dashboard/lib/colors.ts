/**
 * Cyber palette color tokens.
 *
 * Static exports — every component reads these directly. Single source of
 * truth for chart series colors, axis text, and tooltip styling.
 */

export const bg = "#0a0a0f";
export const cyan = "#00ffcc";
export const magenta = "#ff00ff";
export const yellow = "#ffff00";
export const danger = "#ff4466";
export const grid = "#1a1a2e";
export const text = "#ccccdd";
export const purple = "#a855f7";

/** Extra hues appended after the primary trio when rendering donut charts. */
export const donutExtras = [
  "#00ff88",
  "#ff8800",
  "#8800ff",
  "#00aaff",
  "#ff4488",
  "#88ff00",
  "#ff00cc",
];

/** Chart.js theme object — drop into `options.scales.*.grid.color` etc. */
export const chartColors = {
  color: text,
  borderColor: grid,
  backgroundColor: "transparent",
  grid: { color: grid, tickColor: text },
  scale: { grid: { color: grid }, ticks: { color: text } },
};
