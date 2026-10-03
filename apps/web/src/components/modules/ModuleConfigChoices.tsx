"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { t, type CatalogKey } from "@cloxa/i18n";

import { Row, Section } from "../ui/List";
import type { ModuleActionResult } from "./ModuleSwitchSection";

export interface ConfigChoiceView {
  readonly key: string;
  readonly label: CatalogKey;
  readonly footer?: CatalogKey;
  readonly options: readonly {
    readonly value: string;
    readonly label: CatalogKey;
    readonly detail?: CatalogKey;
  }[];
}

export interface ModuleConfigChoicesProps {
  choices: readonly ConfigChoiceView[];
  initial: Readonly<Record<string, string>>;
  action: (values: Record<string, string>) => Promise<ModuleActionResult>;
}

/**
 * A module's settings as choice rows (a check on the current one), like iOS
 * settings: a tap saves right away, the check moves back if that fails.
 */
export function ModuleConfigChoices({
  choices,
  initial,
  action,
}: ModuleConfigChoicesProps) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({ ...initial });
  const [status, setStatus] = useState<{
    key: string;
    errorKey: CatalogKey | null;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(key: string, value: string) {
    if (pending || values[key] === value) return;
    const previous = values;
    const next = { ...values, [key]: value };
    setValues(next);
    setStatus(null);
    startTransition(async () => {
      const result = await action(next);
      if (!result.ok) {
        setValues(previous);
        setStatus({ key, errorKey: result.errorKey ?? "modules.errorGeneric" });
        return;
      }
      setStatus({ key, errorKey: null });
      router.refresh();
    });
  }

  return choices.map((choice) => {
    const mine = status?.key === choice.key ? status : null;
    return (
      <Section
        key={choice.key}
        header={t(choice.label)}
        footer={
          mine?.errorKey ? (
            <span role="alert" className="font-semibold text-danger">
              {t(mine.errorKey)}
            </span>
          ) : pending ? (
            <span role="status">{t("modules.saving")}</span>
          ) : mine ? (
            <span role="status">{t("modules.saved")}</span>
          ) : choice.footer ? (
            t(choice.footer)
          ) : undefined
        }
      >
        {choice.options.map((option) => (
          <Row
            key={option.value}
            title={t(option.label)}
            value={option.detail ? t(option.detail) : undefined}
            checked={values[choice.key] === option.value}
            aria-pressed={values[choice.key] === option.value}
            disabled={pending}
            onClick={() => choose(choice.key, option.value)}
          />
        ))}
      </Section>
    );
  });
}
