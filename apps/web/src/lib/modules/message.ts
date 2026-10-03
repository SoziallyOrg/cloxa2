/**
 * Turns a module's `Message` (an i18n key plus tagged values) into text, and
 * a module's counters and hints into plain view data a component can render
 * (server or client: only strings and numbers cross).
 */
import type {
  Counter,
  Hint,
  Message,
  MessageValue,
  ModuleDefinition,
  ModuleInput,
} from "@cloxa/modules";
import { formatBrusselsShortDate, formatBrusselsTime, t } from "@cloxa/i18n";

import { formatDurationMs } from "@/components/clock/format";

const MONTH = new Intl.DateTimeFormat("nl-BE", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

/** One tagged value as text: durations, times, days and months formatted for nl-BE. */
export function renderValue(value: MessageValue): string | number {
  if (typeof value === "string" || typeof value === "number") return value;
  if ("durationMs" in value) return formatDurationMs(Math.max(0, value.durationMs));
  if ("time" in value) return formatBrusselsTime(new Date(value.time));
  // Noon UTC is the same calendar day in Brussels all year round.
  if ("day" in value)
    return formatBrusselsShortDate(new Date(`${value.day}T12:00:00Z`));
  const month = MONTH.format(new Date(`${value.month}-15T12:00:00Z`));
  return month.charAt(0).toUpperCase() + month.slice(1);
}

export function renderMessage(message: Message): string {
  if (message.values === undefined) return t(message.key);
  const values: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(message.values)) {
    values[name] = renderValue(value);
  }
  return t(message.key, values);
}

export interface CounterView {
  readonly id: string;
  readonly display: Counter["display"];
  readonly label: string;
  readonly value: string | null;
  readonly progress: {
    readonly value: number;
    readonly max: number;
    readonly label: string;
    readonly start: string;
    readonly end: string;
  } | null;
  readonly lines: readonly string[];
}

export interface HintView {
  readonly id: string;
  readonly tone: Hint["tone"];
  readonly text: string;
}

export interface ModuleView {
  readonly id: ModuleDefinition["id"];
  readonly label: string;
  readonly counters: readonly CounterView[];
  readonly hints: readonly HintView[];
}

export function viewCounter(counter: Counter): CounterView {
  return {
    id: counter.id,
    display: counter.display,
    label: renderMessage(counter.label),
    value: counter.value ? renderMessage(counter.value) : null,
    progress: counter.progress
      ? {
          value: counter.progress.value,
          max: counter.progress.max,
          label: renderMessage(counter.progress.label),
          start: renderMessage(counter.progress.start),
          end: renderMessage(counter.progress.end),
        }
      : null,
    lines: (counter.lines ?? []).map(renderMessage),
  };
}

/** One module's counters and hints for one employee, as text. */
export function viewModule(module: ModuleDefinition, input: ModuleInput): ModuleView {
  return {
    id: module.id,
    label: t(module.label),
    counters: module.counters(input).map(viewCounter),
    hints: module.hints(input).map((hint) => ({
      id: hint.id,
      tone: hint.tone,
      text: renderMessage(hint.message),
    })),
  };
}
