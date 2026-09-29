import "server-only";

import nodemailer from "nodemailer";

import { env } from "@/lib/env.server";

import type { ParsedPilotRequest } from "./form";
import { formatPilotMail } from "./mail";

/** The mail settings when all six are set, else null (requests are then only stored). */
function mailConfig() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, OPERATOR_EMAIL } =
    env;
  if (
    SMTP_HOST === undefined ||
    SMTP_PORT === undefined ||
    SMTP_USER === undefined ||
    SMTP_PASSWORD === undefined ||
    SMTP_FROM === undefined ||
    OPERATOR_EMAIL === undefined
  ) {
    return null;
  }
  return {
    host: SMTP_HOST,
    port: SMTP_PORT,
    user: SMTP_USER,
    password: SMTP_PASSWORD,
    from: SMTP_FROM,
    to: OPERATOR_EMAIL,
  };
}

/**
 * Tells the operator about a stored request. Only ever the operator: nothing
 * is sent to the submitter. Call inside `after()`: a mail failure must never
 * change what the visitor sees, so errors are logged (code only, no address or
 * text from the form) and swallowed.
 */
export async function notifyOperator(request: ParsedPilotRequest): Promise<void> {
  const config = mailConfig();
  if (!config) return;

  const mail = formatPilotMail(request);
  try {
    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      // Implicit TLS on 465; STARTTLS (required) on the submission ports.
      secure: config.port === 465,
      requireTLS: config.port !== 465,
      auth: { user: config.user, pass: config.password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    await transport.sendMail({
      from: config.from,
      to: config.to,
      // So "reply" goes to the company; the address was validated as an email.
      replyTo: request.email,
      subject: mail.subject,
      text: mail.text,
    });
  } catch (error) {
    const code = (error as { code?: string }).code ?? (error as Error).name;
    console.error("pilot_mail_failed", code);
  }
}
