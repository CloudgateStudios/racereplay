import type { ReactNode } from "react";

export interface OgStat {
  label: string;
  value: string;
  color?: string; // defaults to white; use "#f97316" for orange
}

export interface OgCardProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  label?: string;
  labelColor?: string;
  stats?: OgStat[];
  bottomSlot?: ReactNode;
  centered?: boolean;
}

function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      <svg width="44" height="44" viewBox="0 0 28 28">
        <polygon points="26,14 20,24 8,24 2,14 8,4 20,4" fill="#f97316" />
        <polygon points="11,9 11,19 20,14" fill="white" />
      </svg>
      <span
        style={{
          color: "#f97316",
          fontSize: "22px",
          fontWeight: 900,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        Race Replay
      </span>
    </div>
  );
}

function StatRow({ stats }: { stats: OgStat[] }) {
  return (
    <div style={{ display: "flex", gap: "48px" }}>
      {stats.map((stat) => (
        <div key={stat.label} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span
            style={{
              color: "#a3a3a3",
              fontSize: "15px",
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {stat.label}
          </span>
          <span
            style={{
              color: stat.color ?? "#ffffff",
              fontSize: "40px",
              fontWeight: 600,
            }}
          >
            {stat.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function OgCard({
  eyebrow,
  title,
  subtitle,
  label,
  labelColor = "#f97316",
  stats = [],
  bottomSlot,
  centered = false,
}: OgCardProps) {
  const hasBottom = stats.length > 0 || bottomSlot != null;

  if (centered) {
    return (
      <div
        style={{
          width: "1200px",
          height: "630px",
          background: "#0f0f0f",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: "32px",
          padding: "64px",
          fontFamily: "Barlow Condensed",
        }}
      >
        <svg width="80" height="80" viewBox="0 0 28 28">
          <polygon points="26,14 20,24 8,24 2,14 8,4 20,4" fill="#f97316" />
          <polygon points="11,9 11,19 20,14" fill="white" />
        </svg>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "16px",
          }}
        >
          <div
            style={{
              color: "#ffffff",
              fontSize: "72px",
              fontWeight: 900,
              letterSpacing: "-0.02em",
            }}
          >
            {title}
          </div>
          {subtitle && (
            <div style={{ color: "#a3a3a3", fontSize: "28px", fontWeight: 500 }}>{subtitle}</div>
          )}
        </div>
        {/* CTA */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: "#f97316",
            borderRadius: "9999px",
            padding: "12px 32px",
          }}
        >
          <span style={{ color: "#ffffff", fontSize: "22px", fontWeight: 700, letterSpacing: "0.02em" }}>
            Find your race at racereplay.app
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: "1200px",
        height: "630px",
        background: "#0f0f0f",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "64px",
        fontFamily: "Barlow Condensed",
      }}
    >
      <Logo />

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {eyebrow && (
          <div
            style={{
              color: "#a3a3a3",
              fontSize: "22px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {eyebrow}
          </div>
        )}
        <div
          style={{
            color: "#ffffff",
            fontSize: "72px",
            fontWeight: 900,
            lineHeight: "1.05",
            letterSpacing: "-0.02em",
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div style={{ color: "#a3a3a3", fontSize: "36px", fontWeight: 700 }}>{subtitle}</div>
        )}
        {label && (
          <div style={{ color: labelColor, fontSize: "22px", fontWeight: 600 }}>{label}</div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        {hasBottom ? (
          <div style={{ display: "flex", gap: "48px", alignItems: "flex-end" }}>
            {stats.length > 0 && <StatRow stats={stats} />}
            {bottomSlot}
          </div>
        ) : (
          <div style={{ display: "flex" }} />
        )}
        {/* CTA */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            background: "#f97316",
            borderRadius: "9999px",
            padding: "10px 24px",
          }}
        >
          <span style={{ color: "#ffffff", fontSize: "18px", fontWeight: 700, letterSpacing: "0.02em" }}>
            racereplay.app
          </span>
        </div>
      </div>
    </div>
  );
}
