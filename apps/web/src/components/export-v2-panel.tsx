"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { exportV2Action } from "@/lib/time-exports-v2/actions";
import type { V2Manifest, V2ActionState } from "@/lib/time-exports-v2/model";
import { formatExactDuration } from "@/lib/time-clock/breaks";
import { toBrusselsLocalInput } from "@/lib/corrections/format";
const blockerCopy = {
  open_entry: "Een werkperiode staat nog open.",
  pending_correction: "Een tijdcorrectie wacht op afhandeling.",
  pending_break_correction: "Een pauzeaanvraag wacht op afhandeling.",
  no_records: "Geen afgesloten werkperiodes in deze periode.",
  row_limit: "Meer dan 10.000 werkperiodes. Kies een kleinere periode.",
  artifact_too_large: "De export is te groot. Kies een kleinere periode.",
};
const field =
  "mt-2 min-h-11 w-full min-w-0 rounded-lg border border-rule-strong bg-paper px-3 py-2 text-ink focus-visible:outline-2 focus-visible:outline-focus";
function Downloads({ manifest: m }: { manifest: V2Manifest }) {
  return (
    <div className="mt-3 flex flex-wrap gap-3">
      {(["csv", "json"] as const).map((format) => (
        <Button asChild variant="secondary" key={format}>
          <a href={`/manager/exports-v2/${m.export_id}/${format}`}>
            Download {format.toUpperCase()}
          </a>
        </Button>
      ))}
    </div>
  );
}
export function ExportV2Panel({ history }: { history: V2Manifest[] | null }) {
  const [state, setState] = useState<V2ActionState>({ message: "" });
  const [pending, startTransition] = useTransition();
  const ids = useRef(new Map<string, string>());
  const feedback = useRef<HTMLParagraphElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.message) feedback.current?.focus();
  }, [state]);
  function run(intent: "preview" | "create") {
    if (!form.current?.reportValidity()) return;
    const data = new FormData(form.current);
    const payload = {
      intent,
      start: String(data.get("start")),
      end: String(data.get("end")),
      confirmed: intent === "create" && data.get("confirmed") === "on",
    };
    if (
      intent === "create" &&
      (!state.preview ||
        state.preview.period_start_local !== payload.start ||
        state.preview.period_end_local !== payload.end)
    ) {
      setState({ message: "Laad eerst een nieuw voorbeeld voor deze periode." });
      return;
    }
    if (intent === "create" && !payload.confirmed) {
      setState({ message: "Bevestig dat u deze feitelijke versies wilt vastleggen." });
      return;
    }
    const key = JSON.stringify(payload),
      id = ids.current.get(key) ?? crypto.randomUUID();
    ids.current.set(key, id);
    startTransition(async () => {
      try {
        const result = await exportV2Action({ ...payload, request_id: id });
        if (result.requestId === id) ids.current.delete(key);
        setState(result);
      } catch {
        setState({
          message: "Export niet bevestigd. Probeer opnieuw met dezelfde gegevens.",
        });
      }
    });
  }
  return (
    <div className="mt-6 min-w-0">
      <nav className="flex flex-wrap gap-4" aria-label="Exportnavigatie">
        <Link className="text-primary underline underline-offset-4" href="/manager">
          Terug naar werkruimte
        </Link>
        <Link
          className="text-primary underline underline-offset-4"
          href="/manager/exports"
        >
          Export v1 zonder pauzehistoriek
        </Link>
      </nav>
      <p className="mt-4 text-sm text-muted">
        V1 blijft beschikbaar voor werkperiodes zonder eerdere pauzefeiten. Een
        verwijderde pauze blijft deel van de historiek en blokkeert een nieuwe
        v1-export.
      </p>
      <p className="my-5 break-words" ref={feedback} tabIndex={-1} role="status">
        {state.message}
      </p>
      <form
        ref={form}
        onSubmit={(e) => {
          e.preventDefault();
          run("preview");
        }}
      >
        <fieldset disabled={pending} className="min-w-0">
          <legend className="font-display text-3xl font-semibold">
            Periode in Brussel
          </legend>
          <p className="mt-2 text-sm text-muted">
            Kies 1 tot 31 dagen, tot en met vandaag. De begindatum van de werkperiode
            bepaalt de selectie.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="min-w-0 font-semibold">
              Van
              <input
                name="start"
                className={field}
                type="date"
                required
                onChange={() => setState({ message: "" })}
              />
            </label>
            <label className="min-w-0 font-semibold">
              Tot en met
              <input
                name="end"
                className={field}
                type="date"
                required
                onChange={() => setState({ message: "" })}
              />
            </label>
          </div>
          <Button className="mt-5" type="submit">
            {pending ? "Bezig met verwerken…" : "Voorbeeld laden"}
          </Button>
          {state.preview && (
            <section
              className="mt-6 border-y border-rule py-5"
              aria-label="Exportvoorbeeld v2"
            >
              <h2 className="font-display text-2xl font-semibold">
                Voorbeeld: {state.preview.record_count} werkperiodes
              </h2>
              <p className="mt-2">
                {state.preview.employee_count} medewerkers ·{" "}
                {state.preview.period_start_local} – {state.preview.period_end_local}
              </p>
              <ul className="mt-3 space-y-2 text-danger">
                {state.preview.blockers.map((b) => (
                  <li key={b}>{blockerCopy[b]}</li>
                ))}
              </ul>
              {state.preview.warnings.length > 0 && (
                <p className="mt-3 text-muted">
                  Bij sommige medewerkers ontbreekt een code of naam. Die velden blijven
                  leeg.
                </p>
              )}
              <details className="mt-4">
                <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                  Feitelijke versies en pauzes bekijken
                </summary>
                <ul className="space-y-4">
                  {state.preview.records.map((r) => (
                    <li
                      key={r.source_time_entry_id}
                      className="border-t border-rule pt-3 text-sm break-words"
                    >
                      <p className="font-semibold">
                        {r.employee_display_name ?? "Naam ontbreekt"} ·{" "}
                        {r.employee_code ?? "Code ontbreekt"} · versie{" "}
                        {r.source_time_entry_version}
                      </p>
                      <p>
                        {toBrusselsLocalInput(r.started_at_utc)} –{" "}
                        {toBrusselsLocalInput(r.ended_at_utc)} (Brussel)
                      </p>
                      <p>
                        Bruto:{" "}
                        {formatExactDuration(BigInt(r.gross_duration_microseconds))}
                      </p>
                      <p>
                        Pauzes ({r.effective_break_count}):{" "}
                        {formatExactDuration(
                          BigInt(r.unpaid_break_duration_microseconds),
                        )}
                      </p>
                      <p>
                        Netto gewerkt:{" "}
                        {formatExactDuration(
                          BigInt(r.net_worked_duration_microseconds),
                        )}
                      </p>
                      {r.breaks.map((b) => (
                        <p key={b.logical_break_id}>
                          Pauze versie {b.version}:{" "}
                          {toBrusselsLocalInput(b.started_at_utc)} –{" "}
                          {toBrusselsLocalInput(b.ended_at_utc)}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              </details>
              <label className="mt-5 flex min-h-11 items-start gap-3">
                <input
                  className="mt-1 size-5 shrink-0 accent-primary"
                  type="checkbox"
                  name="confirmed"
                />
                <span>
                  Ik bevestig de vastlegging van de feitelijke versies. De selectie
                  wordt bij bevestiging opnieuw gecontroleerd.
                </span>
              </label>
              <Button
                className="mt-4"
                type="button"
                disabled={pending || state.preview.blockers.length > 0}
                onClick={() => run("create")}
              >
                Export v2 bevestigen
              </Button>
            </section>
          )}
        </fieldset>
      </form>
      {state.manifest && (
        <section className="mt-6" aria-label="Nieuwe export">
          <h2 className="font-display text-2xl font-semibold">
            Nieuwe export vastgelegd
          </h2>
          <Downloads manifest={state.manifest} />
        </section>
      )}
      <section className="mt-10 border-t border-rule pt-6">
        <h2 className="font-display text-3xl font-semibold">Exportgeschiedenis v2</h2>
        {history === null ? (
          <p className="mt-4" role="alert">
            Exportgeschiedenis kan niet worden geladen.
          </p>
        ) : !history.length ? (
          <p className="mt-4">Nog geen v2-exports.</p>
        ) : (
          history.map((m) => (
            <article
              key={m.export_id}
              className="border-b border-rule py-5 break-words"
            >
              <h3 className="font-semibold">
                {m.period_start_local} – {m.period_end_local} · {m.record_count}{" "}
                werkperiodes
              </h3>
              <p className="mt-2 text-sm">
                Vastgelegd {toBrusselsLocalInput(m.created_at_utc)} (Brussel)
              </p>
              <p className="mt-2 text-sm">
                Bruto:{" "}
                {formatExactDuration(BigInt(m.total_gross_duration_microseconds))} ·
                Pauzes:{" "}
                {formatExactDuration(
                  BigInt(m.total_unpaid_break_duration_microseconds),
                )}{" "}
                · Netto:{" "}
                {formatExactDuration(BigInt(m.total_net_worked_duration_microseconds))}
              </p>
              <details className="mt-3 text-sm">
                <summary className="min-h-11 cursor-pointer py-2">
                  Datasetcontrole
                </summary>
                <p className="break-all">{m.dataset_sha256}</p>
              </details>
              <Downloads manifest={m} />
            </article>
          ))
        )}
      </section>
    </div>
  );
}
