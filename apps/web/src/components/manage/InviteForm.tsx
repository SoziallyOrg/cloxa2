"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@cloxa/i18n";

import type { InviteFormInput } from "@/lib/manage/invite-form";

import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { GroupedList, ListCheckboxRow } from "../ui/GroupedList";
import { Select } from "../ui/Select";
import { TextInput } from "../ui/TextInput";

export interface InviteFormSite {
  readonly id: string;
  readonly name: string;
}

export interface InviteFormResult {
  readonly ok: boolean;
  readonly errorKey?: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
}

export interface InviteFormProps {
  sites: readonly InviteFormSite[];
  canInvitePrivilegedRoles: boolean;
  action: (input: InviteFormInput) => Promise<InviteFormResult>;
}

const STATUTE_OPTIONS: readonly { value: string; labelKey: string }[] = [
  { value: "bediende", labelKey: "manageTeam.statuteBediende" },
  { value: "arbeider", labelKey: "manageTeam.statuteArbeider" },
  { value: "student", labelKey: "manageTeam.statuteStudent" },
  { value: "flexi", labelKey: "manageTeam.statuteFlexi" },
  { value: "interim", labelKey: "manageTeam.statuteInterim" },
  { value: "other", labelKey: "manageTeam.statuteOther" },
];

export function InviteForm({
  sites,
  canInvitePrivilegedRoles,
  action,
}: InviteFormProps) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [statute, setStatute] = useState("bediende");
  const [role, setRole] = useState("employee");
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [done, setDone] = useState(false);

  function toggleSite(id: string) {
    setSiteIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrorKey(null);
    setFieldErrors({});
    const input: InviteFormInput = {
      displayName,
      email,
      statute: statute as InviteFormInput["statute"],
      role: role as InviteFormInput["role"],
      siteIds,
      ...(employeeCode ? { employeeCode } : {}),
    };
    const result = await action(input);
    setSubmitting(false);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors ?? {});
      setErrorKey(
        result.errorKey ?? (result.fieldErrors ? "manageTeam.fieldRequired" : null),
      );
      return;
    }
    setDone(true);
    setDisplayName("");
    setEmail("");
    setEmployeeCode("");
    setSiteIds([]);
    router.refresh();
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-6"
    >
      {done ? (
        <Alert tone="success" onDismiss={() => setDone(false)}>
          {t("manageTeam.invited")}
        </Alert>
      ) : null}
      {errorKey ? (
        <Alert tone="error" onDismiss={() => setErrorKey(null)}>
          {t(errorKey as Parameters<typeof t>[0])}
        </Alert>
      ) : null}

      <Field
        id="invite-name"
        label={t("manageTeam.nameLabel")}
        {...(fieldErrors["displayName"]
          ? { error: t("manageTeam.fieldRequired") }
          : {})}
      >
        <TextInput
          id="invite-name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          required
        />
      </Field>

      <Field
        id="invite-email"
        label={t("manageTeam.emailLabel")}
        {...(fieldErrors["email"] ? { error: t("manageTeam.fieldRequired") } : {})}
      >
        <TextInput
          id="invite-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </Field>

      <Field id="invite-code" label={t("manageTeam.codeLabel")} optional>
        <TextInput
          id="invite-code"
          value={employeeCode}
          onChange={(event) => setEmployeeCode(event.target.value)}
        />
      </Field>

      <Field id="invite-statute" label={t("manageTeam.statuteLabel")}>
        <Select
          id="invite-statute"
          value={statute}
          onChange={(event) => setStatute(event.target.value)}
        >
          {STATUTE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey as Parameters<typeof t>[0])}
            </option>
          ))}
        </Select>
      </Field>

      {canInvitePrivilegedRoles ? (
        <Field id="invite-role" label={t("manageTeam.roleLabel")}>
          <Select
            id="invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            <option value="employee">{t("manageTeam.roleEmployee")}</option>
            <option value="manager">{t("manageTeam.roleManager")}</option>
            <option value="admin">{t("manageTeam.roleAdmin")}</option>
          </Select>
        </Field>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-body font-semibold">
          {t("manageTeam.sitesLabel")}
        </legend>
        <GroupedList>
          {sites.map((site) => (
            <ListCheckboxRow
              key={site.id}
              title={site.name}
              checked={siteIds.includes(site.id)}
              onChange={() => toggleSite(site.id)}
            />
          ))}
        </GroupedList>
      </fieldset>

      <Button type="submit" variant="primary" wide loading={submitting}>
        {t("manageTeam.submit")}
      </Button>
    </form>
  );
}
