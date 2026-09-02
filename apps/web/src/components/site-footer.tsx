import { nlBE } from "@/i18n/nl-BE";

export function SiteFooter() {
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <span>{nlBE.brand.name}</span>
        <span>{nlBE.common.foundationStatus}</span>
      </div>
    </footer>
  );
}
