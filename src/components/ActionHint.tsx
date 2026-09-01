/**
 * Hover/focus explainer for an action button.
 *
 * The action rows in Mikey are dense with verbs — "What Next?",
 * "GTM Strategy Review", "Chat All Sessions" — that read as clear to
 * whoever built them and as guesswork to everyone else. A native
 * `title` attribute can't carry enough to fix that: it's one
 * unstyled line, it takes ~1s to appear, and it can't be read by
 * keyboard.
 *
 * So this is a pure-CSS popover: no state, no effects, no portal.
 * Visibility comes from `group-hover` and `group-focus-within`, which
 * means it works for pointer AND keyboard users and costs nothing on
 * pages that render dozens of them. It's `pointer-events-none`, so it
 * can never swallow the click meant for the button underneath.
 */

export interface ActionHintProps {
  /** Bold first line — usually restates the button in plain language. */
  title: string;
  /** A sentence or two on what the action actually does. */
  body: string;
  /**
   * Optional specifics: what gets sent, where it opens, what it costs.
   * These are the details that stop someone clicking to find out.
   */
  bullets?: string[];
  /**
   * Horizontal anchoring. Buttons near the right edge of the viewport
   * need "right" or the card overflows the page.
   */
  align?: "left" | "center" | "right";
  /** Drop the popover above the trigger instead of below it. */
  placement?: "top" | "bottom";
  className?: string;
  children: React.ReactNode;
}

const ALIGN: Record<NonNullable<ActionHintProps["align"]>, string> = {
  left: "left-0",
  center: "left-1/2 -translate-x-1/2",
  right: "right-0",
};

const ARROW_ALIGN: Record<NonNullable<ActionHintProps["align"]>, string> = {
  left: "left-6",
  center: "left-1/2 -translate-x-1/2",
  right: "right-6",
};

export default function ActionHint({
  title,
  body,
  bullets,
  align = "center",
  placement = "bottom",
  className = "",
  children,
}: ActionHintProps) {
  const below = placement === "bottom";

  return (
    <span className={`relative inline-flex group ${className}`}>
      {children}
      <span
        role="tooltip"
        className={[
          "pointer-events-none absolute z-50 w-80 max-w-[calc(100vw-2rem)]",
          ALIGN[align],
          below ? "top-full mt-2" : "bottom-full mb-2",
          "rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-left shadow-xl",
          "dark:border-gray-600 dark:bg-gray-800",
          // Invisible AND non-rendered for assistive tech until it opens,
          // so screen readers don't announce every hint on the page.
          "invisible opacity-0 group-hover:visible group-hover:opacity-100",
          "group-focus-within:visible group-focus-within:opacity-100",
          // A short delay stops the card strobing as the pointer crosses
          // a row of buttons on its way somewhere else.
          "transition-[opacity,transform] duration-150 delay-200",
          below ? "translate-y-1 group-hover:translate-y-0 group-focus-within:translate-y-0" : "-translate-y-1 group-hover:translate-y-0 group-focus-within:translate-y-0",
        ].join(" ")}
      >
        {/* Arrow. Rotated square rather than a border triangle so it
            picks up the card's own background and border colours. */}
        <span
          className={[
            "absolute h-2.5 w-2.5 rotate-45 border bg-gray-900 dark:bg-gray-800",
            ARROW_ALIGN[align],
            below
              ? "-top-[6px] border-b-0 border-r-0 border-gray-700 dark:border-gray-600"
              : "-bottom-[6px] border-l-0 border-t-0 border-gray-700 dark:border-gray-600",
          ].join(" ")}
          aria-hidden="true"
        />
        <span className="block text-sm font-semibold text-white">{title}</span>
        <span className="mt-1 block text-xs leading-relaxed text-gray-300">{body}</span>
        {bullets && bullets.length > 0 && (
          <span className="mt-2 block space-y-1">
            {bullets.map((b, i) => (
              <span key={i} className="flex gap-1.5 text-xs leading-relaxed text-gray-400">
                <span aria-hidden="true" className="text-gray-500">
                  •
                </span>
                <span>{b}</span>
              </span>
            ))}
          </span>
        )}
      </span>
    </span>
  );
}
