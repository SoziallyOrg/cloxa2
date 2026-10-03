import Link from "next/link";

import { t, type LegalBlock, type LegalDocument } from "@cloxa/i18n";

import { SITE_WIDTH, SiteChrome } from "./SiteChrome";

function Block({ block }: { block: LegalBlock }) {
  switch (block.kind) {
    case "p":
      return <p>{block.text}</p>;
    case "list":
      return (
        <ul className="ml-5 list-disc space-y-2 marker:text-ink-3">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded-group bg-surface">
          <table className="w-full min-w-[32rem] border-collapse text-left text-subhead">
            <thead>
              <tr className="border-b border-separator">
                {block.head.map((cell) => (
                  <th key={cell} scope="col" className="px-4 py-3 font-semibold">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row[0]} className="border-b border-separator last:border-b-0">
                  {row.map((cell, index) => (
                    <td
                      key={cell}
                      className={index === 0 ? "px-4 py-3 font-semibold" : "px-4 py-3"}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/**
 * A legal text: a clear "concept" notice first, a table of contents, then the
 * sections at a comfortable reading width and size.
 */
export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <SiteChrome>
      <article className={`${SITE_WIDTH} max-w-3xl pt-8 md:pt-16`}>
        <div role="note" className="mb-8 rounded-group bg-surface p-5">
          <p className="text-headline text-attention">{t("legal.draftBanner")}</p>
          <p className="mt-1 text-subhead text-ink-2">{t("legal.draftNote")}</p>
        </div>

        <h1 className="text-large-title md:text-[44px] md:leading-[1.1]">
          {document.title}
        </h1>
        <p className="mt-2 text-subhead text-ink-2">
          <time dateTime={document.updatedIso}>
            {t("legal.updated", { date: document.updatedLabel })}
          </time>
        </p>
        <p className="mt-6 text-body text-ink-2">{document.intro}</p>

        <nav aria-labelledby="legal-toc" className="mt-8 rounded-group bg-surface p-5">
          <h2 id="legal-toc" className="text-headline">
            {t("legal.tocHeading")}
          </h2>
          <ol className="mt-3 space-y-1">
            {document.sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="focus-ring inline-flex min-h-touch-target items-center rounded-control underline"
                >
                  {section.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-4 space-y-12 pb-8">
          {document.sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-6">
              <h2 className="mt-12 text-title-2 font-semibold">{section.heading}</h2>
              <div className="mt-4 space-y-4 text-body leading-relaxed">
                {section.blocks.map((block, index) => (
                  <Block key={index} block={block} />
                ))}
              </div>
            </section>
          ))}
        </div>

        <p>
          <Link href="/" className="focus-ring rounded-control underline">
            {t("legal.back")}
          </Link>
        </p>
      </article>
    </SiteChrome>
  );
}
