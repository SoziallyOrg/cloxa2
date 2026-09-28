"use client";

import { useState, type ReactNode } from "react";
import {
  Bell,
  CalendarDays,
  Clock,
  Download,
  LayoutGrid,
  MapPin,
  MessageCircleQuestionMark,
  UserRound,
  WifiOff,
} from "lucide-react";

import { t } from "@cloxa/i18n";

import { ActionSheet } from "@/components/ui/ActionSheet";
import { ActivityIndicator } from "@/components/ui/ActivityIndicator";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorView } from "@/components/ui/ErrorView";
import { Field } from "@/components/ui/Field";
import { List, Row, Section } from "@/components/ui/List";
import { Notice } from "@/components/ui/Notice";
import { OtpInput } from "@/components/ui/OtpInput";
import { ProgressTrack } from "@/components/ui/ProgressTrack";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet, type SheetDetent } from "@/components/ui/Sheet";
import { SidebarNav } from "@/components/ui/SidebarLayout";
import { SkeletonList, SkeletonTitle } from "@/components/ui/Skeleton";
import { StatusLine, type StatusTone } from "@/components/ui/StatusLine";
import { Switch } from "@/components/ui/Switch";
import { TabBar, type NavItem } from "@/components/ui/TabBar";
import { TextInput } from "@/components/ui/TextInput";
import { Timer } from "@/components/ui/Timer";

const NOOP = () => {};

const STATUS: readonly { tone: StatusTone; label: Parameters<typeof t>[0] }[] = [
  { tone: "working", label: "status.workingLabel" },
  { tone: "break", label: "status.breakLabel" },
  { tone: "attention", label: "offline.notSent" },
  { tone: "danger", label: "status.errorLabel" },
  { tone: "off", label: "status.offLabel" },
];

const NAV_DEMO: readonly NavItem[] = [
  {
    key: "clock",
    label: t("bottomNav.clock"),
    href: "#navigatie",
    current: true,
    icon: Clock,
  },
  {
    key: "hours",
    label: t("bottomNav.hours"),
    href: "#navigatie",
    current: false,
    icon: CalendarDays,
  },
  {
    key: "questions",
    label: t("bottomNav.questions"),
    href: "#navigatie",
    current: false,
    icon: MessageCircleQuestionMark,
    count: 3,
  },
  {
    key: "today",
    label: t("manageNav.today"),
    href: "#navigatie",
    current: false,
    icon: LayoutGrid,
  },
];

/** A section that holds free content (controls, buttons) instead of rows. */
function Group({
  id,
  header,
  footer,
  children,
}: {
  id: string;
  header: string;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="flex scroll-mt-24 flex-col">
      <h2 className="px-4 pb-2 text-subhead text-ink-2">{header}</h2>
      <div className="flex flex-col gap-4 px-4 pt-1">{children}</div>
      {footer ? <p className="px-4 pt-2 text-subhead text-ink-2">{footer}</p> : null}
    </section>
  );
}

export function PreviewContent() {
  const [sheet, setSheet] = useState<SheetDetent | null>(null);
  const [actions, setActions] = useState(false);
  const [alert, setAlert] = useState(false);
  const [offline, setOffline] = useState(true);
  const [period, setPeriod] = useState<"week" | "month" | "year">("week");

  return (
    <List className="pb-16">
      <div id="lijsten" className="scroll-mt-24">
        <Section header={t("preview.sectionLists")} footer={t("preview.listFooter")}>
          <Row
            href="/preview/push"
            icon={Clock}
            title={t("preview.rowPushed")}
            subtitle={t("preview.rowPushedSubtitle")}
          />
          <Row
            href="/preview/push"
            icon={MapPin}
            title={t("preview.rowSite")}
            value={t("preview.rowSiteValue")}
          />
          <Row
            icon={CalendarDays}
            title={t("preview.rowWeek")}
            subtitle={t("preview.rowWeekSubtitle")}
            value={t("preview.rowWeekValue")}
          />
          <Row
            icon={UserRound}
            title={t("preview.rowLongName")}
            value={t("preview.rowLongNameValue")}
            chevron
            onClick={() => setActions(true)}
          />
          <Row
            href="#lijsten"
            download
            icon={Download}
            title={t("preview.rowDownload")}
            subtitle={t("preview.rowDownloadSubtitle")}
          />
          <Row title={t("preview.rowChoose")} onClick={() => setActions(true)} />
          <Row title={t("preview.rowStatic")} value={t("preview.rowStaticValue")} />
          <Row
            title={t("session.logout")}
            tone="danger"
            onClick={() => setAlert(true)}
          />
        </Section>
      </div>

      <div id="bediening" className="flex scroll-mt-24 flex-col gap-8">
        <Section
          header={t("preview.sectionControls")}
          footer={t("preview.switchFooter")}
        >
          <Row
            icon={WifiOff}
            title={t("preview.switchOffline")}
            accessory={
              <Switch
                label={t("preview.switchOffline")}
                checked={offline}
                onCheckedChange={setOffline}
                name="offline"
              />
            }
          />
          <Row
            icon={MapPin}
            title={t("preview.switchLocation")}
            accessory={<Switch label={t("preview.switchLocation")} />}
          />
          <Row
            icon={Bell}
            title={t("preview.switchManaged")}
            accessory={
              <Switch label={t("preview.switchManaged")} defaultChecked disabled />
            }
          />
        </Section>
        <Group id="segmenten" header={t("preview.segmentLabel")}>
          <SegmentedControl
            label={t("preview.segmentLabel")}
            value={period}
            onValueChange={setPeriod}
            options={[
              { value: "week", label: t("preview.segmentWeek") },
              { value: "month", label: t("preview.segmentMonth") },
              { value: "year", label: t("preview.segmentYear") },
            ]}
          />
          <SegmentedControl
            label={t("preview.segmentViewLabel")}
            defaultValue="timeline"
            options={[
              { value: "list", label: t("preview.segmentList") },
              { value: "timeline", label: t("preview.segmentTimeline") },
            ]}
          />
        </Group>
      </div>

      <Group id="knoppen" header={t("preview.sectionButtons")}>
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
      </Group>

      <Group id="bladen" header={t("preview.sectionOverlays")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button variant="secondary" wide onClick={() => setSheet("medium")}>
            {t("preview.openSheetMedium")}
          </Button>
          <Button variant="secondary" wide onClick={() => setSheet("large")}>
            {t("preview.openSheetLarge")}
          </Button>
          <Button variant="secondary" wide onClick={() => setActions(true)}>
            {t("preview.openActionSheet")}
          </Button>
          <Button variant="destructive" wide onClick={() => setAlert(true)}>
            {t("preview.openAlert")}
          </Button>
        </div>
      </Group>

      <section id="laden" className="flex scroll-mt-24 flex-col gap-4">
        <h2 className="px-4 text-subhead text-ink-2">{t("preview.sectionLoading")}</h2>
        <div className="-mx-inset">
          <SkeletonTitle />
        </div>
        <SkeletonList header icon rows={3} />
        <SkeletonList subtitle value rows={3} />
        <div className="flex items-center gap-3 px-4 text-subhead text-ink-2">
          <ActivityIndicator />
          <span>{t("preview.pullHint")}</span>
        </div>
      </section>

      <Group id="leeg" header={t("preview.sectionEmpty")}>
        <EmptyState
          icon={MessageCircleQuestionMark}
          title={t("preview.emptyTitle")}
          body={t("preview.emptyBody")}
          action={<Button onClick={NOOP}>{t("questions.newRequest")}</Button>}
        />
        <ErrorView headingLevel={2} onRetry={NOOP} />
      </Group>

      <section id="navigatie" className="flex scroll-mt-24 flex-col gap-4">
        <h2 className="px-4 text-subhead text-ink-2">{t("preview.sectionNav")}</h2>
        <p className="px-4 text-footnote text-ink-2">{t("preview.tabBarHeading")}</p>
        <div className="overflow-hidden rounded-list">
          <TabBar items={NAV_DEMO} label={t("preview.tabBarHeading")} />
        </div>
        <p className="px-4 text-footnote text-ink-2">{t("preview.sidebarHeading")}</p>
        <div className="max-w-sidebar rounded-list material-sidebar p-3">
          <SidebarNav items={NAV_DEMO} label={t("preview.sidebarHeading")} />
        </div>
      </section>

      <Group id="status" header={t("preview.sectionStatus")}>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {STATUS.map((status) => (
            <StatusLine key={status.tone} tone={status.tone} label={t(status.label)} />
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
      </Group>

      <Group id="formulieren" header={t("preview.sectionForms")}>
        <Field
          id="preview-email"
          label={t("preview.emailLabel")}
          hint={t("preview.emailHint")}
        >
          <TextInput type="email" />
        </Field>
        <Field
          id="preview-email-error"
          label={t("preview.emailLabel")}
          error={t("preview.emailError")}
        >
          <TextInput type="email" defaultValue="jan@" />
        </Field>
        <Field id="preview-otp" label={t("loginCode.label")} hint={t("loginCode.hint")}>
          <OtpInput maxLength={6} defaultValue="123456" />
        </Field>
        <Notice tone="info" autoFocus={false}>
          {t("preview.noticeInfo")}
        </Notice>
        <Notice tone="success" autoFocus={false}>
          {t("preview.noticeSuccess")}
        </Notice>
        <Notice tone="error" autoFocus={false}>
          {t("preview.noticeError")}
        </Notice>
      </Group>

      <Sheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        title={t("preview.sheetTitle")}
        description={t("preview.sheetBody")}
        detent={sheet ?? "medium"}
        closeLabel={t("ui.done")}
      >
        <Section>
          <Row title={t("hours.detailTime")} value="08:02–16:31" />
          <Row title={t("hours.detailPause")} value="30 min" />
          <Row title={t("hours.detailNet")} value="7 u 59 min" />
        </Section>
        <Button variant="secondary" wide onClick={() => setSheet(null)}>
          {t("hours.somethingWrong")}
        </Button>
      </Sheet>

      <ActionSheet
        open={actions}
        onClose={() => setActions(false)}
        title={t("preview.actionSheetTitle")}
        actions={[
          { key: "edit", label: t("preview.actionEdit"), onSelect: NOOP },
          { key: "share", label: t("preview.actionShare"), onSelect: NOOP },
          {
            key: "withdraw",
            label: t("preview.actionWithdraw"),
            destructive: true,
            onSelect: () => setAlert(true),
          },
        ]}
      />

      <Alert
        open={alert}
        onClose={() => setAlert(false)}
        title={t("preview.alertTitle")}
        message={t("preview.alertMessage")}
        confirmLabel={t("preview.alertConfirm")}
        destructive
        onConfirm={NOOP}
      />
    </List>
  );
}
