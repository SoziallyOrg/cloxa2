"use client";

import { useFormStatus } from "react-dom";

import { Button, type ButtonProps } from "./Button";

/**
 * A submit button for a `<form action={serverAction}>`: it shows the
 * spinner and stays disabled while the form is sending, so a double tap
 * never submits twice.
 */
export function SubmitButton(props: Omit<ButtonProps, "type" | "loading">) {
  const { pending } = useFormStatus();
  return <Button {...props} type="submit" loading={pending} />;
}
