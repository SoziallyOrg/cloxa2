"use client";

import { useState } from "react";
import { CalendarDays, Clock, MessageCircleQuestionMark } from "lucide-react";
import { notFound } from "next/navigation";

import { t } from "@cloxa/i18n";

import { Logo } from "@/components/brand/Logo";
import { ClockActions } from "@/components/clock/ClockActions";
import { OfflineBanner } from "@/components/clock/OfflineBanner";
import { ShiftList } from "@/components/clock/ShiftList";
import { EmployeeHome } from "@/components/employee/EmployeeHome";
import { KioskHome, type KioskEmployee } from "@/components/kiosk/KioskHome";
import { TodayBoard } from "@/components/manage/TodayBoard";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { GroupedList, ListButtonRow, ListRow } from "@/components/ui/GroupedList";
import { OtpInput } from "@/components/ui/OtpInput";
import { ProgressTrack } from "@/components/ui/ProgressTrack";
import { Sheet } from "@/components/ui/Sheet";
import { StatusLine, type StatusTone } from "@/components/ui/StatusLine";
import { TabBar, type NavItem } from "@/components/ui/TabBar";
import { TextInput } from "@/components/ui/TextInput";
import { Timer } from "@/components/ui/Timer";

import {
  FAKE_KIOSK_EMPLOYEES,
  FAKE_NOW,
  FAKE_PAST_SHIFTS,
  FAKE_TODAY_BOARD_ATTENTION,
  FAKE_TODAY_BOARD_COUNTERS,
  FAKE_TODAY_BOARD_PEOPLE,
  FAKE_TODAY_SHIFTS,
} from "./fake-data";

const STATUS: readonly { tone: StatusTone; label: Parameters<typeof t>[0] }[] = [
  { tone: "working", label: "status.workingLabel" },
  { tone: "break", label: "status.breakLabel" },
  { tone: "attention", label: "offline.notSent" },
  { tone: "danger", label: "status.errorLabel" },
  { tone: "off", label: "status.offLabel" },
];
const NOOP = () => true;
const PIN_NOOP = () => {};

const NAV_ITEMS: readonly NavItem[] = [
  { key: "clock", label: t("bottomNav.clock"), href: "#", current: true, icon: Clock },
  {
    key: "hours",
    label: t("bottomNav.hours"),
    href: "#",
    current: false,
    icon: CalendarDays,
  },
  {
    key: "questions",
    label: t("bottomNav.questions"),
    href: "#",
    current: false,
    icon: MessageCircleQuestionMark,
  },
];

/**
 * Every primitive and layout, in every state, with fake data — so the
 * product owner can judge the look before real data is wired up. 404s in
 * production: this route only exists for local/dev review.
 */
export default function PreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <PreviewContent />;
}

function Demo({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-subhead text-ink-2">{title}</h3>
      {children}
    </section>
  );
}

function PreviewContent() {
  const [dismissed, setDismissed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [kioskSelected, setKioskSelected] = useState<KioskEmployee | null>(null);
  const since = FAKE_NOW - 3 * 3_600_000 - 24 * 60_000;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-16 px-gutter py-10 md:px-gutter-desktop">
      <p className="rounded-control bg-break/10 px-4 py-3 text-center text-subhead font-semibold text-break">
        {t("preview.fakeDataLabel")}
      </p>

      <div className="flex flex-col gap-6">
        <Logo size="lg" />
        <h1 className="text-title">{t("preview.heading")}</h1>
      </div>

      <section className="flex flex-col gap-12">
        <h2 className="text-headline">{t("preview.sectionPrimitives")}</h2>

        <Demo title={t("preview.demoButtonsHeading")}>
          <div className="flex flex-wrap gap-3">
            <Button onClick={NOOP}>{t("actions.startWork")}</Button>
            <Button variant="secondary" onClick={NOOP}>
              {t("actions.startBreak")}
            </Button>
            <Button variant="destructive" onClick={NOOP}>
              {t("actions.stopWork")}
            </Button>
            <Button variant="plain" onClick={NOOP}>
              {t("common.back")}
            </Button>
            <Button loading onClick={NOOP}>
              {t("actions.startWork")}
            </Button>
            <Button disabled onClick={NOOP}>
              {t("actions.startWork")}
            </Button>
          </div>
          <Button size="lg" onClick={NOOP}>
            {t("actions.stopWork")}
          </Button>
        </Demo>

        <Demo title={t("preview.demoListHeading")}>
          <GroupedList heading={t("hours.recentHeading")} footer={t("myData.intro")}>
            <ListRow title="ma 28 sep" detail="08:02–16:31" value="7 u 59 min" />
            <ListButtonRow
              title={t("kiosk.menuLink")}
              value={t("kiosk.pinStateSet")}
              chevron
            />
            <ListButtonRow title={t("session.logout")} tone="danger" />
          </GroupedList>
        </Demo>

        <Demo title={t("preview.demoTimerHeading")}>
          <div className="flex flex-wrap gap-6">
            {STATUS.map((status) => (
              <StatusLine
                key={status.tone}
                tone={status.tone}
                label={t(status.label)}
              />
            ))}
          </div>
          <Timer valueMs={(3 * 60 + 24) * 60_000} spoken="3 u 24 min" />
          <ProgressTrack
            value={3.4}
            max={8.5}
            label={t("clock.progressLabel")}
            startLabel="08:00"
            endLabel={t("clock.plannedUntil", { time: "16:30" })}
          />
        </Demo>

        <Demo title={t("preview.demoFieldHeading")}>
          <Field
            id="preview-email"
            label={t("preview.demoEmailLabel")}
            hint={t("preview.demoEmailHint")}
          >
            <TextInput type="email" />
          </Field>
          <Field
            id="preview-email-error"
            label={t("preview.demoEmailLabel")}
            error={t("preview.demoEmailError")}
          >
            <TextInput type="email" defaultValue="jan@" />
          </Field>
          <Field
            id="preview-otp"
            label={t("loginCode.label")}
            hint={t("loginCode.hint")}
          >
            <OtpInput maxLength={6} defaultValue="123456" />
          </Field>
        </Demo>

        <Demo title={t("preview.demoAlertHeading")}>
          <Notice tone="info">{t("preview.demoAlertInfo")}</Notice>
          <Notice tone="success">{t("preview.demoAlertSuccess")}</Notice>
          {!dismissed ? (
            <Notice tone="error" onDismiss={() => setDismissed(true)}>
              {t("preview.demoAlertError")}
            </Notice>
          ) : null}
          <OfflineBanner queueing />
          <OfflineBanner queueing={false} />
        </Demo>

        <Demo title={t("preview.demoEmptyHeading")}>
          <EmptyState
            title={t("preview.demoEmptyTitle")}
            body={t("preview.demoEmptyBody")}
          />
        </Demo>

        <Demo title={t("preview.demoSheetHeading")}>
          <div>
            <Button variant="secondary" onClick={() => setSheetOpen(true)}>
              {t("preview.demoSheetOpen")}
            </Button>
          </div>
          <Sheet
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            title={t("session.logout")}
            description={t("preview.demoSheetBody")}
          >
            <div className="flex flex-col gap-3">
              <Button variant="destructive" wide onClick={() => setSheetOpen(false)}>
                {t("offline.signOutAnyway")}
              </Button>
              <Button variant="secondary" wide onClick={() => setSheetOpen(false)}>
                {t("offline.signOutCancel")}
              </Button>
            </div>
          </Sheet>
        </Demo>

        <Demo title={t("preview.demoNavHeading")}>
          <div className="overflow-hidden rounded-group border border-line">
            <TabBar items={NAV_ITEMS} label={t("bottomNav.label")} />
          </div>
        </Demo>
      </section>

      <section className="flex flex-col gap-12">
        <h2 className="text-headline">{t("preview.sectionClock")}</h2>
        <Demo title={t("preview.demoConfirmHeading")}>
          <ClockActions
            state="off"
            onStartWork={NOOP}
            onStopWork={NOOP}
            onStartBreak={NOOP}
            onStopBreak={NOOP}
            previewSuccess={{ action: "startWork", time: "08:02" }}
          />
        </Demo>
        <Demo title={t("preview.demoShiftListHeading")}>
          <ShiftList shifts={FAKE_PAST_SHIFTS} showOfflineSkew />
          <ShiftList shifts={[]} />
        </Demo>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-headline">{t("preview.sectionEmployeeHome")}</h2>
        <div className="mx-auto flex h-[760px] w-[390px] flex-col overflow-y-auto rounded-[44px] border-8 border-ink px-gutter py-6">
          <EmployeeHome
            shiftState="working"
            since={since}
            now={FAKE_NOW}
            todayShifts={FAKE_TODAY_SHIFTS}
            planned={{
              start: since - 2 * 60_000,
              end: since + 8.5 * 3_600_000,
              netMs: 8.5 * 3_600_000,
              range: "08:00–16:30",
            }}
            onStartWork={NOOP}
            onStopWork={NOOP}
            onStartBreak={NOOP}
            onStopBreak={NOOP}
          />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-headline">{t("preview.sectionKiosk")}</h2>
        <div className="rounded-group border border-line p-4">
          <KioskHome
            employees={FAKE_KIOSK_EMPLOYEES}
            selected={kioskSelected}
            onSelect={setKioskSelected}
            onSubmitPin={PIN_NOOP}
          />
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-headline">{t("preview.sectionManage")}</h2>
        <TodayBoard
          counters={FAKE_TODAY_BOARD_COUNTERS}
          people={FAKE_TODAY_BOARD_PEOPLE}
          attention={FAKE_TODAY_BOARD_ATTENTION}
        />
      </section>
    </div>
  );
}
