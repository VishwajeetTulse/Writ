/**
 * The shape of a screen, held while it loads.
 *
 * Every page in this console is dynamic and waits on the database, so navigation used
 * to leave the last screen frozen with no sign that anything was happening. A skeleton
 * of the masthead and the first few rows says the request landed and roughly what is
 * arriving — a spinner says only that something, somewhere, is busy.
 */
export default function Loading() {
  return (
    <div
      className="mx-auto max-w-[1040px] animate-pulse px-5 py-8 sm:px-8"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading.</span>

      <div className="mb-8 border-b border-line pb-5">
        <div className="h-2.5 w-24 rounded-xs bg-line/70" />
        <div className="mt-4 h-7 w-56 rounded-xs bg-line" />
        <div className="mt-3.5 h-4 w-[52%] rounded-xs bg-line/70" />
      </div>

      <div className="h-2.5 w-20 rounded-xs bg-line/70" />
      <div className="mt-3 border-b border-hairline" />

      {[0, 1, 2].map((i) => (
        <div key={i} className="border-b border-hairline py-5">
          <div className="flex items-start justify-between gap-6">
            <div className="h-4 w-[46%] rounded-xs bg-line" />
            <div className="h-4 w-20 rounded-xs bg-line/70" />
          </div>
          <div className="mt-4 h-1.5 w-full rounded-xs bg-line/60" />
          <div className="mt-3 h-2.5 w-[34%] rounded-xs bg-line/50" />
        </div>
      ))}
    </div>
  );
}
