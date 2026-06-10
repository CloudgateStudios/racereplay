/**
 * Small icon badge that visually distinguishes triathlon vs road race events.
 * Used in race cards across the app.
 */

interface Props {
  type: string;
}

export function RaceTypeIcon({ type }: Props) {
  const isTriathlon = type === "TRIATHLON";

  return (
    <div
      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg ${
        isTriathlon ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground"
      }`}
      title={isTriathlon ? "Triathlon" : "Road Race"}
      aria-label={isTriathlon ? "Triathlon" : "Road Race"}
    >
      {isTriathlon ? (
        <span className="text-xs font-black tracking-tight">TRI</span>
      ) : (
        <span className="text-xs font-black tracking-tight">RUN</span>
      )}
    </div>
  );
}
