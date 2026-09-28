"use client";

import { useState } from "react";

import { t } from "@cloxa/i18n";

import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { NavBarButton } from "../ui/NavBar";
import { Sheet } from "../ui/Sheet";
import { inputClassName, TextInput } from "../ui/TextInput";

export interface AuditFilterSheetProps {
  from: string;
  to: string;
  category: string;
  actor: string;
  /** `[value, label]` pairs. */
  categories: readonly (readonly [string, string])[];
}

/**
 * "Filteren" in the navigation bar: the filters live in a sheet. A plain GET
 * form, so every filtered view is a URL.
 */
export function AuditFilterSheet({
  from,
  to,
  category,
  actor,
  categories,
}: AuditFilterSheetProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <NavBarButton aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {t("audit.filterAction")}
      </NavBarButton>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("audit.filtersHeading")}
        closeLabel={t("ui.cancel")}
      >
        <form method="get" action="/manage/meer/audit" className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-4">
            <Field id="audit-from" label={t("audit.filterFrom")}>
              <TextInput type="date" name="from" defaultValue={from} />
            </Field>
            <Field id="audit-to" label={t("audit.filterTo")}>
              <TextInput type="date" name="to" defaultValue={to} />
            </Field>
          </div>
          <Field id="audit-category" label={t("audit.filterCategory")}>
            <select name="category" defaultValue={category} className={inputClassName}>
              <option value="">{t("audit.filterCategoryAll")}</option>
              {categories.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="audit-actor" label={t("audit.filterActor")}>
            <TextInput
              type="text"
              name="actor"
              defaultValue={actor}
              placeholder={t("audit.filterActorHint")}
            />
          </Field>
          <Button type="submit" wide>
            {t("audit.filterApply")}
          </Button>
        </form>
      </Sheet>
    </>
  );
}
