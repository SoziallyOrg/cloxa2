"use client";

import { useEffect, useRef } from "react";
import type { EntryProvenance } from "@/lib/corrections/provenance";
import { TimeDetails } from "./exact-details";
import { StatusBadge } from "./ui/status-badge";

export function AppliedCorrections({
  provenance,
}: {
  provenance: EntryProvenance | undefined;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reveal = () => {
      for (const detail of container.current?.querySelectorAll("details") ?? [])
        if (`#${detail.id}` === window.location.hash) {
          detail.open = true;
          let ancestor = detail.parentElement;
          while (ancestor) {
            if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
            ancestor = ancestor.parentElement;
          }
          detail.scrollIntoView({ block: "nearest" });
        }
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);
  if (!provenance || (!provenance.added && !provenance.decisions.length)) return null;
  return (
    <div ref={container} className="mt-3 min-w-0 space-y-2 text-sm">
      {provenance.added && (
        <StatusBadge status="information">Toegevoegd na aanvraag</StatusBadge>
      )}
      {provenance.decisions.map((decision) => (
        <details key={decision.id} id={`decision-${decision.id}`}>
          <summary className="min-h-11 cursor-pointer py-2">
            <StatusBadge status="corrected">
              {decision.kind === "missed_entry"
                ? "Registratie toegevoegd"
                : decision.category === "break"
                  ? "Pauze gecorrigeerd"
                  : "Gecorrigeerd"}
            </StatusBadge>{" "}
            <span className="text-primary underline">Beslissing bekijken</span>
          </summary>
          <div className="border-l-2 border-primary pl-3">
            <p className="font-semibold">
              {decision.category === "time"
                ? "Laatste toegepaste tijdaanvraag"
                : "Aanvraag achter deze pauzerevisie"}{" "}
              · Goedgekeurd
            </p>
            {decision.kind === "removal" ? (
              <p>Pauze verwijderd uit de geldende tijd.</p>
            ) : (
              <div className="my-2">
                {decision.startedAt && <TimeDetails value={decision.startedAt} />}
                {decision.endedAt && <TimeDetails value={decision.endedAt} />}
              </div>
            )}
            <p className="break-words whitespace-pre-wrap">Reden: {decision.reason}</p>
            {decision.note && (
              <p className="mt-2 break-words whitespace-pre-wrap">
                Toelichting manager: {decision.note}
              </p>
            )}
            <a
              className="inline-flex min-h-11 items-center text-primary underline"
              href={`#decision-${decision.id}`}
            >
              Link naar deze beslissing
            </a>
            <p className="text-xs text-muted">
              Gekoppelde beslissing, geen volledige wijzigingshistoriek. Eerdere feiten
              worden hier niet gereconstrueerd.
            </p>
          </div>
        </details>
      ))}
    </div>
  );
}
