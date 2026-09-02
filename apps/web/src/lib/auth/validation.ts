import { z } from "zod";

import { nlBE } from "@/i18n/nl-BE";

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const optionalText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .transform((value) => value || null);

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});

export const recoverySchema = z.object({ email });

export const invitationSchema = z.object({
  email,
  displayName: optionalText(100),
  employeeCode: optionalText(32),
});

export const passwordSchema = z
  .object({
    password: z.string().min(12).max(128),
    passwordConfirmation: z.string().min(1).max(128),
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ["passwordConfirmation"],
  });

export type AuthFormField =
  "email" | "password" | "passwordConfirmation" | "displayName" | "employeeCode";

export type AuthActionState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Partial<Record<AuthFormField, string>>;
};

export const initialAuthActionState: AuthActionState = { message: "", status: "idle" };

export function getFormText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export function validationState(error: z.ZodError): AuthActionState {
  const fieldErrors: Partial<Record<AuthFormField, string>> = {};

  for (const issue of error.issues) {
    const field = issue.path[0];

    if (typeof field === "string" && Object.hasOwn(nlBE.authValidation, field)) {
      const key = field as AuthFormField;
      fieldErrors[key] = nlBE.authValidation[key];
    }
  }

  return { fieldErrors, message: nlBE.auth.invalidForm, status: "error" };
}
