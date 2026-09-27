import type { ShiftState } from "@cloxa/domain";

import { cx } from "../ui/cx";
import { formatElapsed, statusHeadline, statusTone, statusWord } from "./format";

export interface ClockStatusProps {
  state: ShiftState;
  /** Epoch ms the current state started, `null` when off. */
  since: number | null;
  /** Epoch ms "now" — supplied by the caller so this stays a pure function of props. */
  now: number;
}

const DOT_CLASSES: Record<ReturnType<typeof statusTone>, string> = {
  working: "bg-status-working",
  break: "bg-status-break",
  off: "bg-status-off",
  error: "bg-status-error",
};

const WORD_CLASSES: Record<ReturnType<typeof statusTone>, string> = {
  working: "text-status-working",
  break: "text-status-break",
  off: "text-status-off",
  error: "text-status-error",
};

/**
 * The hero of the employee home: a coloured dot plus a word, then the big
 * status sentence, then the elapsed time. Pure props in, text out: a caller
 * that wants a live tick re-renders with a fresh `now`.
 */
export function ClockStatus({ state, since, now }: ClockStatusProps) {
  const elapsed = since !== null && state !== "off" ? formatElapsed(since, now) : null;
  const tone = statusTone(state);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={cx("size-5 rounded-full", DOT_CLASSES[tone])}
        />
        <span className={cx("text-xl font-bold", WORD_CLASSES[tone])}>
          {statusWord(state)}
        </span>
      </div>
      <p className="text-status leading-tight font-bold">
        {statusHeadline(state, since)}
      </p>
      {elapsed ? <p className="text-xl text-ink/70">{elapsed}</p> : null}
    </div>
  );
}
