import { useRange } from "@/dashboard/App";

const DAY_OPTIONS = [
  { label: "1d", value: 1 },
  { label: "7d", value: 7 },
  { label: "14d", value: 14 },
  { label: "30d", value: 30 },
  { label: "All", value: 0 },
];

export default function RangeSelector() {
  const { days, setDays } = useRange();
  return (
    <select
      value={days}
      onChange={(e) => setDays(Number(e.target.value))}
      className="bg-cyber-bg border border-cyber-cyan/20 text-cyber-cyan/70 text-xs px-2 py-0.5 tracking-wider uppercase cursor-pointer focus:outline-none focus:border-cyber-cyan/50"
    >
      {DAY_OPTIONS.map((o) => (
        <option key={o.value} value={o.value} className="bg-cyber-bg text-cyber-cyan">
          {o.label}
        </option>
      ))}
    </select>
  );
}
