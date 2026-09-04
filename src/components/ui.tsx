import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * The primitives.
 *
 * The rule that shapes all of this: **a container is for an object, not for a section.**
 *
 * The previous interface put every region of every page inside an identical rounded
 * white box. Once everything is a card, nothing is primary — the eye has no way to rank
 * what it is looking at, and hierarchy quietly becomes the job of the border rather than
 * the typography. So there are two different things here and they are not
 * interchangeable:
 *
 *   `Section`  Content sitting directly on the page, introduced by a rubric and a rule.
 *              This is the default. Reach for it first.
 *
 *   `Panel`    A raised surface with a border. Reserved for something that is genuinely
 *              a discrete object you could point at — one mandate, one live run pane.
 *
 * Before writing `<Panel>`, ask whether the thing inside it is an object. If it is a
 * region of a page, it is a `Section`.
 */

/* -------------------------------------------------------------------------- page */

export function Page({
  kicker,
  title,
  lede,
  actions,
  children,
  wide = false,
}: {
  /** A small line above the title: what kind of thing this page is. */
  kicker?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={`mx-auto py-8 ${
        wide
          ? "max-w-[1400px] px-6 sm:px-12 lg:px-20"
          : "max-w-[1040px] px-5 sm:px-8"
      }`}
    >
      <header className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-line pb-5">
        <div className="min-w-0">
          {kicker && <div className="eyebrow mb-2.5">{kicker}</div>}
          <h1 className="human text-display font-normal leading-[1.12] tracking-[-0.018em]">
            {title}
          </h1>
          {lede && (
            <p className="human mt-2.5 max-w-[58ch] text-lede leading-[1.55] text-ink-mute">
              {lede}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </header>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------- sections */

/**
 * A region of a page. No box: a rubric, a hairline, and the content beneath it.
 *
 * `aside` puts a value or a control on the right of the rule — a count, a filter, a
 * link — without it becoming a second heading.
 */
export function Section({
  title,
  aside,
  children,
  className = "",
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      {(title || aside) && (
        <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-line pb-2">
          {title ? <h2 className="rubric">{title}</h2> : <span />}
          {aside && <div className="shrink-0">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Space between whole sections. Deliberately much larger than any gap within one. */
export function Stack({ children }: { children: ReactNode }) {
  return <div className="space-y-11">{children}</div>;
}

/* ------------------------------------------------------------------------ panels */

/**
 * A raised surface, for a discrete object. Not for a page section — see the note above.
 */
export function Panel({
  children,
  className = "",
  pad = true,
  tone = "surface",
}: {
  children: ReactNode;
  className?: string;
  pad?: boolean;
  tone?: "surface" | "sunk";
}) {
  return (
    <div
      className={`rounded-md border border-line ${
        tone === "sunk" ? "bg-sunk" : "bg-surface"
      } ${pad ? "p-5" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

/** A panel's own header strip. Sits above the hairline that separates it from content. */
export function PanelHead({
  title,
  aside,
}: {
  title: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline px-4 py-3">
      <h3 className="rubric">{title}</h3>
      {aside && <div className="shrink-0">{aside}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------------- lists */

/** A list of rows separated by hairlines. The default way to show a set of things. */
export function Rows({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <ul className={`divide-y divide-hairline ${className}`}>{children}</ul>;
}

export function Row({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <li className={`py-3 ${className}`}>{children}</li>;
}

/* ------------------------------------------------------------------------ values */

/** A labelled value. Machine values are mono by default, because that is what they are. */
export function Field({
  label,
  children,
  mono = true,
}: {
  label: ReactNode;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="eyebrow mb-1.5">{label}</div>
      <div className={`text-ui tnum ${mono ? "font-mono" : ""}`}>{children}</div>
    </div>
  );
}

/**
 * One headline number.
 *
 * `lead` makes it the single primary figure on a screen. Every screen that shows
 * several of these should mark exactly one, so the eye knows where to land — leading
 * with one number is the difference between a statement and a wall of data.
 */
export function Stat({
  label,
  value,
  sub,
  tone = "ink",
  lead = false,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "ink" | "permit" | "deny" | "mute";
  lead?: boolean;
}) {
  const toneClass = {
    ink: "text-ink",
    permit: "text-permit",
    deny: "text-deny",
    mute: "text-ink-soft",
  }[tone];

  return (
    <div>
      <div className="eyebrow mb-2">{label}</div>
      <div
        className={`font-mono leading-none tnum ${toneClass} ${
          lead ? "text-hero tracking-[-0.02em]" : "text-figure tracking-[-0.01em]"
        }`}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-2 max-w-[34ch] text-small leading-snug text-ink-soft">{sub}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- empty */

/**
 * An empty state that answers the three questions worth answering: what is not here,
 * why, and what to do about it. "No data found" answers none of them.
 */
export function Empty({
  title,
  children,
  action,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed border-line bg-surface/60 px-6 py-10 text-center">
      <p className="human text-lede text-ink">{title}</p>
      {children && (
        <p className="mx-auto mt-1.5 max-w-[46ch] text-ui leading-relaxed text-ink-mute">
          {children}
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------------- scroller */

/**
 * Wide content — a ten-column table, a row of chips — scrolls inside this rather than
 * pushing the page sideways. The old interface had exactly one of these in the entire
 * application, which is why the ledger was simply clipped on a phone.
 */
export function Scroller({
  children,
  className = "",
  bleed = true,
}: {
  children: ReactNode;
  className?: string;
  /**
   * Run to the screen edge on a phone, so a wide table uses the full width instead of
   * scrolling inside the page gutter. Turn it off when the scroller sits inside a
   * panel, where negative margins would break out of the border.
   */
  bleed?: boolean;
}) {
  return (
    <div className={`scroller ${bleed ? "-mx-5 px-5 sm:mx-0 sm:px-0" : ""} ${className}`}>
      {children}
    </div>
  );
}

/* ----------------------------------------------------------------------- buttons */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "danger-quiet";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-surface hover:bg-ink/88",
  secondary: "border border-line bg-surface text-ink hover:border-line-strong hover:bg-sunk",
  ghost: "text-ink-mute hover:bg-sunk hover:text-ink",
  danger: "bg-deny text-surface hover:bg-deny/88",
  "danger-quiet": "border border-line bg-surface text-ink hover:border-deny hover:text-deny",
};

const SIZE: Record<Size, string> = {
  sm: "h-7 gap-1.5 px-2.5 text-micro",
  md: "h-[34px] gap-2 px-3 text-ui",
  lg: "h-[42px] gap-2 px-5 text-body",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md"): string {
  return [
    "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-sm font-medium",
    "transition-colors duration-100 disabled:pointer-events-none disabled:opacity-40",
    VARIANT[variant],
    SIZE[size],
  ].join(" ");
}

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button {...props} className={`${buttonClass(variant, size)} ${className}`} />;
}

/* ------------------------------------------------------------------------ inputs */

/**
 * One control style, shared by every input, select and textarea in the product.
 *
 * The focus treatment is a border darkening only — the visible ring comes from the
 * global `:focus-visible` rule in globals.css, so keyboard users get a real target and
 * mouse users do not get a box drawn round every field they click.
 */
export const controlClass =
  "w-full rounded-sm border border-line bg-surface px-2.5 text-ui text-ink " +
  "outline-none transition-colors placeholder:text-ink-soft " +
  "hover:border-line-strong focus:border-ink-mute disabled:bg-sunk disabled:opacity-60";

export const inputClass = `${controlClass} h-[34px]`;

/** A form field: label, control, and the note that explains it. */
export function Labelled({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="eyebrow mb-2 block">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-small leading-snug text-ink-soft">{hint}</p>}
    </div>
  );
}

/** A toggle rendered as a chip. Used for allowlists, categories and filters. */
export function Chip({
  on,
  children,
  onClick,
  title,
  mono = false,
}: {
  on: boolean;
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  mono?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={`rounded-xs border px-2.5 py-1.5 text-left transition-colors ${
        mono ? "font-mono text-micro" : "text-small"
      } ${
        on
          ? "border-ink bg-ink text-surface"
          : "border-line bg-surface text-ink-mute hover:border-line-strong hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------------- links */

/** Inline text links. Underlined, because a link that is only a colour is not a link. */
export const linkClass =
  "underline decoration-line-strong underline-offset-[3px] transition-colors hover:decoration-ink";
