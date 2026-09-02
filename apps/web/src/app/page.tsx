import { ArrowRight, Check, FileCheck2 } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { nlBE } from "@/i18n/nl-BE";

export default function HomePage() {
  return (
    <main className="flex-1" id="main-content">
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
        <div className="overflow-hidden rounded-2xl border border-rule-strong bg-paper">
          <div className="grid lg:grid-cols-[minmax(0,0.92fr)_minmax(28rem,1.08fr)]">
            <div className="flex flex-col justify-between p-6 sm:p-10 lg:min-h-[38rem] lg:p-14">
              <div>
                <h1 className="max-w-2xl font-display text-5xl leading-[0.96] font-semibold tracking-[-0.035em] text-balance text-ink sm:text-6xl lg:text-[5.25rem]">
                  {nlBE.home.title}
                </h1>
                <p className="mt-6 max-w-xl text-lg leading-8 text-muted">
                  {nlBE.home.introduction}
                </p>
              </div>

              <div className="mt-10">
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap lg:flex-col lg:items-start">
                  <Button asChild size="large">
                    <Link href="/login">
                      {nlBE.common.openLogin}
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                  <Button asChild size="large" variant="secondary">
                    <Link href="/signup">{nlBE.common.invitationRegistration}</Link>
                  </Button>
                </div>
                <p className="mt-7 max-w-xl border-t border-rule pt-5 text-sm leading-6 text-muted">
                  {nlBE.home.boundary}
                </p>
              </div>
            </div>

            <div className="docket-surface border-t border-rule p-6 sm:p-10 lg:flex lg:min-h-[38rem] lg:flex-col lg:justify-center lg:border-t-0 lg:border-l lg:p-12">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <h2 className="font-display text-3xl leading-tight font-semibold tracking-[-0.025em] text-balance text-ink sm:text-4xl">
                    {nlBE.home.workflowTitle}
                  </h2>
                  <p className="mt-4 max-w-xl leading-7 text-muted">
                    {nlBE.home.workflowDescription}
                  </p>
                </div>
                <FileCheck2
                  aria-hidden="true"
                  className="hidden size-9 shrink-0 text-primary sm:block"
                  strokeWidth={1.7}
                />
              </div>

              <ol className="workflow-trace mt-10 grid gap-7 lg:grid-cols-4 lg:gap-4">
                {nlBE.home.workflow.map((step, index) => (
                  <li
                    className="workflow-step relative grid grid-cols-[2rem_1fr] gap-4 lg:block"
                    key={step.title}
                  >
                    <span
                      aria-hidden="true"
                      className="relative z-10 flex size-8 items-center justify-center rounded-full border border-primary bg-paper text-xs font-bold text-primary ring-4 ring-paper"
                    >
                      {index + 1}
                    </span>
                    <div className="lg:mt-5">
                      <h3 className="text-sm leading-5 font-bold text-ink">
                        {step.title}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-muted">
                        {step.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-rule bg-paper-strong">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8 lg:py-16">
          <h2 className="max-w-md font-display text-4xl leading-tight font-semibold tracking-[-0.03em] text-balance text-ink">
            {nlBE.home.scopeTitle}
          </h2>
          <ul className="grid border-t border-rule-strong sm:grid-cols-2">
            {nlBE.home.scopeItems.map((item) => (
              <li
                className="flex min-h-20 items-center gap-3 border-b border-rule py-5 text-sm font-semibold text-ink sm:px-5 sm:odd:border-r"
                key={item}
              >
                <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
