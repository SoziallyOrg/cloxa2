/// <reference types="react/canary" />
"use client";

import { addTransitionType, startTransition, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import { formatBrusselsTime, t } from "@cloxa/i18n";
import type { RequestCorrectionInput } from "@cloxa/db";

import type { CorrectionDay } from "@/lib/corrections/days";
import {
  buildCorrectionPayload,
  canAdvance,
  goBack,
  goNext,
  INITIAL_CORRECTION_FORM_STATE,
  type CorrectionEventType,
  type CorrectionFormState,
  type CorrectionKind,
  type CorrectionTargetOption,
} from "@/lib/corrections/form";

import { Button, buttonClassName } from "../ui/Button";
import { cx } from "../ui/cx";
import { error as errorHaptic, tap } from "../ui/haptics";
import { List, ListItem, Row, Section } from "../ui/List";
import { NavBar } from "../ui/NavBar";
import { Notice } from "../ui/Notice";
import { PageTransition } from "../ui/PageTransition";
import { POP, PUSH } from "../ui/transitions";
import { ChangeTiles } from "./ChangeTiles";

export interface CorrectionFormProps {
  siteId: string;
  /** The last 14 days, newest first, each with its events. */
  days: readonly CorrectionDay[];
  /** Set when started from a day or shift ("Klopt er iets niet?"): no day list then. */
  preselectedDate: string | null;
  /** Where the first step's back button goes: the page this was opened from. */
  back: { href: string; label: string };
  submitAction: (
    input: RequestCorrectionInput,
  ) => Promise<{ ok: boolean; errorKey?: string }>;
}

type Key = Parameters<typeof t>[0];

const KIND_OPTIONS: readonly { kind: CorrectionKind; labelKey: Key }[] = [
  { kind: "add", labelKey: "correctionForm.kindAdd" },
  { kind: "adjust", labelKey: "correctionForm.kindAdjust" },
  { kind: "remove", labelKey: "correctionForm.kindRemove" },
];

const EVENT_TYPE_OPTIONS: readonly { type: CorrectionEventType; labelKey: Key }[] = [
  { type: "clock_in", labelKey: "correctionForm.eventTypeClockIn" },
  { type: "clock_out", labelKey: "correctionForm.eventTypeClockOut" },
  { type: "break_start", labelKey: "correctionForm.eventTypeBreakStart" },
  { type: "break_end", labelKey: "correctionForm.eventTypeBreakEnd" },
];

const KIND_LABEL_KEY: Record<CorrectionKind, Key> = {
  add: "correctionForm.kindAdd",
  adjust: "correctionForm.kindAdjust",
  remove: "correctionForm.kindRemove",
};

const eventLabel = (type: CorrectionEventType) =>
  t(
    EVENT_TYPE_OPTIONS.find((option) => option.type === type)?.labelKey ??
      "correctionForm.eventTypeClockIn",
  );

/** One screen of the wizard; each is "pushed" onto the one before it. */
type View = "kind" | "day" | "moment" | "reason" | "done";

/** Three bars plus "Stap 1 van 3": where you are in the wizard (the words carry it, not the colour). */
function StepDots({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center gap-3 px-1">
      <span aria-hidden="true" className="flex gap-1.5">
        {[1, 2, 3].map((bar) => (
          <span
            key={bar}
            className={cx(
              "h-2 w-10 rounded-full",
              bar <= step ? "bg-forest" : "bg-track",
            )}
          />
        ))}
      </span>
      <p className="text-subhead font-semibold text-ink-2">
        {t("correctionForm.stepOf", { step })}
      </p>
    </div>
  );
}

/** The bottom action, in reach of the thumb and above the tab bar on phones. */
function BottomAction({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-[calc(var(--spacing-tab-bar)+env(safe-area-inset-bottom))] mt-auto flex flex-col gap-3 bg-paper px-gutter pt-2 pb-4 md:static md:mt-0 md:bg-transparent md:px-gutter-desktop md:pb-10 lg:max-w-readable">
      {children}
    </div>
  );
}

/**
 * "Klopt er iets niet?" as pushed screens, one question each: what is
 * wrong, which day (unless it came with the link), which moment, and why.
 * Forward slides in from the right, the back chevron slides it out again.
 * The step logic lives in `lib/corrections/form`.
 */
export function CorrectionForm({
  siteId,
  days,
  preselectedDate,
  back,
  submitAction,
}: CorrectionFormProps) {
  const router = useRouter();
  const [state, setState] = useState<CorrectionFormState>({
    ...INITIAL_CORRECTION_FORM_STATE,
    date: preselectedDate ?? days[0]?.key ?? "",
  });
  // Step 2 starts with "Welke dag?" unless the day came with the link.
  const [dayChosen, setDayChosen] = useState(preselectedDate !== null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const day = days.find((candidate) => candidate.key === state.date);
  const targets = day?.targets ?? [];
  const payload = useMemo(() => buildCorrectionPayload(state, siteId), [state, siteId]);

  const view: View = done
    ? "done"
    : state.step === 1
      ? "kind"
      : state.step === 3
        ? "reason"
        : dayChosen
          ? "moment"
          : "day";

  const momentTitle =
    state.kind === "remove"
      ? t("correctionForm.step2TitleRemove")
      : t("correctionForm.step2Title");
  const TITLES: Record<View, string> = {
    kind: t("correctionForm.step1Title"),
    day: t("correctionForm.dayTitle"),
    moment: momentTitle,
    reason: t("correctionForm.step3Title"),
    done: t("correctionForm.doneTitle"),
  };

  /** A push (forward) or pop (back) between two screens of the wizard. */
  function move(direction: "forward" | "back", update: () => void) {
    setError(null);
    startTransition(() => {
      addTransitionType((direction === "forward" ? PUSH : POP)[0]!);
      update();
    });
  }

  function goBackOneScreen() {
    move("back", () => {
      if (view === "moment" && preselectedDate === null) {
        setDayChosen(false);
        return;
      }
      setState(goBack);
    });
  }

  const previousView: View | null =
    view === "day"
      ? "kind"
      : view === "moment"
        ? preselectedDate === null
          ? "day"
          : "kind"
        : view === "reason"
          ? "moment"
          : null;

  async function handleSubmit() {
    if (payload === null || submitting) return;
    const toSubmit = payload;
    setSubmitting(true);
    setError(null);
    const result = await submitAction(toSubmit);
    setSubmitting(false);
    if (!result.ok) {
      errorHaptic();
      setError(t((result.errorKey as Key) ?? "correctionForm.genericError"));
      return;
    }
    tap();
    move("forward", () => setDone(true));
    router.refresh();
  }

  const navBack =
    view === "done"
      ? undefined
      : view === "kind"
        ? back
        : previousView
          ? { label: TITLES[previousView], onClick: goBackOneScreen }
          : undefined;

  return (
    <PageTransition key={view} className="flex flex-1 flex-col">
      <NavBar
        title={TITLES[view]}
        {...(navBack ? { back: navBack } : {})}
        {...(view === "moment" && day ? { subtitle: day.longLabel } : {})}
      />

      {view === "done" ? (
        <>
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center">
            <span
              aria-hidden="true"
              className="on-forest mb-2 flex size-20 items-center justify-center rounded-hero bg-forest text-lime motion-safe:animate-pop-in"
            >
              <Check className="size-8" strokeWidth={2.5} />
            </span>
            <p role="status" className="text-title-3 font-semibold">
              {t("correctionForm.submitted")}
            </p>
            <p className="max-w-sm text-body text-ink-2">
              {t("correctionForm.doneBody")}
            </p>
          </div>
          <BottomAction>
            <Link
              href="/app/vragen"
              transitionTypes={POP}
              className={buttonClassName("primary", "md", true)}
            >
              {t("correctionForm.toQuestions")}
            </Link>
          </BottomAction>
        </>
      ) : (
        <>
          <List className="pb-6 lg:max-w-readable">
            <StepDots step={state.step} />
            {view === "kind" ? (
              <Section>
                {KIND_OPTIONS.map((option) => (
                  <Row
                    key={option.kind}
                    aria-pressed={state.kind === option.kind}
                    title={t(option.labelKey)}
                    checked={state.kind === option.kind}
                    onClick={() =>
                      setState((current) => ({
                        ...current,
                        kind: option.kind,
                        targetEventId: null,
                      }))
                    }
                  />
                ))}
              </Section>
            ) : null}

            {view === "day" ? (
              <Section>
                {days.map((candidate) => (
                  <Row
                    key={candidate.key}
                    aria-label={`${candidate.label}, ${candidate.summary}`}
                    title={candidate.label}
                    subtitle={candidate.summary}
                    chevron
                    onClick={() =>
                      move("forward", () => {
                        setState((current) => ({
                          ...current,
                          date: candidate.key,
                          targetEventId: null,
                        }));
                        setDayChosen(true);
                      })
                    }
                  />
                ))}
              </Section>
            ) : null}

            {view === "moment" ? (
              <MomentStep state={state} targets={targets} setState={setState} />
            ) : null}

            {view === "reason" ? (
              <ReasonStep
                state={state}
                day={day ?? null}
                targets={targets}
                setState={setState}
              />
            ) : null}
          </List>

          {view === "day" ? null : (
            <BottomAction>
              {error ? (
                <Notice tone="error" onDismiss={() => setError(null)}>
                  {error}
                </Notice>
              ) : null}
              {view === "reason" ? (
                <Button
                  wide
                  loading={submitting}
                  disabled={payload === null}
                  onClick={() => void handleSubmit()}
                >
                  {t("correctionForm.submit")}
                </Button>
              ) : (
                <Button
                  wide
                  disabled={!canAdvance(state, targets)}
                  onClick={() =>
                    move("forward", () =>
                      setState((current) => goNext(current, targets)),
                    )
                  }
                >
                  {t("correctionForm.next")}
                </Button>
              )}
            </BottomAction>
          )}
        </>
      )}
    </PageTransition>
  );
}

interface StepProps {
  state: CorrectionFormState;
  targets: readonly CorrectionTargetOption[];
  setState: React.Dispatch<React.SetStateAction<CorrectionFormState>>;
}

/** Step 2: which moment (and its time), or which registration to change. */
function MomentStep({ state, targets, setState }: StepProps) {
  const needsTime =
    state.kind === "add" || (state.kind === "adjust" && targets.length > 0);

  return (
    <>
      {state.kind === "add" ? (
        <Section header={t("correctionForm.eventTypeLabel")}>
          {EVENT_TYPE_OPTIONS.map((option) => (
            <Row
              key={option.type}
              aria-pressed={state.eventType === option.type}
              title={t(option.labelKey)}
              checked={state.eventType === option.type}
              onClick={() =>
                setState((current) => ({ ...current, eventType: option.type }))
              }
            />
          ))}
        </Section>
      ) : targets.length === 0 ? (
        <p className="px-4 text-body text-ink-2">{t("correctionForm.noTargets")}</p>
      ) : (
        <Section header={t("correctionForm.targetLabel")}>
          {targets.map((target) => {
            const label = eventLabel(target.type);
            const time = formatBrusselsTime(new Date(target.occurredAtIso));
            return (
              <Row
                key={target.id}
                aria-pressed={state.targetEventId === target.id}
                aria-label={t("correctionForm.targetOption", { type: label, time })}
                title={label}
                value={time}
                checked={state.targetEventId === target.id}
                onClick={() =>
                  setState((current) => ({ ...current, targetEventId: target.id }))
                }
              />
            );
          })}
        </Section>
      )}

      {needsTime ? (
        // A large, calm, filled field: "08:00" in big tabular text, with the
        // native picker (a wheel on iOS) behind it.
        <div className="flex flex-col gap-2">
          <label htmlFor="time" className="px-4 text-subhead text-ink-2">
            {state.kind === "add"
              ? t("correctionForm.timeLabel")
              : t("correctionForm.newTimeLabel")}
          </label>
          <input
            id="time"
            type="time"
            value={state.time}
            onChange={(event) =>
              setState((current) => ({ ...current, time: event.target.value }))
            }
            className="min-h-16 w-full rounded-control border border-field bg-card px-4 text-large-title text-ink tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
          />
        </div>
      ) : null}
    </>
  );
}

/** Step 3: an optional reason, and what will be sent. */
function ReasonStep({
  state,
  day,
  targets,
  setState,
}: StepProps & { day: CorrectionDay | null }) {
  const target = targets.find((candidate) => candidate.id === state.targetEventId);
  const moment =
    state.kind === "add" && state.eventType
      ? t("correctionForm.targetOption", {
          type: eventLabel(state.eventType),
          time: state.time,
        })
      : target
        ? t("correctionForm.targetOption", {
            type: eventLabel(target.type),
            time: formatBrusselsTime(new Date(target.occurredAtIso)),
          })
        : null;

  const targetTime = target ? formatBrusselsTime(new Date(target.occurredAtIso)) : null;
  // "Was / Wordt" of what is being asked, the same tiles the manager decides on.
  const change =
    state.kind === "add" && state.eventType && state.time
      ? {
          label: eventLabel(state.eventType),
          was: t("questions.wasNone"),
          willBe: state.time,
        }
      : state.kind === "adjust" && target && targetTime && state.time
        ? { label: eventLabel(target.type), was: targetTime, willBe: state.time }
        : state.kind === "remove" && target && targetTime
          ? {
              label: eventLabel(target.type),
              was: targetTime,
              willBe: t("questions.willBeRemoved"),
            }
          : null;

  return (
    <>
      <Section footer={<span id="reason-hint">{t("correctionForm.reasonHint")}</span>}>
        <ListItem className="gap-1">
          <label htmlFor="reason" className="text-subhead text-ink-2">
            {t("correctionForm.reasonLabel")} <span>({t("ui.optional")})</span>
          </label>
          <textarea
            id="reason"
            rows={3}
            maxLength={280}
            aria-describedby="reason-hint"
            value={state.reason}
            onChange={(event) =>
              setState((current) => ({ ...current, reason: event.target.value }))
            }
            className="focus-ring -mx-1 min-h-20 resize-none rounded-md border-0 bg-transparent px-1 text-body text-ink focus-visible:outline-offset-0"
          />
        </ListItem>
      </Section>

      {change ? <ChangeTiles {...change} /> : null}

      <Section header={t("correctionForm.summaryTitle")}>
        <ListItem className="gap-1 text-body">
          <p>
            {t("correctionForm.summaryKind", {
              value: t(KIND_LABEL_KEY[state.kind ?? "add"]),
            })}
          </p>
          {day ? (
            <p>{t("correctionForm.summaryDay", { value: day.longLabel })}</p>
          ) : null}
          {moment ? (
            <p>{t("correctionForm.summaryMoment", { value: moment })}</p>
          ) : null}
          {state.kind === "adjust" && state.time ? (
            <p>{t("correctionForm.summaryNewTime", { value: state.time })}</p>
          ) : null}
          <p className="text-ink-2">
            {state.reason.trim()
              ? t("correctionForm.summaryReason", { value: state.reason.trim() })
              : t("correctionForm.summaryNoReason")}
          </p>
        </ListItem>
      </Section>
    </>
  );
}
