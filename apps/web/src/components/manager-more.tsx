import Link from "next/link";
import { Download, ArrowRight, UserPlus } from "lucide-react";
export function ManagerMore() {
  return (
    <div className="mt-6 grid gap-4">
      <Link href="/manager#medewerker-uitnodigen" className="workspace-destination">
        <UserPlus aria-hidden="true" />
        <span>
          <strong>Medewerker uitnodigen</strong>
          <span className="mt-1 block text-sm text-muted">
            Open het bestaande uitnodigingsformulier.
          </span>
        </span>
        <ArrowRight aria-hidden="true" />
      </Link>
      <Link href="/manager/exports-v2" className="workspace-destination">
        <Download aria-hidden="true" />
        <span>
          <strong>Export met pauzes</strong>
          <span className="mt-1 block text-sm text-muted">
            Download registraties als CSV of JSON, inclusief pauzegegevens.
          </span>
        </span>
        <ArrowRight aria-hidden="true" />
      </Link>
      <details className="rounded-surface border border-rule p-4">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">
          Eerdere exportversie
        </summary>
        <p className="my-3 text-sm text-muted">
          Gebruik dit alleen als je de bestaande v1-indeling nodig hebt.
        </p>
        <Link className="workspace-link underline" href="/manager/exports">
          Export v1 openen
        </Link>
      </details>
    </div>
  );
}
