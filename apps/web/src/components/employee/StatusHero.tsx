import type { ReactNode } from "react";

import { t } from "@cloxa/i18n";

import type { HeroSurface, KlokHero } from "../clock/klok-hero";
import { CRing } from "../ui/CRing";
import { cx } from "../ui/cx";
import { KlokTopBar } from "./roles";

const SURFACE: Record<HeroSurface, string> = {
  forest: "on-forest bg-forest text-white",
  amber: "bg-break text-break-ink",
  light: "bg-card text-ink shadow-card",
};

const SECONDARY_TEXT: Record<HeroSurface, string> = {
  forest: "text-on-forest-2",
  amber: "text-break-ink",
  light: "text-ink-2",
};

export interface StatusHeroProps {
  hero: KlokHero;
  /** The clock buttons (and what went wrong with the last press, right above them). */
  children: ReactNode;
}

/**
 * The Klok hero: a block whose colour is the status (forest working, amber
 * pause, white otherwise) with the logo's ring as the timer and the clock
 * buttons under it. Phone: runs to the top of the screen with a rounded
 * bottom. Desktop: a card in the left column.
 */
export function StatusHero({ hero, children }: StatusHeroProps) {
  const text = SECONDARY_TEXT[hero.surface];
  return (
    <section
      aria-label={t("clock.heroLabel")}
      className={cx(
        "flex flex-col rounded-b-hero pb-6 md:pt-8 lg:rounded-clock",
        SURFACE[hero.surface],
      )}
    >
      <KlokTopBar onForest={hero.surface === "forest"} />
      <div className="relative mx-auto mt-5 flex size-[300px] items-center justify-center">
        <CRing
          progress={hero.progress}
          size={300}
          tone={
            hero.surface === "forest"
              ? "on-forest"
              : hero.surface === "amber"
                ? "on-amber"
                : "on-light"
          }
          running={hero.running}
          className="absolute inset-0"
        />
        <div className="relative flex max-w-[10rem] flex-col items-center gap-1 pr-4 text-center">
          <p aria-live="polite" className={cx("text-headline", text)}>
            {hero.status}
          </p>
          {hero.mainKind === "time" ? (
            <p className="text-[46px] leading-none font-extrabold tracking-[-0.04em] tabular-nums">
              <span aria-hidden="true">{hero.main}</span>
              <span className="sr-only">{hero.spoken}</span>
            </p>
          ) : (
            <p className="text-title-2">{hero.main}</p>
          )}
          {hero.sub ? <p className={cx("text-callout", text)}>{hero.sub}</p> : null}
        </div>
      </div>
      <div className="mt-6 flex flex-col gap-3 px-5">{children}</div>
    </section>
  );
}
