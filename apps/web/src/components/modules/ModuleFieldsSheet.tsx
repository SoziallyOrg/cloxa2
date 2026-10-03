"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PencilLine } from "lucide-react";

import { t, type CatalogKey } from "@cloxa/i18n";

import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Row } from "../ui/List";
import { Notice } from "../ui/Notice";
import { Sheet } from "../ui/Sheet";
import { TextInput } from "../ui/TextInput";

export interface ModuleFieldView {
  readonly key: string;
  readonly kind: "text" | "hours" | "date";
  readonly label: CatalogKey;
  readonly hint?: CatalogKey;
  readonly required: boolean;
  readonly maxLength?: number;
}

export interface ModuleFieldsResult {
  readonly ok: boolean;
  readonly errorKey?: CatalogKey;
  readonly invalid?: readonly string[];
}

export interface ModuleFieldsSheetProps {
  moduleId: string;
  moduleLabel: string;
  employeeName: string;
  fields: readonly ModuleFieldView[];
  initial: Readonly<Record<string, string>>;
  action: (values: Record<string, string>) => Promise<ModuleFieldsResult>;
}

/**
 * "Gegevens aanpassen" for one module: a row that opens a sheet with the
 * module's fields. Validated on the server with the module's own schema.
 */
export function ModuleFieldsSheet({
  moduleId,
  moduleLabel,
  employeeName,
  fields,
  initial,
  action,
}: ModuleFieldsSheetProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({ ...initial });
  const [invalid, setInvalid] = useState<readonly string[]>([]);
  const [errorKey, setErrorKey] = useState<CatalogKey | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function openSheet() {
    setValues({ ...initial });
    setInvalid([]);
    setErrorKey(null);
    setSaved(false);
    setOpen(true);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setInvalid([]);
    setErrorKey(null);
    startTransition(async () => {
      const result = await action(values);
      if (!result.ok) {
        setInvalid(result.invalid ?? []);
        if (result.errorKey) setErrorKey(result.errorKey);
        return;
      }
      setOpen(false);
      setSaved(true);
      router.refresh();
    });
  }

  const formId = `module-fields-${moduleId}`;

  return (
    <>
      <Row
        icon={PencilLine}
        title={t("modules.fieldsEdit")}
        aria-haspopup="dialog"
        chevron
        onClick={openSheet}
      />
      {saved ? (
        <li className="px-4 pb-3">
          <Notice tone="success" onDismiss={() => setSaved(false)}>
            {t("modules.fieldsSaved")}
          </Notice>
        </li>
      ) : null}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={moduleLabel}
        description={employeeName}
        closeLabel={t("ui.cancel")}
      >
        <form id={formId} onSubmit={submit} className="flex flex-col gap-6" noValidate>
          {fields.map((field) => {
            const id = `${formId}-${field.key}`;
            return (
              <Field
                key={field.key}
                id={id}
                label={t(field.label)}
                {...(field.hint ? { hint: t(field.hint) } : {})}
                {...(invalid.includes(field.key)
                  ? { error: t("modules.fieldsInvalid") }
                  : {})}
                optional={!field.required}
              >
                <TextInput
                  name={field.key}
                  type={field.kind === "date" ? "date" : "text"}
                  inputMode={field.kind === "hours" ? "decimal" : undefined}
                  autoComplete="off"
                  maxLength={field.maxLength}
                  value={values[field.key] ?? ""}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))
                  }
                />
              </Field>
            );
          })}
          {errorKey ? (
            <Notice tone="error" onDismiss={() => setErrorKey(null)}>
              {t(errorKey)}
            </Notice>
          ) : null}
          <Button type="submit" wide loading={pending}>
            {t("modules.fieldsSave")}
          </Button>
        </form>
      </Sheet>
    </>
  );
}
