import { createRoot } from "react-dom/client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { WorkspaceShell } from "../src/components/workspace-shell";
import {
  EmployeeClockProvider,
  EmployeeClockScope,
} from "../src/components/employee-clock-provider";
import { SiteChrome } from "../src/components/site-chrome";
import { LogoutForm } from "../src/components/logout-form";
import { ManagerMore } from "../src/components/manager-more";
import { TeamPanel } from "../src/components/team-panel";
import { ExportV2Panel } from "../src/components/export-v2-panel";
import { nlBE } from "../src/i18n/nl-BE";
import { breakCopy } from "../src/lib/break-corrections/copy";
import { CorrectionRequestPanel } from "../src/components/correction-request-panel";
import { ManagerCorrectionPanel } from "../src/components/manager-correction-panel";
import { BreakCorrectionPanel } from "../src/components/break-correction-panel";
import { TimeClockPanel } from "../src/components/time-clock-panel";
import { LocalTimeField } from "../src/components/local-time-field";
import type { EmployeeCorrectionsView } from "../src/lib/corrections/model";
import type { WorkState } from "../src/lib/time-clock/work-status";
import type { Provenance } from "../src/lib/corrections/provenance";
import "../src/app/globals.css";
import "@fontsource/barlow-condensed/600.css";

declare global {
  interface Window {
    uxState: WorkState | null;
    uxScope: string;
    uxDelay: number;
    uxActionDelay: number;
    uxReads: number;
    uxActions: { intent: string; id: string; keys: string[] }[];
    uxServerTime?: string;
    uxActionRefused?: boolean;
  }
}
window.uxScope = "synthetic:org";
window.uxState = { status: "working", currentStartedAt: "2026-09-07T07:00:00Z" };
window.uxDelay = 0;
window.uxActionDelay = 0;
window.uxReads = 0;
window.uxActions = [];
const view: EmployeeCorrectionsView = {
  timezone: "Europe/Brussels",
  serverTime: "2026-09-07T14:00:00Z",
  entries: [
    {
      id: "synthetic-entry",
      worksiteId: "synthetic-site",
      startedAt: "2026-09-04T06:00:12.123456Z",
      endedAt: "2026-09-04T14:30:27.654321Z",
      breaks: [
        {
          id: "synthetic-break",
          startedAt: "2026-09-04T10:00:00Z",
          endedAt: "2026-09-04T10:30:00Z",
          version: 2,
        },
        {
          id: "synthetic-break-2",
          startedAt: "2026-09-04T11:57:12.123456Z",
          endedAt: "2026-09-04T11:58:24.654321Z",
          version: 2,
        },
      ],
    },
  ],
  requests: (["approved", "pending", "rejected", "withdrawn"] as const).map(
    (status, i) => ({
      id: `synthetic-request-${i}`,
      requestKind: "adjustment",
      targetTimeEntryId: "synthetic-entry",
      appliedTimeEntryId: status === "approved" ? "synthetic-entry" : null,
      createdAt: "2026-09-04T15:00:00Z",
      resolvedAt:
        status === "approved" || status === "rejected" ? "2026-09-05T08:00:00Z" : null,
      withdrawnAt: status === "withdrawn" ? "2026-09-05T08:00:00Z" : null,
      proposedStartedAt: "2026-09-04T06:00:12.123456Z",
      proposedEndedAt: "2026-09-04T14:30:27.654321Z",
      employeeReason: "Synthetisch voorbeeld: eindtijd nagekeken.",
      managerNote: status === "approved" ? "Nagekeken met medewerker." : null,
      status,
      breaks: [],
    }),
  ),
};
const provenance: Provenance = {
  "synthetic-entry": {
    added: false,
    decisions: [
      {
        id: "synthetic-applied-decision",
        category: "time",
        kind: "adjustment",
        startedAt: "2026-09-04T06:00:12.123456Z",
        endedAt: "2026-09-04T14:30:27.654321Z",
        reason: "Synthetisch voorbeeld: eindtijd nagekeken.",
        note: "Nagekeken met medewerker.",
      },
    ],
  },
};
function Preview() {
  const path = usePathname();
  const [scope, setScope] = useState("synthetic:org");
  const role = path.startsWith("/manager") ? "manager" : "employee";
  const stress = new URLSearchParams(location.search).has("stress");
  const title =
    path === "/employee"
      ? nlBE.employee.title
      : path.endsWith("/registrations")
        ? "Registraties"
        : path.endsWith("/more")
          ? "Meer"
          : path.endsWith("/team")
            ? "Team en pilotinstellingen"
            : path === "/employee/corrections"
              ? nlBE.corrections.title
              : path === "/employee/break-corrections"
                ? breakCopy.title
                : path === "/manager/corrections"
                  ? nlBE.managerCorrections.title
                  : path === "/manager/exports-v2"
                    ? "Export met pauzes (v2)"
                    : "Aanvragen";
  const content = (
    <SiteChrome
      header={<p>Publieke kop — mag niet zichtbaar zijn in werkruimte</p>}
      footer={<p>Publieke voettekst</p>}
    >
      <WorkspaceShell
        key={path}
        role={role}
        scope={scope}
        title={title}
        description={
          path === "/employee"
            ? nlBE.employee.description
            : path === "/manager/corrections"
              ? nlBE.managerCorrections.description
              : path === "/employee/corrections"
                ? nlBE.corrections.description
                : path === "/employee/break-corrections"
                  ? breakCopy.description
                  : path === "/employee/registrations"
                    ? "Bekijk je afgesloten werktijden en toegepaste correcties. Kies een registratie om een aanpassing aan te vragen."
                    : path === "/employee/requests"
                      ? "Volg je tijdaanvragen en de beslissing van je manager. Pauzeaanvragen staan onder Pauzes."
                      : "Bekijk je registraties en volg aanvragen. Synthetisch voorbeeld, geen accountgegevens."
        }
        account={<LogoutForm />}
      >
        {path === "/manager/team" ? (
          <TeamPanel
            view={{
              request_id: "00000000-0000-4000-8000-000000000001",
              organization_id: "00000000-0000-4000-8000-000000000002",
              worksite_id: "00000000-0000-4000-8000-000000000003",
              organization_name: "Fictieve werkplaats",
              worksite_name: "Testwerkplek",
              timezone: "Europe/Brussels",
              invitations: [],
              employees: [
                {
                  membership_id: "00000000-0000-4000-8000-000000000004",
                  display_name:
                    "Fictieve medewerker met lange dubbele familienaam Van den Werkplaats-Samenwerking",
                  employee_code: "DEMO",
                  account_email: "synthetic@example.test",
                  membership_status: "active",
                  created_at: "2026-09-04T06:00:00Z",
                  activated_at: "2026-09-04T06:00:00Z",
                  has_open_shift: false,
                  has_open_break: false,
                  pending_time_correction_count: 0,
                  pending_break_correction_count: 0,
                },
              ],
            }}
          />
        ) : path === "/manager/exports-v2" ? (
          <ExportV2Panel history={[]} />
        ) : path === "/manager/more" ? (
          <ManagerMore />
        ) : role === "manager" ? (
          <ManagerCorrectionPanel
            view={{
              pendingCount: 1,
              requests: view.requests.map((request) => ({
                ...request,
                employeeDisplayName: stress
                  ? "Fictieve medewerker met een buitengewoon lange dubbele familienaam Van den Werkplaats-Samenwerking"
                  : "Fictieve medewerker",
                employeeReason: stress
                  ? "Synthetische lange toelichting: ".repeat(30) +
                    "registratiecontrole".repeat(15)
                  : request.employeeReason,
                employeeCode: "DEMO",
                originalStartedAt: "2026-09-04T06:00:12.123456Z",
                originalEndedAt: "2026-09-04T14:00:27.654321Z",
              })),
            }}
          />
        ) : path === "/employee/break-corrections" ? (
          <BreakCorrectionPanel
            provenance={provenance}
            manager={false}
            view={{
              request_id: "synthetic-view",
              requests: [],
              entries: [
                {
                  id: "synthetic-entry",
                  organization_id: "synthetic-org",
                  membership_id: "synthetic-member",
                  worksite_id: "synthetic-site",
                  version: 1,
                  started_at: "2026-09-04T06:00:12.123456Z",
                  ended_at: "2026-09-04T14:30:27.654321Z",
                  breaks: [
                    {
                      logical_break_id: "synthetic-break",
                      version: 2,
                      revision_id: null,
                      origin: "live",
                      removed: false,
                      started_at: "2026-09-04T10:00:00.123456Z",
                      ended_at: "2026-09-04T10:30:00.654321Z",
                    },
                  ],
                },
              ],
            }}
          />
        ) : path === "/employee" ? (
          <TimeClockPanel
            provenance={{}}
            clock={{
              currentStartedAt: "2026-09-07T07:00:00Z",
              serverTime: "2026-09-07T14:00:00Z",
              status: "working",
              timezone: "Europe/Brussels",
              worksiteId: "synthetic-site",
              entries: [
                {
                  ...view.entries[0]!,
                  startedAt: "2026-09-04T06:00:12.123456Z",
                },
              ],
            }}
          />
        ) : (
          <CorrectionRequestPanel
            key={path}
            view={view}
            provenance={provenance}
            mode={
              path === "/employee/registrations"
                ? "registrations"
                : path === "/employee/requests"
                  ? "requests"
                  : "all"
            }
          />
        )}
        <details className="mt-6">
          <summary className="min-h-11 cursor-pointer py-2">
            Synthetische testbediening
          </summary>
          <button
            className="workspace-link"
            onClick={() => {
              window.uxScope = "other:org";
              setScope("other:org");
            }}
          >
            Wissel testaccount
          </button>
          <form id="edge-form" className="grid gap-4">
            <LocalTimeField name="edge" label="Testtijd" />
            <button className="workspace-link" type="button">
              Geen verzending
            </button>
          </form>
        </details>
      </WorkspaceShell>
    </SiteChrome>
  );
  return role === "employee" ? (
    <EmployeeClockProvider scope={scope}>
      <EmployeeClockScope scope={scope}>{content}</EmployeeClockScope>
    </EmployeeClockProvider>
  ) : (
    content
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
