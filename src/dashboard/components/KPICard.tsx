interface KPICardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  delta?: number;
}

export default function KPICard({ label, value, subtitle, delta }: KPICardProps) {
  return (
    <div className="border border-cyber-cyan/20 bg-cyber-cyan/5 p-4 backdrop-blur-sm">
      <div className="text-cyber-cyan/50 text-xs tracking-[0.15em] uppercase mb-2">
        {label}
      </div>
      <div className="text-cyber-cyan text-2xl tracking-wider tabular-nums">
        {value}
      </div>
      {subtitle && (
        <div className="text-cyber-cyan/30 text-[10px] tracking-[0.1em] uppercase mt-1">
          {subtitle}
        </div>
      )}
      {delta != null && (
        <div
          className={`text-xs tracking-[0.1em] mt-1.5 ${
            delta >= 0 ? "text-cyber-cyan" : "text-cyber-danger"
          }`}
        >
          <span className="mr-1">{delta >= 0 ? "\u2191" : "\u2193"}</span>
          {delta >= 0 ? "+" : ""}
          {delta.toFixed(1)}%
        </div>
      )}
    </div>
  );
}
