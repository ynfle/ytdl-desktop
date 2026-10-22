/**
 * Delete button from Rare UI (https://rareui.com).
 * Copyright (c) 2026 Swami Malode
 *
 * MIT + Commons Clause License Condition v1.0 + Attribution
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, and distribute the Software as part of an
 * application, website, or product, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * Attribution Requirement
 * Any project that ships any part of the Software must credit Rare UI with a
 * visible link to https://rareui.com, placed where a visitor or user can find it,
 * such as a site footer, an about page, a credits screen or a README. The credit
 * and the copyright notice above must not be removed from the source you copied.
 *
 * Commons Clause Restriction
 * You may use this Software, including for any commercial purpose, so long as you
 * do not sell, sublicense, or redistribute the components themselves, whether
 * alone, in a bundle, or as a ported version.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * The name Rare UI, the logo, and the site design are not covered by this license.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type Transition,
} from "motion/react";
import { cn } from "@renderer/lib/utils";

const HINGE = "3px 6px";
const LID_OPEN = -35;
const WALL_TOP = 6;
const WALL_TOP_OPEN = 13.5;
const WALL_BASE = 20;

const HOLD = { deleted: 1400, kept: 600 };

/** Layout for the original Rare UI tile and the compact row tile. */
const SIZES = {
  md: {
    tile: 48,
    panel: 84,
    height: "h-12",
    box: "h-12 w-12",
    radius: "rounded-2xl",
    circle: "h-7 w-7",
    bin: 20,
    glyph: 14,
    gap: "gap-2",
    notch: "h-2.5 w-1.5 -left-1.25",
  },
  sm: {
    tile: 24,
    panel: 44,
    height: "h-6",
    box: "h-6 w-6",
    radius: "rounded-md",
    circle: "h-4 w-4",
    bin: 12,
    glyph: 8,
    gap: "gap-1",
    notch: "h-1.5 w-1 -left-1",
  },
} as const;

type DeleteButtonSize = keyof typeof SIZES;

const EASE = [0.32, 0.72, 0, 1] as const;
const EASE_LID = [0.34, 1.1, 0.64, 1] as const;

const WIDTH = { duration: 0.62, ease: EASE } as const;
const LID = { duration: 0.6, ease: EASE_LID } as const;
const WALL = { duration: 0.56, ease: EASE } as const;
const IN = { duration: 0.44, ease: EASE, delay: 0.14 } as const;
const OUT = { duration: 0.3, ease: EASE } as const;
const TAP = { duration: 0.2, ease: EASE } as const;
const SWAP = { duration: 0.22, ease: EASE } as const;
const SETTLE = { duration: 0.45, ease: EASE } as const;
const PRESS = {
  type: "spring",
  stiffness: 520,
  damping: 18,
  mass: 0.5,
} as const;
const INSTANT = { duration: 0 } as const;

/* App theme tokens (main.css @theme) replace the original Rare UI light/dark hex palette. */
/** Tile + disc surface (lifted above the recess, like the original light-on-dark tray). */
const SURFACE = "bg-surface-overlay";
/** Confirm panel recess (one step darker than the tile so it reads as a tray). */
const RECESS = "bg-surface-raised";
/** Bin glyph color; brightens on hover / while the confirm panel is open. */
const GLYPH =
  "text-text-muted hover:text-text data-[state=open]:text-text transition-colors duration-200";
/** Shared focus ring (accent, offset against the app background). */
const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
/** Destructive accent for the deleted tick (SVGs stroke with `currentColor`). */
const ACCENT = "text-danger";

const LIFT =
  "shadow-[0_0.5px_1px_rgba(0,0,0,0.35),0_1.5px_4px_rgba(0,0,0,0.25),inset_0_0.5px_0_rgba(255,255,255,0.07)]";

/** Confirm / cancel disc shape + focus + lift (fill comes from the tone classes below). */
const CIRCLE = `grid place-items-center rounded-full transition-colors duration-200 ${FOCUS} ${LIFT}`;
/** Confirm disc: danger wash so the destructive choice stands apart from Cancel. */
const CIRCLE_DANGER = "bg-danger-dim hover:bg-danger/25 text-danger";
/** Cancel disc: neutral surface, brightens on hover. */
const CIRCLE_NEUTRAL = `${SURFACE} hover:bg-border-bright text-text-secondary hover:text-text`;

const ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const panelMotion = {
  hidden: { opacity: 0, x: -6, transition: OUT },
  shown: { opacity: 1, x: 0, transition: { ...IN, staggerChildren: 0.07 } },
};

const circleMotion = {
  hidden: { opacity: 0, scale: 0.9, transition: OUT },
  shown: { opacity: 1, scale: 1, transition: IN },
};

/** One round confirm / cancel button inside the open panel. */
function Circle({
  label,
  onClick,
  children,
  circleClass,
  glyph,
  tone = "neutral",
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  /** Confirm / cancel disc size for the active tile scale. */
  circleClass: string;
  glyph: number;
  /** `danger` tints the disc for the destructive (confirm) action. */
  tone?: "danger" | "neutral";
}) {
  const reduced = useReducedMotion() ?? false;

  return (
    <motion.div className="flex" variants={reduced ? undefined : circleMotion}>
      <motion.button
        type="button"
        aria-label={label}
        title={label}
        onClick={onClick}
        whileHover={reduced ? undefined : { scale: 1.03 }}
        whileTap={reduced ? undefined : { scale: 0.84 }}
        transition={PRESS}
        className={cn(
          CIRCLE,
          tone === "danger" ? CIRCLE_DANGER : CIRCLE_NEUTRAL,
          circleClass,
        )}
      >
        <svg
          {...ICON}
          width={glyph}
          height={glyph}
          stroke="currentColor"
          strokeWidth="3.5"
        >
          {children}
        </svg>
      </motion.button>
    </motion.div>
  );
}

type Status = "idle" | "deleted" | "kept";

export type DeleteButtonProps = Omit<
  ComponentProps<"div">,
  "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd"
> & {
  onConfirm?: () => void;
  onCancel?: () => void;
  /** `sm` fits library and table rows. `md` is the original 48px Rare UI tile. */
  size?: DeleteButtonSize;
};

export function DeleteButton({
  className,
  onConfirm,
  onCancel,
  size = "md",
  ...props
}: DeleteButtonProps) {
  const metrics = SIZES[size];
  const reduced = useReducedMotion() ?? false;
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const trigger = useRef<HTMLButtonElement>(null);
  /** Root element; pointerdown outside it dismisses the open confirm panel. */
  const root = useRef<HTMLDivElement>(null);
  const timing = (transition: Transition) => (reduced ? INSTANT : transition);

  const top = useMotionValue(WALL_TOP);
  const wall = useTransform(top, (y) => WALL_BASE - y);
  const bin = useMotionTemplate`M19 ${top}v${wall}a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V${top}`;
  const settle = useMotionValue(1);

  useEffect(() => {
    const walls = animate(
      top,
      open ? WALL_TOP_OPEN : WALL_TOP,
      reduced ? INSTANT : WALL,
    );
    return () => walls.stop();
  }, [open, reduced, top]);

  useEffect(() => {
    if (status === "idle") return;
    const nudge =
      status === "kept" && !reduced
        ? animate(settle, [1, 0.86, 1], SETTLE)
        : null;
    const done = setTimeout(() => setStatus("idle"), HOLD[status]);
    return () => {
      nudge?.stop();
      clearTimeout(done);
    };
  }, [status, reduced, settle]);

  /**
   * Close the panel and report the outcome.
   * @param refocus Return focus to the trigger (skip for outside clicks so focus follows the pointer).
   */
  const resolve = (next: Exclude<Status, "idle">, refocus = true) => {
    setOpen(false);
    setStatus(next);
    if (refocus) trigger.current?.focus();
    (next === "deleted" ? onConfirm : onCancel)?.();
  };

  /** Latest `resolve` for the document listener (avoids re-binding on every render). */
  const resolveRef = useRef(resolve);
  useEffect(() => {
    resolveRef.current = resolve;
  });

  // While open: a pointerdown anywhere outside the control cancels (treated as "kept").
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const el = root.current;
      if (el && event.target instanceof Node && el.contains(event.target)) return;
      console.info("[DeleteButton] outside pointerdown → kept");
      resolveRef.current("kept", false);
    };
    // Capture phase so row handlers that stop propagation cannot keep the panel open.
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  return (
    <motion.div
      ref={root}
      data-slot="delete-button"
      data-state={open ? "open" : "closed"}
      data-status={status}
      className={cn("relative", metrics.height, metrics.radius, SURFACE, GLYPH, className)}
      animate={{ width: open ? metrics.tile + metrics.panel : metrics.tile }}
      transition={timing(WIDTH)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          // Consume Escape so outer listeners (e.g. queue drawer close) do not also fire.
          event.preventDefault();
          event.stopPropagation();
          resolve("kept");
        }
      }}
      {...props}
    >
      <motion.button
        ref={trigger}
        type="button"
        aria-label={open ? "Cancel delete" : "Delete"}
        title={open ? "Cancel" : "Delete"}
        aria-expanded={open}
        onClick={() => {
          if (open) return resolve("kept");
          setStatus("idle");
          setOpen(true);
        }}
        whileTap={reduced ? undefined : { scale: 0.94 }}
        transition={TAP}
        className={cn(
          "relative z-10 grid place-items-center",
          metrics.box,
          metrics.radius,
          FOCUS,
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {status === "deleted" ? (
            <motion.svg
              key="done"
              {...ICON}
              width={metrics.bin}
              height={metrics.bin}
              stroke="currentColor"
              className={ACCENT}
              strokeWidth="2.5"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={timing(SWAP)}
            >
              <motion.path
                d="M4 12.5 9.5 18 20 7"
                initial={reduced ? undefined : { pathLength: 0 }}
                animate={reduced ? undefined : { pathLength: 1 }}
                transition={SETTLE}
              />
            </motion.svg>
          ) : (
            <motion.svg
              key="bin"
              {...ICON}
              width={metrics.bin}
              height={metrics.bin}
              stroke="currentColor"
              strokeWidth="2"
              className="overflow-visible"
              style={{ scale: settle }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={timing(SWAP)}
            >
              <motion.path d={bin} />
              <motion.g
                style={{ transformBox: "view-box", transformOrigin: HINGE }}
                animate={{ rotate: open ? LID_OPEN : 0 }}
                transition={timing(LID)}
              >
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </motion.g>
            </motion.svg>
          )}
        </AnimatePresence>
      </motion.button>

      <span role="status" aria-live="polite" className="sr-only">
        {status === "deleted" ? "Deleted" : status === "kept" ? "Kept" : ""}
      </span>

      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            style={{ width: metrics.panel }}
            className={cn(
              "absolute inset-y-0 right-0 flex items-center justify-center",
              metrics.gap,
              metrics.radius,
              RECESS,
            )}
            variants={reduced ? undefined : panelMotion}
            initial="hidden"
            animate="shown"
            exit="hidden"
          >
            <span
              aria-hidden
              className={cn(
                "absolute top-1/2 z-20 -translate-y-1/2 [clip-path:polygon(100%_0,0_50%,100%_100%)]",
                metrics.notch,
                RECESS,
              )}
            />
            <Circle
              label="Confirm delete"
              circleClass={metrics.circle}
              glyph={metrics.glyph}
              tone="danger"
              onClick={() => resolve("deleted")}
            >
              <path d="M4 12.5 9.5 18 20 7" />
            </Circle>
            <Circle
              label="Cancel"
              circleClass={metrics.circle}
              glyph={metrics.glyph}
              onClick={() => resolve("kept")}
            >
              <path d="M6 6 18 18M18 6 6 18" />
            </Circle>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default DeleteButton;
