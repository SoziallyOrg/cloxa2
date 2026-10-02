"use client";

import { useId, useState } from "react";

import { t } from "@cloxa/i18n";

import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Sheet } from "../ui/Sheet";
import { SubmitButton } from "../ui/SubmitButton";
import { inputClassName } from "../ui/TextInput";

export interface RejectRequestProps {
  size?: "md" | "sm";
  id: string;
  employeeName: string;
  action: (formData: FormData) => Promise<void>;
}

const NOTE_MAX = 280;

/**
 * "Weigeren" never happens in one tap: a sheet asks for the reason the
 * employee will read. The note is required, here and in the action.
 */
export function RejectRequest({
  id,
  employeeName,
  action,
  size = "md",
}: RejectRequestProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [missing, setMissing] = useState(false);
  const fieldId = useId();

  return (
    <>
      <Button
        variant="secondary"
        size={size}
        wide
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {t("manageVragen.reject")}
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("manageVragen.rejectTitle", { name: employeeName })}
        description={t("manageVragen.rejectBody", { name: employeeName })}
        closeLabel={t("ui.cancel")}
      >
        <form
          action={action}
          noValidate
          onSubmit={(event) => {
            if (note.trim() === "") {
              event.preventDefault();
              setMissing(true);
            }
          }}
          className="flex flex-col gap-6"
        >
          <input type="hidden" name="id" value={id} />
          <Field
            id={fieldId}
            label={t("manageVragen.rejectNoteLabel")}
            hint={t("manageVragen.rejectNoteHint")}
            {...(missing ? { error: t("manageVragen.rejectNoteRequired") } : {})}
          >
            <textarea
              name="note"
              rows={3}
              maxLength={NOTE_MAX}
              required
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                if (missing) setMissing(false);
              }}
              className={`${inputClassName} min-h-28 resize-none py-3`}
            />
          </Field>
          <SubmitButton wide>{t("manageVragen.rejectConfirm")}</SubmitButton>
        </form>
      </Sheet>
    </>
  );
}
