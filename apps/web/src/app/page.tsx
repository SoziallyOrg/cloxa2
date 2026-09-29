import type { Metadata } from "next";
import Link from "next/link";

import { t } from "@cloxa/i18n";

import { SITE_WIDTH, SiteChrome } from "@/components/site/SiteChrome";
import { buttonClassName } from "@/components/ui/Button";

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

const BENEFITS = ["simple", "safe", "admin"] as const;
const QUESTIONS = ["dimona", "phone", "data", "secretariat", "price"] as const;

const SECTION = "mt-20 md:mt-28";
const H2 = "text-title-1 font-semibold md:text-[34px] md:leading-[1.15]";

/** A screenshot with fictional data; the dark one is only fetched in dark mode. */
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
    <picture>
      <source
        media="(prefers-color-scheme: dark)"
        srcSet={`/marketing/${name}-dark.webp`}
      />
      <img
        src={`/marketing/${name}-light.webp`}
        width={width}
        height={height}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={`${className} h-auto rounded-2xl border border-separator`}
      />
    </picture>
  );
}

export default function LandingPage() {
  return (
    <SiteChrome>
      <section className={`${SITE_WIDTH} pt-10 md:pt-20`}>
        <h1 className="max-w-3xl text-[40px] leading-[1.05] font-semibold tracking-[-0.03em] md:text-[64px]">
          {t("landing.hero.title")}
        </h1>
        <p className="mt-6 max-w-2xl text-title-3 text-ink-2">
          {t("landing.hero.subtitle")}
        </p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link href="/aanvragen" className={buttonClassName("primary")}>
            {t("landing.hero.primary")}
          </Link>
          <Link href="/login" className={buttonClassName("secondary")}>
            {t("landing.hero.secondary")}
          </Link>
        </div>
        <p className="mt-4 text-subhead text-ink-2">{t("landing.hero.note")}</p>
      </section>

      <section aria-labelledby="voordelen" className={`${SITE_WIDTH} ${SECTION}`}>
        <h2 id="voordelen" className="sr-only">
          {t("landing.benefits.heading")}
        </h2>
        <ul className="grid gap-10 md:grid-cols-3 md:gap-8">
          {BENEFITS.map((key) => (
            <li key={key}>
              <h3 className="text-title-3 font-semibold">
                {t(`landing.benefits.${key}.title`)}
              </h3>
              <p className="mt-3 text-body text-ink-2">
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
        <div className="mt-8 flex flex-col items-center gap-6 rounded-group bg-surface p-6 md:flex-row md:items-end md:gap-10 md:p-10">
          <div className="w-2/3 max-w-[260px] shrink-0 md:w-[34%]">
            <Screenshot
              name="klok-werk-phone"
              width={390}
              height={844}
              alt={t("landing.visual.phoneAlt")}
              className="w-full"
            />
          </div>
          <div className="w-full min-w-0 md:flex-1">
            <Screenshot
              name="beheer-vandaag-desktop"
              width={1440}
              height={1109}
              alt={t("landing.visual.desktopAlt")}
              className="w-full"
            />
          </div>
        </div>
        <p className="mt-3 text-subhead text-ink-2">{t("landing.visual.caption")}</p>
      </section>

      <section aria-labelledby="wet" className={`${SITE_WIDTH} ${SECTION}`}>
        <div className="max-w-3xl rounded-group bg-surface p-6 md:p-10">
          <h2 id="wet" className={H2}>
            {t("landing.law.heading")}
          </h2>
          <p className="mt-4 text-body">{t("landing.law.body")}</p>
          <p className="mt-4">
            <a
              href="#faq"
              className="focus-ring inline-flex min-h-touch-target items-center rounded-control text-body font-semibold underline"
            >
              {t("landing.law.link")}
            </a>
          </p>
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
        <div className="mt-8 max-w-3xl divide-y divide-separator rounded-group bg-surface">
          {QUESTIONS.map((key) => (
            <details key={key} className="group px-5">
              <summary className="focus-ring flex min-h-row cursor-pointer list-none items-center justify-between gap-4 rounded-control py-3 text-headline [&::-webkit-details-marker]:hidden">
                {t(`landing.faq.${key}.question`)}
                <span
                  aria-hidden="true"
                  className="text-title-3 text-ink-2 transition-transform group-open:rotate-45 after:content-['+']"
                />
              </summary>
              <p className="pb-5 text-body text-ink-2">
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
        <h2 id="start" className={H2}>
          {t("landing.cta.heading")}
        </h2>
        <p className="mt-3 max-w-xl text-body text-ink-2">{t("landing.cta.body")}</p>
        <div className="mt-8">
          <Link href="/aanvragen" className={buttonClassName("primary")}>
            {t("landing.hero.primary")}
          </Link>
        </div>
      </section>
    </SiteChrome>
  );
}
