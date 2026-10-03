"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { t, type CatalogKey } from "@cloxa/i18n";

import { Row, Section } from "../ui/List";
import { Switch } from "../ui/Switch";

export interface ModuleActionResult {
  readonly ok: boolean;
  readonly errorKey?: CatalogKey;
}

export interface ModuleSwitchSectionProps {
  moduleId: string;
  label: string;
  /** One sentence under the name. */
  summary?: string;
  enabled: boolean;
  action: (enabled: boolean) => Promise<ModuleActionResult>;
  /** More rows in the same group, e.g. the link to the module's page. */
  children?: ReactNode;
}

/**
 * One module as a group: its name with a monochrome switch, and whatever
 * rows follow. The switch moves at once; it moves back, with the reason
 * under the group, when saving fails. One change at a time.
 */
export function ModuleSwitchSection({
  moduleId,
  label,
  summary,
  enabled,
  action,
  children,
}: ModuleSwitchSectionProps) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  const [errorKey, setErrorKey] = useState<CatalogKey | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  // A refresh brings the stored state: follow it.
  if (enabled !== prevEnabled) {
    setPrevEnabled(enabled);
    setOn(enabled);
  }

  function change(next: boolean) {
    if (pending) return;
    setOn(next);
    setErrorKey(null);
    setSaved(false);
    startTransition(async () => {
      const result = await action(next);
      if (!result.ok) {
        setOn(!next);
        setErrorKey(result.errorKey ?? "modules.errorGeneric");
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Section
      data-testid={`module-switch-${moduleId}`}
      footer={
        errorKey ? (
          <span role="alert" className="font-semibold text-danger">
            {t(errorKey)}
          </span>
        ) : pending ? (
          <span role="status">{t("modules.saving")}</span>
        ) : saved ? (
          <span role="status">{t("modules.saved")}</span>
        ) : undefined
      }
    >
      <Row
        title={label}
        subtitle={summary}
        accessory={
          <Switch
            label={t("modules.switchLabel", { module: label })}
            checked={on}
            disabled={pending}
            onCheckedChange={change}
          />
        }
      />
      {children}
    </Section>
  );
}
