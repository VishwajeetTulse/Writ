import { formatPaise, formatPaiseCompact } from "@/lib/money";

/**
 * The spend runway — Writ's signature element.
 *
 * Every other dashboard in this category draws a progress bar: spent out of budget,
 * filling left to right, and when it reaches the end it simply stops. That picture is
 * wrong for what this product does. It shows consumption; it does not show a boundary
 * being enforced.
 *
 * So the cap here is drawn as a wall, and there is deliberately space beyond it. A
 * blocked attempt is rendered as a dashed segment that runs *past* the wall and is cut
 * off by it. You can see the thing that was refused and exactly how far over it went,
 * which is the single most important fact this product has to communicate and the one
 * a progress bar structurally cannot express.
 *
 * All amounts are paise. Pass numbers, not bigints, so this renders on either side of
 * the server/client boundary.
 */

/** The cap sits here, leaving room to draw what got stopped on the far side. */
const WALL_PCT = 74;

export interface RunwayProps {
  capPaise: number;
  spentPaise: number;
  /** The amount of a refused attempt, drawn breaching the wall. */
  blockedPaise?: number | null;
  blockedLabel?: string | null;
  /** Row variant: thinner, no labels. */
  compact?: boolean;
}

export function Runway({
  capPaise,
  spentPaise,
  blockedPaise,
  blockedLabel,
  compact = false,
}: RunwayProps) {
  const cap = Math.max(capPaise, 1);
  const spentPct = Math.min((spentPaise / cap) * WALL_PCT, WALL_PCT);

  // A refused attempt is drawn from where spending currently stands, so its length is
  // the amount that was asked for and its right edge is where it would have landed.
  const breach =
    blockedPaise && blockedPaise > 0
      ? {
          left: spentPct,
          width: Math.min((blockedPaise / cap) * WALL_PCT, 100 - spentPct),
          overshoots: spentPaise + blockedPaise > capPaise,
        }
      : null;

  const remaining = Math.max(capPaise - spentPaise, 0);

  const description = `${formatPaise(BigInt(Math.round(spentPaise)))} committed of a ${formatPaise(
    BigInt(Math.round(capPaise)),
  )} cap${breach ? `, with a refused attempt beyond it` : ""}.`;

  return (
    <div className="w-full">
      {!compact && (
        <div className="mb-2 flex items-baseline justify-between gap-4">
          <span className="eyebrow">Spend runway</span>
          <span className="font-mono text-micro tnum text-ink-soft">
            {formatPaise(BigInt(Math.round(spentPaise)))} of{" "}
            {formatPaise(BigInt(Math.round(capPaise)))} committed
          </span>
        </div>
      )}

      <div
        role="img"
        aria-label={description}
        className={`relative w-full overflow-hidden rounded-xs border border-hairline bg-sunk ${
          compact ? "h-1.5" : "h-9"
        }`}
      >
        {/* Beyond the wall. Hatched, because it is not headroom — it is out of bounds. */}
        <div
          className="absolute inset-y-0 right-0"
          style={{
            left: `${WALL_PCT}%`,
            backgroundImage:
              "repeating-linear-gradient(45deg, transparent 0 5px, rgba(22,21,15,0.05) 5px 6px)",
          }}
        />

        {/* Spent. */}
        <div
          className="absolute inset-y-0 left-0 bg-ink transition-[width] duration-500 ease-out"
          style={{ width: `${spentPct}%` }}
        />

        {/* The refused attempt, cut off by the wall it tried to cross. */}
        {breach && (
          <div
            className="absolute inset-y-0 border-y-2 border-dashed border-deny bg-deny/12 transition-all duration-500 ease-out"
            style={{ left: `${breach.left}%`, width: `${breach.width}%` }}
          />
        )}

        {/* The wall. Full height, hard edge, no gradient — the point is that it does
            not yield. */}
        <div
          className="absolute inset-y-0 w-[2px] bg-ink"
          style={{ left: `${WALL_PCT}%` }}
        />
      </div>

      {!compact && (
        <>
          {/* The cap label is pinned to the wall, so the other two cannot be pinned to
              the edges as well — at panel widths they run straight into it. Left label
              only, and anything about the refused attempt goes on its own line. */}
          <div className="relative mt-2 h-7">
            <span className="absolute left-0 max-w-[30%] truncate font-mono text-nano tnum text-ink-soft">
              {formatPaiseCompact(BigInt(Math.round(remaining)))} left
            </span>

            <span
              className="absolute -translate-x-1/2 whitespace-nowrap text-center font-mono text-nano tnum"
              style={{ left: `${WALL_PCT}%` }}
            >
              <span className="block font-medium">
                {formatPaiseCompact(BigInt(Math.round(capPaise)))}
              </span>
              <span className="eyebrow mt-1 block">hard cap</span>
            </span>
          </div>

          {breach && breach.overshoots && (
            <p className="mt-1 truncate text-right font-mono text-nano tnum text-deny">
              {blockedLabel ?? "refused"}
            </p>
          )}
        </>
      )}

    </div>
  );
}
