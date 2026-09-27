// Service-free visual fixture: no Next server, env files, Auth client or database.
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const fromVitest = createRequire(require.resolve("vitest/package.json"));
const { build } = await import(pathToFileURL(fromVitest.resolve("vite")).href);
const result = await build({
  root: resolve(root, "apps/web"),
  configFile: false,
  envDir: false,
  logLevel: "warn",
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": resolve(root, "apps/web/src") } },
  plugins: [
    {
      name: "synthetic-ux-only",
      enforce: "pre",
      resolveId(source) {
        if (source === "next/image") return "\0ux-image";
        if (source === "next/link" || source === "next/navigation") return "\0ux-next";
        if (/\/lib\/.*\/actions$/u.test(source) || /\/read-work-status$/u.test(source))
          return "\0ux-actions";
        if (/supabase|server-only/u.test(source))
          throw new Error("Service import prohibited in UX fixture");
      },
      load(id) {
        if (id === "\0ux-image")
          return `import {createElement} from 'react'; export default function Image(props){return createElement('img', props)}`;
        if (id === "\0ux-next")
          return `import {createElement, useSyncExternalStore} from 'react';
        const subscribe = fn => {window.addEventListener('popstate', fn); return () => window.removeEventListener('popstate', fn)};
        export const usePathname = () => useSyncExternalStore(subscribe, () => location.pathname);
        export default function Link({href,children,prefetch,...props}) {return createElement('a',{...props,href,onClick:e=>{e.preventDefault();history.pushState({},'',href);window.dispatchEvent(new PopStateEvent('popstate'));}},children)};
        export const useRouter = () => ({refresh(){window.dispatchEvent(new Event('focus'))}});`;
        if (id === "\0ux-actions")
          return `
        const prohibited = async () => {throw new Error('Mutations prohibited in synthetic fixture')};
        export const logoutAction = async () => ({status:'error',message:'Synthetische afmelding: geen echte sessie gewijzigd.'});
        export const changeTeam = prohibited, exportV2Action = prohibited;
        export const submitCorrectionRequestAction = prohibited, withdrawCorrectionRequestAction = prohibited, changeBreakCorrection = prohibited;
        export async function submitTimeClockAction(previous, form, scope) {
          const intent=form.get('operation'), id=form.get('request_id');
          window.uxActions.push({intent,id,keys:[...form.keys()]});
          await new Promise(r=>setTimeout(r,window.uxActionDelay || 0));
          if(scope!==window.uxScope) return {status:'error',message:'Synthetische scope gewijzigd'};
          if(window.uxActionRefused) return {status:'error',requestId:id,message:'Synthetische klokactie geweigerd.'};
          window.uxState={status:({clock_in:'working',clock_out:'not_working',start_break:'on_break',end_break:'working'})[intent],currentStartedAt:intent==='clock_out'?null:'2026-09-07T07:00:00Z'};
          return {status:'success',requestId:id,message:'Synthetische klokactie bevestigd.'};
        }
        export const decideCorrectionRequestAction = async () => ({status:'error', message:'Synthetische validatiemelding: vul een toelichting in voordat je deze aanvraag afhandelt. '.repeat(8), noteError:'Vul een reden in.'});
        export async function readWorkStatus(scope) { window.uxReads++; const snapshot = window.uxState ? {...window.uxState,serverTime:window.uxServerTime || new Date(Date.now()+window.uxReads).toISOString()} : null; const delay = window.uxDelay || 0; await new Promise(r => setTimeout(r, delay)); return scope === window.uxScope ? snapshot : null; }`;
      },
    },
  ],
  build: {
    write: false,
    minify: false,
    rolldownOptions: {
      input: resolve(root, "apps/web/e2e/ux-preview.tsx"),
      output: { entryFileNames: "preview.js" },
    },
  },
});
if (Array.isArray(result) || !("output" in result))
  throw new Error("Unexpected fixture bundle");
const files = new Map(
  result.output.map((item) => [
    "/" + item.fileName,
    "code" in item ? item.code : item.source,
  ]),
);
const css = [...files.keys()]
  .filter((name) => name.endsWith(".css"))
  .map((name) => `<link rel="stylesheet" href="${name}">`)
  .join("");
const logo = await readFile(
  resolve(root, "apps/web/public/branding/cloxa-compact.svg"),
);
const html = `<!doctype html><html lang="nl"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Cloxa — synthetische UX-controle</title>${css}</head><body><div id="root"></div><script type="module" src="/preview.js"></script></body></html>`;
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  if (path === "/branding/cloxa-compact.svg" && logo) {
    res.setHeader("Content-Type", "image/svg+xml");
    res.end(logo);
    return;
  }
  const file = files.get(path);
  if (file) {
    res.setHeader(
      "Content-Type",
      path.endsWith(".css")
        ? "text/css"
        : path.endsWith(".woff2")
          ? "font/woff2"
          : "text/javascript",
    );
    res.end(file);
    return;
  }
  if (path === "/" || path.startsWith("/employee") || path.startsWith("/manager")) {
    res.setHeader("Content-Type", "text/html");
    res.end(html);
    return;
  }
  res.statusCode = 404;
  res.end();
});
server.listen(3174, "127.0.0.1", () =>
  console.log("Synthetic UX fixture: http://127.0.0.1:3174 — no services"),
);
for (const event of ["SIGINT", "SIGTERM"])
  process.on(event, () => server.close(() => process.exit(0)));
