import type { Metadata } from "next";
import Link from "next/link";
import { FileDown, Lock, MousePointerClick, type LucideIcon } from "lucide-react";

import { t } from "@cloxa/i18n";

import { SITE_WIDTH, SiteChrome } from "@/components/site/SiteChrome";
import { buttonClassName } from "@/components/ui/Button";
import { CRing } from "@/components/ui/CRing";

export const metadata: Metadata = {
  title: { absolute: t("landing.metaTitle") },
  description: t("landing.metaDescription"),
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "nl_BE",
    siteName: t("common.appName"),
    title: t("landing.metaTitle"),
    description: t("landing.metaDescription"),
    url: "/",
    images: [
      { url: "/marketing/og.png", width: 1200, height: 630, alt: t("landing.og.alt") },
    ],
  },
  twitter: { card: "summary_large_image" },
};

const BENEFITS: readonly { key: "simple" | "safe" | "admin"; icon: LucideIcon }[] = [
  { key: "simple", icon: MousePointerClick },
  { key: "safe", icon: Lock },
  { key: "admin", icon: FileDown },
];
const QUESTIONS = ["dimona", "phone", "data", "secretariat", "price"] as const;

const SECTION = "mt-16 md:mt-24";
const H2 = "text-title-1 md:text-[34px] md:leading-[1.15]";

/** A screenshot with fictional data (the app is light only). */
function Screenshot({
  name,
  width,
  height,
  alt,
  className,
}: {
  name: string;
  width: number;
  height: number;
  alt: string;
  className: string;
}) {
  return (
    <img
      src={`/marketing/${name}.webp`}
      width={width}
      height={height}
      alt={alt}
      decoding="async"
      className={className}
    />
  );
}

function Hero() {
  return (
    <div className={`${SITE_WIDTH} relative pt-8 pb-28 md:pt-16 md:pb-36`}>
      <div className="relative max-w-xl">
        <h1 className="text-[40px] leading-[1.05] font-extrabold tracking-[-0.035em] md:text-[60px]">
          {t("landing.hero.title")}
        </h1>
        <p className="mt-6 text-title-3 text-on-forest-2">{t("landing.hero.subtitle")}</p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link href="/aanvragen" className={buttonClassName("action")}>
            {t("landing.hero.primary")}
          </Link>
          <Link href="/login" className={buttonClassName("ghost-on-forest")}>
            {t("landing.hero.secondary")}
          </Link>
        </div>
        <p className="mt-5 text-subhead text-on-forest-2">{t("landing.hero.note")}</p>
      </div>
      <div className="mt-12 flex justify-center md:absolute md:top-1/2 md:right-10 md:mt-0 md:-translate-y-1/2">
        <CRing progress={0.72} size={240} running className="md:size-[340px]" />
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <SiteChrome hero={<Hero />}>
      <section
        aria-labelledby="voordelen"
        className={`${SITE_WIDTH} relative -mt-14 md:-mt-20`}
      >
        <h2 id="voordelen" className="sr-only">
          {t("landing.benefits.heading")}
        </h2>
        <ul className="grid gap-4 md:grid-cols-3 md:gap-5">
          {BENEFITS.map(({ key, icon: Icon }) => (
            <li key={key} className="rounded-card bg-card p-6 shadow-card">
              <span className="flex size-12 items-center justify-center rounded-control bg-forest text-white">
                <Icon aria-hidden="true" className="size-6" />
              </span>
              <h3 className="mt-5 text-title-3">{t(`landing.benefits.${key}.title`)}</h3>
              <p className="mt-3 text-callout text-ink-2">
                {t(`landing.benefits.${key}.body`)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="zo-ziet-het-eruit"
        className={`${SITE_WIDTH} ${SECTION}`}
      >
        <h2 id="zo-ziet-het-eruit" className={H2}>
          {t("landing.visual.heading")}
        </h2>
        <div className="mt-8 flex flex-col items-center gap-8 rounded-hero bg-fill p-6 md:flex-row md:items-end md:gap-10 md:p-10">
          <div className="w-3/4 max-w-[270px] shrink-0 rounded-[2.5rem] bg-ink p-2.5 shadow-card md:w-[30%]">
            <Screenshot
              name="klok-werk-phone"
              width={390}
              height={862}
              alt={t("landing.visual.phoneAlt")}
              className="h-auto w-full rounded-[2rem]"
            />
          </div>
          <div className="w-full min-w-0 overflow-hidden rounded-card border border-line bg-card shadow-card md:flex-1">
            <div aria-hidden="true" className="flex gap-1.5 border-b border-line px-4 py-3">
              <span className="size-2.5 rounded-full bg-line" />
              <span className="size-2.5 rounded-full bg-line" />
              <span className="size-2.5 rounded-full bg-line" />
            </div>
            <Screenshot
              name="beheer-vandaag-desktop"
              width={1440}
              height={1007}
              alt={t("landing.visual.desktopAlt")}
              className="h-auto w-full"
            />
          </div>
        </div>
        <p className="mt-3 text-subhead text-ink-2">{t("landing.visual.caption")}</p>
      </section>

      <section aria-labelledby="wet" className={`${SITE_WIDTH} ${SECTION}`}>
        <div className="grid gap-4 rounded-card border-l-8 border-forest bg-card p-6 shadow-card md:grid-cols-[1fr_2fr] md:gap-10 md:p-10">
          <h2 id="wet" className={H2}>
            {t("landing.law.heading")}
          </h2>
          <div>
            <p className="text-body">{t("landing.law.body")}</p>
            <p className="mt-4">
              <a
                href="#faq"
                className="focus-ring inline-flex min-h-touch-target items-center rounded-control text-body font-bold underline"
              >
                {t("landing.law.link")}
              </a>
            </p>
          </div>
        </div>
      </section>

      <section
        id="faq"
        aria-labelledby="faq-titel"
        className={`${SITE_WIDTH} ${SECTION} scroll-mt-6`}
      >
        <h2 id="faq-titel" className={H2}>
          {t("landing.faq.heading")}
        </h2>
        <div className="mt-8 divide-y divide-line rounded-card bg-card shadow-card">
          {QUESTIONS.map((key) => (
            <details key={key} className="group px-5">
              <summary className="focus-ring flex min-h-row cursor-pointer list-none items-center justify-between gap-4 rounded-control py-3 text-headline [&::-webkit-details-marker]:hidden">
                {t(`landing.faq.${key}.question`)}
                <span
                  aria-hidden="true"
                  className="text-title-3 text-ink-2 transition-transform group-open:rotate-45 after:content-['+']"
                />
              </summary>
              <p className="max-w-3xl pb-5 text-body text-ink-2">
                {t(`landing.faq.${key}.answer`)}
                {key === "data" ? (
                  <>
                    {" "}
                    <Link href="/privacy" className="focus-ring rounded-sm underline">
                      {t("landing.footer.privacy")}
                    </Link>
                  </>
                ) : null}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section aria-labelledby="start" className={`${SITE_WIDTH} ${SECTION}`}>
        <div className="on-forest relative overflow-hidden rounded-hero bg-forest p-8 text-white md:p-14">
          <div className="relative max-w-xl">
            <h2 id="start" className="text-title-1 md:text-[40px] md:leading-[1.1]">
              {t("landing.cta.heading")}
            </h2>
            <p className="mt-3 text-body text-on-forest-2">{t("landing.cta.body")}</p>
            <div className="mt-8">
              <Link href="/aanvragen" className={buttonClassName("action")}>
                {t("landing.hero.primary")}
              </Link>
            </div>
          </div>
          <CRing
            progress={0.72}
            size={260}
            className="absolute -right-16 -bottom-16 hidden opacity-60 md:block"
          />
        </div>
      </section>
    </SiteChrome>
  );
}
