"use client";
import { AppliedCorrections } from "@/components/applied-corrections";
import type { Provenance } from "@/lib/corrections/provenance";
import { LocalTimeField } from "@/components/local-time-field";
import { DurationDetails, TimeDetails } from "@/components/exact-details";
import { StatusBadge } from "@/components/ui/status-badge";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { changeBreakCorrection } from "@/lib/break-corrections/actions";
import { breakCopy as copy } from "@/lib/break-corrections/copy";
import type {
  BreakActionState,
  BreakIntent,
  BreakView,
} from "@/lib/break-corrections/model";
import { minuteInput } from "@/lib/corrections/local-time";
import { toBrusselsLocalInput } from "@/lib/corrections/format";
import { exactMicroseconds } from "@/lib/time-clock/breaks";

const field =
  "mt-2 min-h-11 w-full min-w-0 rounded-control border border-rule-strong bg-paper px-3 py-2 text-base text-ink focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50";
const emptyIntent = {
  entry_id: null,
  target_id: null,
  expected_parent_version: null,
  expected_break_version: null,
  start_local: null,
  end_local: null,
  start_occurrence: null,
  end_occurrence: null,
  reason: null,
  confirmed: false,
};
function interval(start: string | null, end: string | null) {
  return start && end
    ? `${minuteInput(start)} – ${minuteInput(end)} (Brussel)`
    : "Geen geldend interval";
}
function ExactInterval({
  label,
  start,
  end,
}: {
  label: string;
  start: string | null;
  end: string | null;
}) {
  if (!start || !end) return null;
  return (
    <div className="mt-3">
      <p className="font-semibold">{label}</p>
      <TimeDetails value={start} />
      <TimeDetails value={end} />
    </div>
  );
}
function useOperation() {
  const ids = useRef(new Map<string, string>());
  const [feedback, setFeedback] = useState<BreakActionState>({ message: "" });
  const [pending, startTransition] = useTransition();
  const focus = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (feedback.message) focus.current?.focus();
  }, [feedback]);
  function run(payload: Record<string, unknown>) {
    const key = JSON.stringify(payload);
    const requestId = ids.current.get(key) ?? crypto.randomUUID();
    ids.current.set(key, requestId);
    startTransition(async () => {
      try {
        const result = await changeBreakCorrection({
          ...payload,
          request_id: requestId,
        });
        if (result.requestId === requestId) ids.current.delete(key);
        setFeedback(result);
      } catch {
        setFeedback({ message: copy.failure });
      }
    });
  }
  return { run, pending, feedback, focus };
}
export function BreakCorrectionPanel({
  view,
  manager,
  provenance = null,
}: {
  view: BreakView | null;
  manager: boolean;
  provenance?: Provenance | null;
}) {
  const [entryId, setEntryId] = useState(view?.entries[0]?.id ?? "");
  const [intent, setIntent] = useState<BreakIntent>("missed_break");
  const [targetId, setTargetId] = useState("");
  const { run, pending, feedback, focus: feedbackRef } = useOperation();
  const entry = view?.entries.find((e) => e.id === entryId);
  const effective = entry?.breaks.filter((b) => !b.removed) ?? [];
  const target = effective.find((b) => b.logical_break_id === targetId);
  return (
    <div className="mt-6 min-w-0">
      <p
        ref={feedbackRef}
        tabIndex={-1}
        role="status"
        className="my-5 break-words outline-offset-4"
      >
        {feedback.message}
      </p>
      {!view ? (
        <p role="alert">
          Pauzeaanvragen kunnen niet worden geladen. Vernieuw de pagina.
        </p>
      ) : (
        <>
          {!manager && (
            <>
              <h2 className="font-display text-3xl font-semibold">
                Nieuwe pauzeaanvraag
              </h2>
              {view.entries.length === 0 ? (
                <p className="mt-3">Er zijn nog geen afgesloten werkperiodes.</p>
              ) : (
                <>
                  <label className="mt-5 block font-semibold">
                    Werkperiode
                    <select
                      className={field}
                      aria-label="Werkperiode"
                      value={entryId}
                      onChange={(e) => {
                        setEntryId(e.target.value);
                        setTargetId("");
                      }}
                      disabled={pending}
                    >
                      {view.entries.map((e) => (
                        <option key={e.id} value={e.id}>
                          {minuteInput(e.started_at)} –{" "}
                          {minuteInput(e.started_at).slice(0, 10) ===
                          minuteInput(e.ended_at).slice(0, 10)
                            ? minuteInput(e.ended_at).slice(11)
                            : minuteInput(e.ended_at)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {entry && (
                    <section
                      className="my-5 border-y border-rule py-5"
                      aria-label="Geldende pauzes en totalen"
                    >
                      <h3 className="font-semibold">
                        Geldende feiten · werkperiode versie {entry.version}
                      </h3>
                      <div className="mt-2 text-sm">
                        <TimeDetails value={entry.started_at} />
                        <TimeDetails value={entry.ended_at} />
                      </div>
                      <AppliedCorrections provenance={provenance?.[entry.id]} />
                      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                        {[
                          [
                            "Bruto",
                            exactMicroseconds(entry.ended_at) -
                              exactMicroseconds(entry.started_at),
                          ],
                          [
                            "Onbetaalde pauzes",
                            effective.reduce(
                              (s, b) =>
                                s +
                                exactMicroseconds(b.ended_at!) -
                                exactMicroseconds(b.started_at!),
                              0n,
                            ),
                          ],
                          [
                            "Netto gewerkt",
                            exactMicroseconds(entry.ended_at) -
                              exactMicroseconds(entry.started_at) -
                              effective.reduce(
                                (s, b) =>
                                  s +
                                  exactMicroseconds(b.ended_at!) -
                                  exactMicroseconds(b.started_at!),
                                0n,
                              ),
                          ],
                        ].map(([label, value]) => (
                          <div key={String(label)}>
                            <dt className="text-muted">{String(label)}</dt>
                            <dd className="mt-1 break-words tabular-nums">
                              {<DurationDetails value={value as bigint} />}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <ul className="mt-4 space-y-2 text-sm">
                        {entry.breaks.map((b) => (
                          <li key={b.logical_break_id} className="break-words">
                            {b.removed
                              ? "Verwijderd uit de geldende tijd; eerdere versies blijven bewaard."
                              : interval(b.started_at, b.ended_at)}{" "}
                            · pauzeversie {b.version}
                          </li>
                        ))}
                      </ul>
                      {!entry.breaks.length && (
                        <p className="mt-3 text-sm text-muted">
                          Geen pauzes vastgelegd.
                        </p>
                      )}
                    </section>
                  )}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!entry) return;
                      const data = new FormData(e.currentTarget);
                      run({
                        ...emptyIntent,
                        intent,
                        entry_id: entry.id,
                        expected_parent_version: entry.version,
                        target_id:
                          intent === "missed_break"
                            ? null
                            : (target?.logical_break_id ?? null),
                        expected_break_version:
                          intent === "missed_break" ? null : (target?.version ?? null),
                        start_local:
                          intent === "removal" ? null : String(data.get("start")),
                        end_local:
                          intent === "removal" ? null : String(data.get("end")),
                        start_occurrence:
                          intent === "removal"
                            ? null
                            : String(data.get("start_occurrence")),
                        end_occurrence:
                          intent === "removal"
                            ? null
                            : String(data.get("end_occurrence")),
                        start_expected:
                          intent === "adjustment"
                            ? String(data.get("start_expected") ?? "")
                            : "",
                        end_expected:
                          intent === "adjustment"
                            ? String(data.get("end_expected") ?? "")
                            : "",
                        reason: String(data.get("reason")),
                      });
                    }}
                  >
                    <fieldset disabled={pending} className="min-w-0 space-y-5">
                      <legend className="sr-only">Pauzeaanvraag</legend>
                      <label className="block font-semibold">
                        Soort aanvraag
                        <select
                          className={field}
                          aria-label="Soort aanvraag"
                          value={intent}
                          onChange={(e) => setIntent(e.target.value as BreakIntent)}
                        >
                          {Object.entries(copy.kinds).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {intent !== "missed_break" && (
                        <label className="block font-semibold">
                          Pauze
                          <select
                            className={field}
                            required
                            aria-label="Pauze"
                            value={targetId}
                            onChange={(e) => setTargetId(e.target.value)}
                          >
                            <option value="">Kies een geldende pauze</option>
                            {effective.map((b) => (
                              <option
                                key={b.logical_break_id}
                                value={b.logical_break_id}
                              >
                                {interval(b.started_at, b.ended_at)} · versie{" "}
                                {b.version}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {intent !== "removal" && (
                        <div
                          key={`${entryId}-${intent}-${targetId}`}
                          className="grid gap-5 sm:grid-cols-2"
                        >
                          <LocalTimeField
                            name="start"
                            label="Begin pauze"
                            instant={
                              intent === "adjustment"
                                ? (target?.started_at ?? undefined)
                                : undefined
                            }
                          />
                          <LocalTimeField
                            name="end"
                            label="Einde pauze"
                            instant={
                              intent === "adjustment"
                                ? (target?.ended_at ?? undefined)
                                : undefined
                            }
                          />
                        </div>
                      )}
                      <p className="text-sm text-muted">
                        Vul datum en tijd in als dd/mm/jjjj uu:mm. Ongewijzigde tijden
                        blijven exact behouden.
                      </p>
                      <label className="block font-semibold">
                        Reden
                        <textarea
                          className={field}
                          name="reason"
                          maxLength={500}
                          required
                          rows={3}
                        />
                      </label>
                      <Button
                        type="submit"
                        disabled={pending || (intent !== "missed_break" && !target)}
                      >
                        {pending ? "Bezig met verwerken…" : "Pauzeaanvraag indienen"}
                      </Button>
                    </fieldset>
                  </form>
                </>
              )}
            </>
          )}
          <section
            className="mt-10 border-t border-rule pt-6"
            aria-label="Pauzeaanvragen"
          >
            <h2 className="font-display text-3xl font-semibold">
              Aanvragen en geschiedenis
            </h2>
            {!view.requests.length && <p className="mt-4">Nog geen pauzeaanvragen.</p>}
            {view.requests.map((r) => (
              <article
                key={r.id}
                id={`request-${r.id}`}
                className="border-b border-rule py-6 break-words"
              >
                <h3 className="text-lg font-semibold">
                  {copy.kinds[r.request_kind]}{" "}
                  <StatusBadge status={r.status}>{copy.statuses[r.status]}</StatusBadge>
                </h3>
                <p className="mt-2 text-sm text-muted">
                  Ingediend {toBrusselsLocalInput(r.created_at)} · Werkperiode versie{" "}
                  {r.parent_version}
                </p>
                <p className="mt-3">
                  Werkperiode: {interval(r.parent_started_at, r.parent_ended_at)}
                </p>
                {manager && (
                  <p className="mt-2 text-sm break-all">
                    Medewerker: {r.employee_display_name ?? "Naam ontbreekt"} ·{" "}
                    {r.employee_code ?? "Code ontbreekt"}
                  </p>
                )}
                <p className="mt-3">
                  Oorspronkelijke pauze:{" "}
                  {r.original_snapshot
                    ? `${interval(r.original_snapshot.started_at, r.original_snapshot.ended_at)} · versie ${r.original_snapshot.version}`
                    : "Geen; vergeten pauze gemeld."}
                </p>
                {manager && (
                  <div className="mt-3 border-y border-rule py-3 text-sm">
                    <p>
                      Huidige werkperiode:{" "}
                      {interval(r.current_parent_started_at, r.current_parent_ended_at)}{" "}
                      · versie {r.current_parent_version}
                    </p>
                    <p className="mt-2">
                      Huidige pauze:{" "}
                      {r.current_snapshot
                        ? `${interval(r.current_snapshot.started_at, r.current_snapshot.ended_at)} · versie ${r.current_snapshot.version}`
                        : "Nog geen pauzefeit."}
                    </p>
                  </div>
                )}
                <p className="mt-2">
                  Voorstel:{" "}
                  {r.request_kind === "removal"
                    ? "Niet meer meetellen als pauze; geschiedenis blijft bewaard."
                    : interval(r.proposed_started_at, r.proposed_ended_at)}
                </p>
                <details className="mt-3 text-sm">
                  <summary className="min-h-11 cursor-pointer py-2 text-primary">
                    Tijdstippen en versies vergelijken
                  </summary>
                  <ExactInterval
                    label="Oorspronkelijke pauze"
                    start={r.original_snapshot?.started_at ?? null}
                    end={r.original_snapshot?.ended_at ?? null}
                  />
                  <ExactInterval
                    label="Voorgestelde pauze"
                    start={r.proposed_started_at}
                    end={r.proposed_ended_at}
                  />
                  {manager && (
                    <ExactInterval
                      label="Huidige pauze"
                      start={r.current_snapshot?.started_at ?? null}
                      end={r.current_snapshot?.ended_at ?? null}
                    />
                  )}
                  {r.applied_revision_id && (
                    <p className="mt-3 break-all">
                      Toegepaste revisie: {r.applied_revision_id}
                    </p>
                  )}
                </details>
                {r.status === "pending" && r.stale && (
                  <p className="mt-3 font-semibold text-danger">
                    Verouderde aanvraag. De vastgelegde versie is veranderd.
                  </p>
                )}
                <p className="mt-3 whitespace-pre-wrap">Reden: {r.employee_reason}</p>
                {r.manager_note && (
                  <p className="mt-3 whitespace-pre-wrap">
                    Toelichting beheerder: {r.manager_note}
                  </p>
                )}
                {r.decided_at && (
                  <p className="mt-2 text-sm">
                    Afgehandeld {toBrusselsLocalInput(r.decided_at)} (Brussel)
                  </p>
                )}
                {r.status === "pending" &&
                  (manager ? (
                    <ReviewForm
                      requestId={r.id}
                      stale={r.stale}
                      run={run}
                      pending={pending}
                    />
                  ) : (
                    <Button
                      className="mt-4"
                      variant="secondary"
                      disabled={pending}
                      onClick={() =>
                        run({ ...emptyIntent, intent: "withdraw", target_id: r.id })
                      }
                    >
                      Aanvraag intrekken
                    </Button>
                  ))}
              </article>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
function ReviewForm({
  requestId,
  stale,
  run,
  pending,
}: {
  requestId: string;
  stale: boolean;
  run: (payload: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [decision, setDecision] = useState("approve");
  return (
    <form
      className="mt-5"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        run({
          ...emptyIntent,
          intent: decision,
          target_id: requestId,
          reason: String(data.get("note")),
          confirmed: data.get("confirmed") === "on",
        });
      }}
    >
      <fieldset disabled={pending} className="min-w-0 space-y-4">
        <legend className="sr-only">Beslissing bevestigen</legend>
        <label className="block font-semibold">
          Beslissing
          <select
            className={field}
            aria-label="Beslissing"
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
          >
            <option value="approve">Goedkeuren</option>
            <option value="reject">Afwijzen</option>
          </select>
        </label>
        <label className="block font-semibold">
          Toelichting {decision === "reject" ? "(verplicht)" : "(optioneel)"}
          <textarea
            name="note"
            className={field}
            maxLength={500}
            required={decision === "reject"}
            rows={3}
          />
        </label>
        <label className="flex min-h-11 items-start gap-3 py-2">
          <input
            className="mt-1 size-5 shrink-0 accent-primary"
            name="confirmed"
            type="checkbox"
            required
          />
          <span>
            Ik heb de feiten, het voorstel en de reden gecontroleerd en bevestig deze
            beslissing.
          </span>
        </label>
        <Button type="submit" disabled={pending || (stale && decision === "approve")}>
          {pending ? "Bezig met verwerken…" : "Beslissing bevestigen"}
        </Button>
      </fieldset>
    </form>
  );
}
