import type { ReactNode } from "react";

import { t } from "@cloxa/i18n";

import type { CounterView, HintView, ModuleView } from "@/lib/modules/message";

import { ListItem, Row, Section } from "../ui/List";
import { ProgressTrack } from "../ui/ProgressTrack";

function Figure({ counter }: { counter: CounterView }) {
  return (
    <ListItem className="gap-1 py-4">
      <p className="text-subhead text-ink-2">{counter.label}</p>
      {counter.value !== null ? (
        <p className="text-number break-words">{counter.value}</p>
      ) : null}
      {counter.progress ? (
        <div className="pt-2 pb-1">
          <ProgressTrack
            value={counter.progress.value}
            max={counter.progress.max}
            label={counter.progress.label}
            startLabel={counter.progress.start}
            endLabel={counter.progress.end}
          />
        </div>
      ) : null}
      {counter.lines.map((line) => (
        <p key={line} className="text-subhead text-ink-2">
          {line}
        </p>
      ))}
    </ListItem>
  );
}

function Lines({ counter }: { counter: CounterView }) {
  return (
    <ListItem className="gap-1 py-3">
      <p className="text-subhead text-ink-2">{counter.label}</p>
      {counter.lines.map((line) => (
        <p key={line} className="text-body break-words">
          {line}
        </p>
      ))}
    </ListItem>
  );
}

function HintItem({ hint }: { hint: HintView }) {
  return (
    <ListItem className="py-3">
      <p className="flex items-start gap-3 text-body break-words">
        {hint.tone === "attention" ? (
          <span
            aria-hidden="true"
            className="mt-2 size-2.5 shrink-0 rounded-full bg-attention ring-4 ring-attention/20"
          />
        ) : null}
        <span className={hint.tone === "attention" ? "text-ink" : "text-ink-2"}>
          {hint.text}
        </span>
      </p>
    </ListItem>
  );
}

export interface ModuleSectionProps {
  view: ModuleView;
  /** Extra rows at the end of the group, e.g. the employee's fields. */
  children?: ReactNode;
  "data-testid"?: string;
}

/**
 * One module for one person: its counters and hints, then any extra rows,
 * with the "indicatief" note under the group. Renders nothing when there is
 * nothing to show.
 */
export function ModuleSection({
  view,
  children,
  "data-testid": testId,
}: ModuleSectionProps) {
  const hasContent =
    view.counters.length > 0 || view.hints.length > 0 || children !== undefined;
  if (!hasContent) return null;
  const counted = view.counters.length > 0 || view.hints.length > 0;

  return (
    <Section
      header={view.label}
      footer={counted ? t("modules.indicative") : undefined}
      data-testid={testId ?? `module-${view.id}`}
    >
      {view.counters.map((counter) =>
        counter.display === "figure" ? (
          <Figure key={counter.id} counter={counter} />
        ) : counter.display === "lines" ? (
          <Lines key={counter.id} counter={counter} />
        ) : (
          // The value under the label: it is often too long to share a line on a phone.
          <Row
            key={counter.id}
            title={counter.label}
            subtitle={counter.value ?? undefined}
          />
        ),
      )}
      {view.hints.map((hint) => (
        <HintItem key={hint.id} hint={hint} />
      ))}
      {children}
    </Section>
  );
}
