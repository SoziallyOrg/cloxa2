# Cloxa live zetten — stappenplan

Voor de VPS, DNS, Supabase en de eerste deploy. Geen devops-voorkennis nodig; volg de
stappen in volgorde. Details staan in commentaar in `deploy/*` en `Dockerfile`.

## 1. VPS bij Hostinger

- Kies een datacenter **in de EU** (bv. Frankfurt/Amsterdam), Ubuntu 24.04 LTS.
- Log in via SSH als root en draai het bootstrap-script:
  `ssh root@<ip> 'bash -s' < deploy/scripts/bootstrap-vps.sh`
- Dit installeert Docker, maakt een `cloxa`-gebruiker, zet de firewall (ufw) op alleen
  22/80/443, zet fail2ban en automatische beveiligingsupdates aan, en zet
  wachtwoord-login voor SSH uit.
- **Belangrijk:** het script sluit aan het eind je wachtwoord-toegang af. Houd de
  huidige SSH-sessie open en open een **tweede** sessie om te checken dat je nog kunt
  inloggen (met SSH-key, als `cloxa`-gebruiker) voordat je de eerste sluit.

## 2. DNS bij Hostinger

Bij het domein `cloxa.app`, in het Hostinger DNS-paneel:

- `A` record `@` → IPv4 van de VPS
- `AAAA` record `@` → IPv6 van de VPS (indien beschikbaar)
- `A`/`AAAA` record `www` → zelfde IP (Caddy redirect't `www` naar het kale domein)
- SPF: `TXT` record `@` met de waarde uit het Hostinger mailpaneel (meestal
  `v=spf1 include:_spf.hostinger.com ~all`, exacte tekst staat in het paneel)
- DKIM: `TXT` record, naam en waarde exact zoals getoond in het Hostinger mailpaneel
  (E-mail → DKIM)
- DMARC: `TXT` record `_dmarc` met `v=DMARC1; p=quarantine; rua=mailto:<jouw adres>`
  (start met `quarantine`, niet meteen `reject`)

DNS-wijzigingen kunnen uren duren om overal door te komen.

## 3. Supabase-project (Frankfurt)

- Maak een nieuw project in de regio **Frankfurt (eu-central-1)**.
- Auth → URL Configuration: site URL `https://cloxa.app`, redirect URLs
  `https://cloxa.app/**`. Zet **signups uit** (Cloxa nodigt gebruikers zelf uit).
- Auth → zet de OTP/magic-link geldigheidsduur kort (bv. 10 minuten).
- Auth → Email Templates: plak de sjablonen uit `supabase/templates/*.html`.
- Auth → SMTP: vul de Hostinger SMTP-gegevens in (host, poort 465/587, gebruikersnaam,
  wachtwoord, afzenderadres op `cloxa.app`).
- Auth → zet **MFA (TOTP)** aan voor de organisatie.
- Settings → Database → Network Restrictions: beperk tot de VPS (en je eigen IP voor
  beheer), als het plan dat toelaat.
- Settings → Database → SSL: forceer SSL-only connecties.

## 4. `.env.production` op de server

- Kopieer `deploy/env.production.example` naar `~/cloxa/.env.production` op de VPS (als
  de `cloxa`-gebruiker, niet root).
- Vul elke waarde in; genereer de geheimen zoals in de comments beschreven
  (`openssl rand -base64 48` voor `AUTH_HASH_PEPPER` en `FLOW_COOKIE_SECRET`, de
  node-eenregelaar voor `EXPORT_SIGNING_KEY`).
- `chmod 600 ~/cloxa/.env.production` — dit bestand nooit committen.
- Zet ook `deploy/docker-compose.yml` en `deploy/Caddyfile` op de server, in dezelfde
  map (`~/cloxa/deploy/`).
- Wil je een mail bij elke nieuwe pilotaanvraag? Vul dan alle zes de `SMTP_*`/
  `OPERATOR_EMAIL`-variabelen in (Hostinger SMTP). Zonder worden aanvragen alleen
  opgeslagen. De aanvrager krijgt nooit automatisch een mail.

## 5. GitHub secrets en environment

Onder repository Settings:

- **Secrets** (Settings → Secrets and variables → Actions → Secrets):
  `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`, `VPS_HOST`,
  `VPS_USER`, `VPS_SSH_KEY` (privésleutel, alleen voor deploys), `VPS_KNOWN_HOSTS`
  (uitvoer van `ssh-keyscan <vps-ip>` vooraf gecontroleerd).
- **Variables** (zelfde scherm, tab Variables — geen geheimen, publieke waarden):
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `CLOXA_SITE_URL=https://cloxa.app`.
- **Environment** `production` (Settings → Environments): voeg minstens één verplichte
  reviewer toe. Zonder goedkeuring draait `supabase db push` niet.

## 6. Eerste deploy

- Tag een release: `git tag v0.1.0 && git push origin v0.1.0` — of start de workflow
  handmatig (Actions → Deploy → Run workflow).
- De workflow bouwt en pusht de image naar GHCR, wacht op goedkeuring, past de migraties
  toe, en deployt daarna over SSH.
- Volg de run in de Actions-tab. Na afloop: check `https://cloxa.app/healthz`.

## 7. Rollback

- Automatisch: als de healthcheck na een deploy faalt, zet de workflow zelf de vorige
  tag terug.
- Handmatig: op de VPS,
  `cd ~/cloxa && TAG=<vorige-tag> docker compose -f deploy/docker-compose.yml up -d`.

## 8. Logs

- App: `docker compose -f ~/cloxa/deploy/docker-compose.yml logs app`
- Caddy (toegang, zonder IP's/query strings/cookies): `~/cloxa/data/access.log` op de
  server (via het `caddy_data`-volume), of `docker compose logs caddy`.

## 9. Go-live checklist

- [ ] Supabase-project geüpgraded naar **Pro** vóór er echte personeelsdata in komt
- [ ] Een backup-restore geoefend (Supabase → Database → Backups)
- [ ] `securityheaders.com` en SSL Labs (`ssllabs.com/ssltest`) beide op A/A+
- [ ] `https://cloxa.app/.well-known/cloxa-export-keys.json` geeft de juiste publieke
      sleutel terug
- [ ] Pas **daarna, en alleen als je zeker bent**: HSTS preload aanvragen
      (`hstspreload.org`) — dit is moeilijk terug te draaien

## 10. Een klant activeren

Zelf aanmelden staat uit: bedrijven vragen een pilot aan op `cloxa.app/aanvragen` en jij
zet ze klaar met de operator-CLI. Er is bewust geen web-beheerpaneel.

1. **Bekijk de aanvragen:** `pnpm ops requests`. Ze blijven 12 maanden bewaard en worden
   dan automatisch verwijderd.
2. **Controleer de aanvrager** (bel of mail zelf, zoek het ondernemingsnummer op).
3. **Wijs af of activeer.** Voor productie zet je de gegevens in een bestand buiten git,
   bv. `.env.ops` in de hoofdmap (alle `.env.*` staan in `.gitignore`), met
   `NEXT_PUBLIC_SUPABASE_URL` en `SUPABASE_SECRET_KEY` van het productieproject.
   - Eerst zonder `--confirm`: het commando toont wat het gaat doen en wijzigt niets.
   - Activeren:
     `pnpm ops activate <aanvraag-id> --site "Naam van de eerste locatie" --confirm --env-file ../../.env.ops`
     (het pad is relatief aan `apps/web`; `--site` mag weg, dan heet de locatie zoals
     het bedrijf).
   - Afwijzen: `pnpm ops reject <aanvraag-id> --confirm --env-file ../../.env.ops`.
4. Voor iets anders dan je lokale stack toont het commando de host en vraagt het je die
   over te typen. Zo activeer je nooit per ongeluk op het verkeerde project.
5. Bij activeren maakt het commando de organisatie en de eerste locatie aan, nodigt het
   de contactpersoon per e-mail uit (Nederlandstalige uitnodiging) en maakt die
   eigenaar. Heeft dat e-mailadres al een login, dan krijgt die persoon geen nieuwe
   uitnodiging maar logt hij in met een e-mailcode. Bij de eerste keer stelt de eigenaar
   zijn beveiligingsapp in.

De sleutel wordt nooit getoond. Bewaar het `.env.ops`-bestand veilig en gebruik het
alleen op je eigen machine.

## Wat nog ontbreekt

- De retentie-purge job (data ouder dan de wettelijke bewaartermijn automatisch
  anonimiseren) — nog te bouwen.
- Monitoring/alerting (uptime, foutmeldingen) — nu alleen de Docker healthcheck.
- Een externe pentest, voordat er echte klantdata op staat.
