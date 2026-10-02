import Link from "next/link";
import type { Route } from "next";

import { t } from "@cloxa/i18n";

import { buttonClassName } from "../ui/Button";
import { CRing } from "../ui/CRing";
import { cx } from "../ui/cx";
import type { TodayPerson } from "./today-types";

const BLOCK_TONE = {
  working: { box: "bg-forest text-white", sub: "text-on-forest-2" },
  break: { box: "bg-break text-break-ink", sub: "text-break-ink" },
  idle: { box: "bg-idle text-ink", sub: "text-ink-2" },
} as const;

const RING_TONE = {
  working: "on-forest",
  break: "on-amber",
  idle: "on-light",
} as const;

/**
 * The "Medewerker" tab: the person's clock block with the small ring, today's
 * events, indicative week totals and the two ways on (hours, correction).
 * Facts only: no pay, no legal outcome.
 */
export function PersonPanel({ person }: { person: TodayPerson }) {
  const { block } = person;
  const tone = BLOCK_TONE[block.tone];

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-title-2 break-words">{person.name}</h2>

      <div className={cx("flex items-center gap-4 rounded-clock p-4", tone.box)}>
        <CRing
          progress={block.progress}
          size={56}
          tone={RING_TONE[block.tone]}
          running={block.running}
        />
        <div className="flex min-w-0 flex-col">
          <span className={cx("text-footnote", tone.sub)}>{block.title}</span>
          {block.time ? (
            <span className="text-title-1 tabular-nums">
              <span className="sr-only">{block.spoken}</span>
              <span aria-hidden="true">{block.time}</span>
            </span>
          ) : null}
        </div>
      </div>

      {person.attentionItems.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {person.attentionItems.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-2 rounded-card bg-danger-tint p-3 text-danger-tint-ink"
            >
              <p className="text-subhead font-semibold">{item.label}</p>
              <Link
                href={person.href as Route}
                aria-label={t("manage.fixFor", { name: person.name })}
                className={buttonClassName(
                  item.fix ? "danger" : "secondary",
                  "sm",
                  true,
                )}
              >
                {item.action}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <section aria-label={t("manageToday.eventsHeading")}>
        <ul className="flex flex-col">
          {person.events.length === 0 ? (
            <li className="py-2 text-subhead text-ink-2">
              {t("manageToday.noEventsToday")}
            </li>
          ) : (
            person.events.map((event, index) => (
              <li
                key={`${event.time}-${index}`}
                className={cx(
                  "flex gap-4 border-b border-line py-2.5 text-callout last:border-b-0",
                  event.muted && "text-ink-2",
                )}
              >
                <span className="w-12 shrink-0 font-bold tabular-nums">
                  {event.time}
                </span>
                <span className="min-w-0 break-words">{event.label}</span>
              </li>
            ))
          )}
        </ul>
      </section>

      {person.weekWorked || person.weekPlanned ? (
        <dl className="flex flex-col gap-2 text-callout">
          {person.weekWorked ? (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-2">{t("manageToday.weekWorked")}</dt>
              <dd className="font-bold tabular-nums">{person.weekWorked}</dd>
            </div>
          ) : null}
          {person.weekPlanned ? (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-2">{t("manageToday.weekPlanned")}</dt>
              <dd className="font-bold tabular-nums">{person.weekPlanned}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <div className="flex flex-col gap-2 pt-1">
        <Link
          href={person.href as Route}
          className={buttonClassName("primary", "md", true)}
        >
          {t("manageToday.viewHours")}
        </Link>
        <Link
          href={person.href as Route}
          className={buttonClassName("secondary", "md", true)}
        >
          {t("manageToday.addCorrection")}
        </Link>
      </div>
    </div>
  );
}
