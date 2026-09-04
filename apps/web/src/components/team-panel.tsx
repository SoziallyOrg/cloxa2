"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { changeTeam } from "@/lib/team/actions";
import {
  parseTeamResult,
  teamFailure,
  teamInputSchema,
  teamResultCopy,
  type TeamActionState,
  type TeamEmployee,
  type TeamRawInput,
  type TeamView,
} from "@/lib/team/model";
import { TeamOperations } from "@/lib/team/operations";

type WithoutRequest<T> = T extends unknown ? Omit<T, "request_id"> : never;
const statusLabels = {
  active: "Actief",
  suspended: "Geschorst",
  invited: "Uitgenodigd",
  inactive: "Inactief",
};
const invitationLabels = {
  pending: "In afwachting",
  accepted: "Aanvaard",
  expired: "Verlopen",
  revoked: "Ingetrokken",
};
const inputClass =
  "mt-2 min-h-11 w-full min-w-0 rounded-xl border border-rule-strong bg-paper px-3 py-2 text-ink outline-none focus-visible:ring-3 focus-visible:ring-focus disabled:opacity-55";
const headingClass = "font-display text-3xl font-semibold tracking-[-0.025em] text-ink";

function useTeamChange(view: TeamView, operations: TeamOperations) {
  const router = useRouter();
  const [state, setState] = useState<TeamActionState>({ message: "" });
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.message) feedback.current?.focus();
  }, [state]);

  async function run(draft: WithoutRequest<TeamRawInput>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const key = JSON.stringify(draft);
    const requestId = operations.request(key);
    const raw = { ...draft, request_id: requestId };
    try {
      const response = await changeTeam(raw);
      const input = teamInputSchema.safeParse(raw);
      const result = input.success
        ? parseTeamResult(response.result, input.data, view)
        : null;
      if (result) {
        operations.confirm(key, result.request_id);
        setState({ result, message: teamResultCopy[result.result_code] });
        router.refresh();
      } else {
        setState({
          message: response.fieldErrors ? response.message : teamFailure,
          ...(response.fieldErrors ? { fieldErrors: response.fieldErrors } : {}),
        });
      }
    } catch {
      setState({ message: teamFailure });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const success =
    state.result &&
    [
      "updated",
      "unchanged",
      "suspended",
      "reactivated",
      "already_active",
      "already_suspended",
    ].includes(state.result.result_code);
  const feedbackNode = (
    <p
      ref={feedback}
      tabIndex={-1}
      role={success ? "status" : "alert"}
      className="mt-3 rounded-lg text-sm leading-6 text-ink outline-none focus:ring-3 focus:ring-focus"
    >
      {state.message}
    </p>
  );
  return { run, busy, state, feedbackNode };
}

function Field({
  name,
  label,
  initial,
  error,
  hint,
}: {
  name: string;
  label: string;
  initial: string;
  error?: string | undefined;
  hint: string;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        id={id}
        name={name}
        defaultValue={initial}
        aria-invalid={!!error}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
        className={inputClass}
        autoComplete="off"
        required={name !== "employee_code"}
      />
      <p id={`${id}-hint`} className="mt-1 text-sm leading-5 text-muted">
        {hint}
      </p>
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm font-semibold text-ink">
          {error}
        </p>
      )}
    </div>
  );
}

function PilotSettings({
  view,
  operations,
}: {
  view: TeamView;
  operations: TeamOperations;
}) {
  const action = useTeamChange(view, operations);
  return (
    <section aria-labelledby="pilot-settings">
      <h2 id="pilot-settings" className={headingClass}>
        Pilotinstellingen
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        Eén organisatie en één werkplek. Tijdzone: Europe/Brussels.
      </p>
      <form
        className="mt-5"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void action.run({
            action: "update_settings",
            organization_name: String(data.get("organization_name") ?? ""),
            worksite_name: String(data.get("worksite_name") ?? ""),
          });
        }}
      >
        <fieldset disabled={action.busy} className="grid min-w-0 gap-5 sm:grid-cols-2">
          <legend className="sr-only">Namen van organisatie en werkplek</legend>
          <Field
            name="organization_name"
            label="Organisatienaam"
            initial={view.organization_name}
            error={action.state.fieldErrors?.organization_name}
            hint="1 tot 120 tekens."
          />
          <Field
            name="worksite_name"
            label="Naam van de werkplek"
            initial={view.worksite_name}
            error={action.state.fieldErrors?.worksite_name}
            hint="1 tot 120 tekens."
          />
          <div className="sm:col-span-2">
            <Button type="submit" className="h-auto py-3 whitespace-normal">
              {action.busy ? "Opslaan…" : "Instellingen opslaan"}
            </Button>
          </div>
        </fieldset>
        {action.feedbackNode}
      </form>
      <p className="mt-2 text-sm leading-6 text-muted">
        Nieuwe namen gelden voor volgende weergaven en exports waar die velden worden
        gebruikt. Bestaande exports veranderen niet.
      </p>
    </section>
  );
}

function EmployeeRow({
  employee,
  view,
  operations,
}: {
  employee: TeamEmployee;
  view: TeamView;
  operations: TeamOperations;
}) {
  const action = useTeamChange(view, operations);
  const [editing, setEditing] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"suspend" | "reactivate" | null>(
    null,
  );
  const editButton = useRef<HTMLButtonElement>(null);
  const accessButton = useRef<HTMLButtonElement>(null);
  const editHeading = useRef<HTMLHeadingElement>(null);
  const confirmHeading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  useEffect(() => {
    if (editing) editHeading.current?.focus();
  }, [editing]);
  useEffect(() => {
    if (confirmAction) confirmHeading.current?.focus();
  }, [confirmAction]);
  const supported =
    employee.membership_status === "active" ||
    employee.membership_status === "suspended";
  return (
    <article
      aria-labelledby={`${id}-name`}
      className="min-w-0 border-t border-rule py-6 first:border-t-0"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3
            id={`${id}-name`}
            className="text-lg font-semibold wrap-anywhere text-ink"
          >
            {employee.display_name ?? "Naam niet beschikbaar"}
          </h3>
          <p className="mt-1 text-sm wrap-anywhere text-muted">
            {employee.account_email ?? "E-mailadres niet beschikbaar"}
          </p>
          <p className="mt-1 text-sm wrap-anywhere text-ink">
            Personeelscode: {employee.employee_code ?? "Niet ingevuld"}
          </p>
        </div>
        <span className="rounded-md border border-rule-strong px-2 py-1 text-sm font-semibold">
          {statusLabels[employee.membership_status]}
        </span>
      </div>
      {(employee.has_open_shift || employee.has_open_break) && (
        <p className="mt-3 text-sm leading-6 font-semibold text-danger">
          {employee.has_open_break
            ? "Open pauze en open dienst. Schorsen is geblokkeerd."
            : "Open dienst. Schorsen is geblokkeerd."}{" "}
          Er wordt geen dienst of pauze automatisch afgesloten.
        </p>
      )}
      <p className="mt-3 text-sm leading-6 text-muted">
        Openstaande aanvragen: {employee.pending_time_correction_count} tijdcorrecties ·{" "}
        {employee.pending_break_correction_count} pauzecorrecties.
      </p>
      {supported && (
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            ref={editButton}
            variant="secondary"
            disabled={action.busy}
            aria-expanded={editing}
            aria-controls={`${id}-edit`}
            onClick={() => setEditing(!editing)}
          >
            Gegevens wijzigen
          </Button>
          <Button
            ref={accessButton}
            variant="secondary"
            disabled={action.busy}
            aria-expanded={!!confirmAction}
            aria-controls={`${id}-access`}
            onClick={() =>
              setConfirmAction(
                employee.membership_status === "active" ? "suspend" : "reactivate",
              )
            }
          >
            {employee.membership_status === "active"
              ? "Toegang schorsen"
              : "Toegang herstellen"}
          </Button>
        </div>
      )}
      {editing && (
        <form
          id={`${id}-edit`}
          className="mt-5 border-l border-rule-strong pl-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void action.run({
              action: "update_profile",
              target_membership_id: employee.membership_id,
              display_name: String(data.get("display_name") ?? ""),
              employee_code: String(data.get("employee_code") ?? ""),
            });
          }}
        >
          <h4
            ref={editHeading}
            tabIndex={-1}
            className="mb-4 font-semibold outline-none focus:ring-3 focus:ring-focus"
          >
            Medewerkergegevens
          </h4>
          <fieldset
            disabled={action.busy}
            className="grid min-w-0 gap-4 sm:grid-cols-2"
          >
            <legend className="sr-only">Naam en personeelscode wijzigen</legend>
            <Field
              name="display_name"
              label="Weergavenaam"
              initial={employee.display_name ?? ""}
              error={action.state.fieldErrors?.display_name}
              hint="1 tot 100 tekens."
            />
            <Field
              name="employee_code"
              label="Personeelscode (optioneel)"
              initial={employee.employee_code ?? ""}
              error={action.state.fieldErrors?.employee_code}
              hint="Hoogstens 32 tekens. Hoofdletters maken geen verschil bij controle op dubbele codes."
            />
            <div className="flex flex-wrap gap-3 sm:col-span-2">
              <Button type="submit">
                {action.busy ? "Opslaan…" : "Gegevens opslaan"}
              </Button>
              <Button
                type="button"
                variant="quiet"
                onClick={() => {
                  setEditing(false);
                  editButton.current?.focus();
                }}
              >
                Sluiten
              </Button>
            </div>
          </fieldset>
        </form>
      )}
      {confirmAction && (
        <form
          id={`${id}-access`}
          className="mt-5 border-l border-rule-strong pl-4"
          onSubmit={(event) => {
            event.preventDefault();
            const confirmed =
              new FormData(event.currentTarget).get("confirmed") === "on";
            void action.run({
              action: confirmAction,
              target_membership_id: employee.membership_id,
              confirmed,
            });
          }}
        >
          <h4
            ref={confirmHeading}
            tabIndex={-1}
            className="font-semibold outline-none focus:ring-3 focus:ring-focus"
          >
            {confirmAction === "suspend"
              ? "Schorsing bevestigen"
              : "Heractivering bevestigen"}
          </h4>
          <p className="mt-2 text-sm leading-6 text-ink">
            {confirmAction === "suspend"
              ? "Schorsing verwijdert de toegang tot deze organisatie in de app. Het account, historische registraties, aanvragen en exports blijven bewaard. Een open dienst of pauze blokkeert de schorsing."
              : "Heractivering herstelt alleen de bestaande medewerkerstoegang tot deze organisatie. Hetzelfde lidmaatschap en alle historische gegevens blijven behouden."}
          </p>
          <p className="mt-2 text-sm leading-6 text-muted">
            Nog te beoordelen: {employee.pending_time_correction_count} tijdcorrecties
            en {employee.pending_break_correction_count} pauzecorrecties. Deze aanvragen
            blijven beschikbaar voor beoordeling.
          </p>
          <fieldset disabled={action.busy} className="mt-3 min-w-0">
            <legend className="sr-only">Toegangsverandering bevestigen</legend>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6">
              <input
                type="checkbox"
                name="confirmed"
                required
                className="mt-1 size-5 shrink-0 accent-primary outline-none focus-visible:ring-3 focus-visible:ring-focus"
              />
              <span>
                Ik bevestig{" "}
                {confirmAction === "suspend" ? "de schorsing" : "de heractivering"} van
                deze medewerker.
              </span>
            </label>
            <div className="mt-3 flex flex-wrap gap-3">
              <Button
                type="submit"
                className="h-auto py-3 whitespace-normal"
                disabled={
                  confirmAction === "suspend" &&
                  (employee.has_open_shift || employee.has_open_break)
                }
              >
                {action.busy
                  ? "Verwerken…"
                  : confirmAction === "suspend"
                    ? "Schorsing bevestigen"
                    : "Heractivering bevestigen"}
              </Button>
              <Button
                type="button"
                variant="quiet"
                onClick={() => {
                  setConfirmAction(null);
                  accessButton.current?.focus();
                }}
              >
                Annuleren
              </Button>
            </div>
          </fieldset>
        </form>
      )}
      {action.feedbackNode}
    </article>
  );
}

export function TeamPanel({ view }: { view: TeamView }) {
  const [operations] = useState(() => new TeamOperations());
  return (
    <div className="mt-6 min-w-0 space-y-10">
      <PilotSettings view={view} operations={operations} />
      <section aria-labelledby="team-employees" className="border-t border-rule pt-8">
        <h2 id="team-employees" className={headingClass}>
          Medewerkers
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          {view.employees.length} getoond · maximaal 100. Controleer open diensten en
          aanvragen vóór je toegang wijzigt.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button asChild variant="quiet" className="h-auto py-2 whitespace-normal">
            <Link href="/manager/corrections">Tijdcorrecties beoordelen</Link>
          </Button>
          <Button asChild variant="quiet" className="h-auto py-2 whitespace-normal">
            <Link href="/manager/break-corrections">Pauzecorrecties beoordelen</Link>
          </Button>
        </div>
        {view.employees.length === 0 ? (
          <p className="mt-4 text-sm leading-6">
            Nog geen medewerkers. Nodig een fictieve medewerker uit via het lokale
            uitnodigingsformulier.
          </p>
        ) : (
          view.employees.map((employee) => (
            <EmployeeRow
              key={employee.membership_id}
              employee={employee}
              view={view}
              operations={operations}
            />
          ))
        )}
      </section>
      <section aria-labelledby="team-invitations" className="border-t border-rule pt-8">
        <h2 id="team-invitations" className={headingClass}>
          Uitnodigingen
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Maximaal 100 recente uitnodigingen. Verzending blijft beperkt tot lokale tests
          met Mailpit.
        </p>
        <Button
          asChild
          variant="secondary"
          className="mt-4 h-auto py-3 whitespace-normal"
        >
          <Link href="/manager#medewerker-uitnodigen">Medewerker uitnodigen</Link>
        </Button>
        {view.invitations.length === 0 ? (
          <p className="mt-4 text-sm">Nog geen uitnodigingen.</p>
        ) : (
          <ul className="mt-5 divide-y divide-rule">
            {view.invitations.map((invitation, index) => (
              <li key={index} className="min-w-0 py-4 text-sm">
                <p className="font-semibold wrap-anywhere">{invitation.email}</p>
                <p className="mt-1">{invitationLabels[invitation.status]}</p>
                <p className="mt-1 text-muted">
                  Aangemaakt op{" "}
                  {new Intl.DateTimeFormat("nl-BE", {
                    dateStyle: "medium",
                    timeZone: "Europe/Brussels",
                  }).format(new Date(invitation.created_at))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
