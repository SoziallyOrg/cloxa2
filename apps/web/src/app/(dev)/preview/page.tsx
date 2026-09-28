"use client";

import { useState } from "react";
import { notFound } from "next/navigation";

import { t } from "@cloxa/i18n";

import { Alert } from "@/components/ui/Alert";
import { BottomNav, type BottomNavItem } from "@/components/ui/BottomNav";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Heading } from "@/components/ui/Heading";
import { OtpInput } from "@/components/ui/OtpInput";
import { Stack } from "@/components/ui/Stack";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { TextInput } from "@/components/ui/TextInput";
import { IconChat, IconClock, IconList } from "@/components/ui/icons";
import { ClockActions } from "@/components/clock/ClockActions";
import { ClockStatus } from "@/components/clock/ClockStatus";
import { OfflineBanner } from "@/components/clock/OfflineBanner";
import { ShiftList } from "@/components/clock/ShiftList";
import { EmployeeHome } from "@/components/employee/EmployeeHome";
import { KioskHome, type KioskEmployee } from "@/components/kiosk/KioskHome";
import { TodayBoard } from "@/components/manage/TodayBoard";

import {
  FAKE_KIOSK_EMPLOYEES,
  FAKE_NOW,
  FAKE_PAST_SHIFTS,
  FAKE_TODAY_BOARD_ATTENTION,
  FAKE_TODAY_BOARD_COUNTERS,
  FAKE_TODAY_BOARD_PEOPLE,
  FAKE_TODAY_SHIFTS,
} from "./fake-data";

const STATUS_TONES: readonly StatusTone[] = ["working", "break", "off", "error"];
const NOOP = () => true;
const PIN_NOOP = () => {};

const NAV_ITEMS: readonly BottomNavItem[] = [
  {
    key: "clock",
    label: t("bottomNav.clock"),
    href: "#",
    icon: <IconClock />,
    current: true,
  },
  {
    key: "hours",
    label: t("bottomNav.hours"),
    href: "#",
    icon: <IconList />,
    current: false,
  },
  {
    key: "questions",
    label: t("bottomNav.questions"),
    href: "#",
    icon: <IconChat />,
    current: false,
  },
];

/**
 * Every component and layout, in every state, with fake data — so the
 * product owner can judge the look before real data is wired up. 404s in
 * production: this route only exists for local/dev review.
 */
export default function PreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <PreviewContent />;
}

function PreviewContent() {
  const [dismissed, setDismissed] = useState(false);
  const [kioskSelected, setKioskSelected] = useState<KioskEmployee | null>(null);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-16 p-6 pb-32">
      <div className="-mx-6 bg-status-break-bg px-6 py-3 text-center font-semibold text-status-break">
        {t("preview.fakeDataLabel")}
      </div>

      <Heading level={1}>{t("preview.heading")}</Heading>

      <section className="flex flex-col gap-10">
        <Heading level={2}>{t("preview.sectionPrimitives")}</Heading>

        <Stack gap="lg">
          <Heading level={3}>{t("preview.demoButtonsHeading")}</Heading>
          <Stack row gap="md" className="flex-wrap">
            <Button variant="primary" onClick={NOOP}>
              {t("actions.startWork")}
            </Button>
            <Button variant="secondary" onClick={NOOP}>
              {t("actions.startBreak")}
            </Button>
            <Button variant="danger" onClick={NOOP}>
              {t("actions.stopWork")}
            </Button>
            <Button variant="quiet" onClick={NOOP}>
              {t("common.back")}
            </Button>
            <Button variant="primary" loading onClick={NOOP}>
              {t("actions.startWork")}
            </Button>
            <Button variant="primary" disabled onClick={NOOP}>
              {t("actions.startWork")}
            </Button>
          </Stack>
          <Button variant="primary" size="xl" onClick={NOOP}>
            {t("actions.startWork")}
          </Button>
        </Stack>

        <Stack gap="md">
          <Heading level={3}>{t("preview.demoCardHeading")}</Heading>
          <Card>
            <Stack gap="sm">
              <Heading level={3}>{t("employeeHome.todayHeading")}</Heading>
              <p>{t("preview.demoAlertInfo")}</p>
            </Stack>
          </Card>
        </Stack>

        <Stack gap="md">
          <Heading level={3}>{t("preview.demoFieldHeading")}</Heading>
          <Field
            id="preview-email"
            label={t("preview.demoEmailLabel")}
            hint={t("preview.demoEmailHint")}
          >
            <TextInput type="email" defaultValue="" />
          </Field>
          <Field
            id="preview-email-error"
            label={t("preview.demoEmailLabel")}
            error={t("preview.demoEmailError")}
          >
            <TextInput type="email" defaultValue="niet-geldig" />
          </Field>
        </Stack>

        <Stack gap="md">
          <Heading level={3}>{t("preview.demoOtpHeading")}</Heading>
          <Field id="preview-otp" label={t("kiosk.pinTitle")} hint={t("kiosk.pinHint")}>
            <OtpInput maxLength={6} defaultValue="" />
          </Field>
        </Stack>

        <Stack gap="md">
          <Heading level={3}>{t("preview.demoStatusHeading")}</Heading>
          <Stack row gap="md" className="flex-wrap">
            {STATUS_TONES.map((tone) => (
              <StatusBadge
                key={tone}
                tone={tone}
                label={t(`status.${statusLabelKey(tone)}`)}
              />
            ))}
          </Stack>
        </Stack>

        <Stack gap="md">
          <Heading level={3}>{t("preview.demoAlertHeading")}</Heading>
          <Alert tone="info">{t("preview.demoAlertInfo")}</Alert>
          <Alert tone="success">{t("preview.demoAlertSuccess")}</Alert>
          {!dismissed ? (
            <Alert tone="error" onDismiss={() => setDismissed(true)}>
              {t("preview.demoAlertError")}
            </Alert>
          ) : null}
        </Stack>

        <Stack gap="md">
          <Heading level={3}>{t("preview.demoEmptyHeading")}</Heading>
          <EmptyState
            title={t("preview.demoEmptyTitle")}
            body={t("preview.demoEmptyBody")}
          />
        </Stack>

        <Stack gap="md">
          <Heading level={3}>{t("preview.demoNavHeading")}</Heading>
          <div className="relative h-32 overflow-hidden rounded-lg border border-border [contain:layout]">
            <BottomNav items={NAV_ITEMS} />
          </div>
        </Stack>
      </section>

      <section className="flex flex-col gap-10">
        <Heading level={2}>{t("preview.sectionClock")}</Heading>

        <Stack gap="lg">
          <Heading level={3}>{t("preview.demoClockStatusHeading")}</Heading>
          <ClockStatus state="off" since={null} now={FAKE_NOW} />
          <ClockStatus
            state="working"
            since={FAKE_NOW - 3 * 3_600_000 - 12 * 60_000}
            now={FAKE_NOW}
          />
          <ClockStatus state="on_break" since={FAKE_NOW - 13 * 60_000} now={FAKE_NOW} />
        </Stack>

        <Stack gap="lg">
          <Heading level={3}>{t("preview.demoClockActionsHeading")}</Heading>
          <ClockActions
            state="off"
            onStartWork={NOOP}
            onStopWork={NOOP}
            onStartBreak={NOOP}
            onStopBreak={NOOP}
          />
          <ClockActions
            state="working"
            onStartWork={NOOP}
            onStopWork={NOOP}
            onStartBreak={NOOP}
            onStopBreak={NOOP}
          />
          <ClockActions
            state="on_break"
            onStartWork={NOOP}
            onStopWork={NOOP}
            onStartBreak={NOOP}
            onStopBreak={NOOP}
          />
          <ClockActions
            state="working"
            onStartWork={NOOP}
            onStopWork={NOOP}
            onStartBreak={NOOP}
            onStopBreak={NOOP}
            previewSuccess={{ action: "startWork", time: "08:02" }}
          />
        </Stack>

        <Stack gap="md">
          <Heading level={3}>{t("preview.demoShiftListHeading")}</Heading>
          <ShiftList shifts={FAKE_PAST_SHIFTS} />
          <ShiftList shifts={[]} />
        </Stack>

        <Stack gap="md">
          <Heading level={3}>{t("preview.demoOfflineHeading")}</Heading>
          <OfflineBanner queueing />
        </Stack>
      </section>

      <section className="flex flex-col gap-4">
        <Heading level={2}>{t("preview.sectionEmployeeHome")}</Heading>
        <div className="relative mx-auto h-[720px] w-[380px] overflow-y-auto rounded-3xl border-4 border-ink [contain:layout]">
          <EmployeeHome
            firstName="Amina"
            shiftState="working"
            since={FAKE_NOW - 3 * 3_600_000 - 12 * 60_000}
            now={FAKE_NOW}
            todayShifts={FAKE_TODAY_SHIFTS}
            activeNav="clock"
            onStartWork={NOOP}
            onStopWork={NOOP}
            onStartBreak={NOOP}
            onStopBreak={NOOP}
          />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <Heading level={2}>{t("preview.sectionKiosk")}</Heading>
        <div className="rounded-lg border border-border p-4">
          <KioskHome
            employees={FAKE_KIOSK_EMPLOYEES}
            selected={kioskSelected}
            onSelect={setKioskSelected}
            onSubmitPin={PIN_NOOP}
          />
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <Heading level={2}>{t("preview.sectionManage")}</Heading>
        <TodayBoard
          counters={FAKE_TODAY_BOARD_COUNTERS}
          people={FAKE_TODAY_BOARD_PEOPLE}
          attention={FAKE_TODAY_BOARD_ATTENTION}
        />
        <TodayBoard
          counters={{ working: 0, onBreak: 0, notStarted: 0, deviations: 0 }}
          people={[]}
          attention={[]}
        />
      </section>
    </div>
  );
}

function statusLabelKey(
  tone: StatusTone,
): "workingLabel" | "breakLabel" | "offLabel" | "errorLabel" {
  if (tone === "working") return "workingLabel";
  if (tone === "break") return "breakLabel";
  if (tone === "off") return "offLabel";
  return "errorLabel";
}
