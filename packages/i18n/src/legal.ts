/**
 * The legal pages (`/privacy`, `/voorwaarden`, `/verwerkersovereenkomst`) as
 * data, so the app renders them with one component. Plain Dutch (B1), "je".
 *
 * These are CONCEPT texts, not yet checked by a lawyer; every page shows that
 * at the top. Company details are `[in te vullen]` until the owner fills them
 * in. Facts about the law come from `docs/legal-notes.md` only.
 */

/** Shown wherever the owner still has to fill in company details. */
export const TO_FILL = "[in te vullen]";

export type LegalBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: readonly string[] }
  | { kind: "table"; head: readonly string[]; rows: readonly (readonly string[])[] };

export interface LegalSection {
  /** Anchor for the table of contents. */
  id: string;
  heading: string;
  blocks: readonly LegalBlock[];
}

export interface LegalDocument {
  title: string;
  /** ISO date, for the `<time>` element. */
  updatedIso: string;
  updatedLabel: string;
  intro: string;
  sections: readonly LegalSection[];
}

const UPDATED = {
  updatedIso: "2026-09-29",
  updatedLabel: "29 september 2026",
} as const;

const company = {
  name: `Bedrijfsnaam: ${TO_FILL}`,
  kbo: `Ondernemingsnummer (KBO): ${TO_FILL}`,
  address: `Adres: ${TO_FILL}`,
  email: `E-mailadres voor privacyvragen: ${TO_FILL}`,
} as const;

export const privacyDocument: LegalDocument = {
  title: "Privacyverklaring",
  ...UPDATED,
  intro:
    "Cloxa helpt werkgevers de werktijd van hun medewerkers te registreren. In deze tekst lees je welke persoonsgegevens we verwerken, waarom, hoelang we ze bewaren en welke rechten je hebt.",
  sections: [
    {
      id: "wie",
      heading: "Wie zijn wij?",
      blocks: [
        {
          kind: "list",
          items: [company.name, company.kbo, company.address, company.email],
        },
        {
          kind: "p",
          text: "In deze tekst betekent “Cloxa”, “wij” en “ons” het bedrijf hierboven.",
        },
      ],
    },
    {
      id: "rollen",
      heading: "Onze rol: verwerker of verantwoordelijke",
      blocks: [
        {
          kind: "p",
          text: "Onze rol hangt af van over wiens gegevens het gaat.",
        },
        {
          kind: "table",
          head: ["Gegevens van", "Onze rol", "Wie beslist over de gegevens?"],
          rows: [
            [
              "Medewerkers van een werkgever die Cloxa gebruikt",
              "Verwerker",
              "De werkgever is verantwoordelijke. Wij verwerken de gegevens alleen op zijn instructies, volgens de verwerkersovereenkomst.",
            ],
            ["Bezoekers van deze website", "Verantwoordelijke", "Wij."],
            [
              "Bedrijven en contactpersonen die een pilot aanvragen",
              "Verantwoordelijke",
              "Wij.",
            ],
          ],
        },
        {
          kind: "p",
          text: "Ben je medewerker en heb je een vraag over je uren of je rechten? Stel die dan eerst aan je werkgever. Wij helpen je werkgever om je vraag te beantwoorden.",
        },
      ],
    },
    {
      id: "gegevens",
      heading: "Welke gegevens verwerken we?",
      blocks: [
        {
          kind: "p",
          text: "Als je onze website bezoekt:",
        },
        {
          kind: "list",
          items: [
            "Technische gegevens die je browser meestuurt, zoals het IP-adres en de gevraagde pagina. We gebruiken die om de website te tonen en te beveiligen.",
            "Om misbruik te beperken bewaren we een afgeleide code van je IP-adres en e-mailadres (een hash, dus niet leesbaar) maximaal 24 uur.",
            "We gebruiken geen advertentie- of trackingcookies. Bij het inloggen gebruiken we cookies die nodig zijn om je aangemeld te houden.",
          ],
        },
        {
          kind: "p",
          text: "Als je een pilot aanvraagt:",
        },
        {
          kind: "list",
          items: [
            "Naam van het bedrijf, ondernemingsnummer, aantal medewerkers en sector.",
            "Je naam, je e-mailadres en, als je dat invult, je telefoonnummer.",
            "Je bericht, als je er een schrijft.",
            "Het moment waarop je toestemming gaf om contact met je op te nemen.",
          ],
        },
        {
          kind: "p",
          text: "Als een werkgever Cloxa gebruikt voor zijn medewerkers (wij zijn dan verwerker):",
        },
        {
          kind: "list",
          items: [
            "Naam, e-mailadres, rol en de locaties waaraan een medewerker is gekoppeld.",
            "Geplande uren en de echte registraties: starten, stoppen en pauzes. Daarbij bewaren we de tijd van onze server en, apart, de tijd die het toestel van de medewerker gaf.",
            "Correcties met de reden die de medewerker of leidinggevende opgaf.",
            "Een logboek van wat er in de organisatie gebeurde, zoals wie een correctie goedkeurde.",
            "Een persoonlijke code voor de kiosk. Die bewaren we niet leesbaar, alleen in een afgeleide vorm.",
            "Gegevens van optionele onderdelen die de werkgever aanzet, bijvoorbeeld het statuut van een student of een interim-medewerker.",
            "Als de werkgever dat aanzet: bij het starten geeft de medewerker aan of hij op de locatie of thuis werkt.",
          ],
        },
      ],
    },
    {
      id: "biometrie",
      heading: "Geen biometrie en geen volgen van locatie",
      blocks: [
        {
          kind: "list",
          items: [
            "We gebruiken nooit vingerafdrukken, gezichtsherkenning of andere biometrische gegevens.",
            "We houden geen GPS-locatie bij en volgen niemand. De enige “locatie” is de keuze tussen “op locatie” of “thuis” bij het starten, en alleen als de werkgever dat aanzet.",
          ],
        },
      ],
    },
    {
      id: "doelen",
      heading: "Waarom mogen we dit verwerken?",
      blocks: [
        {
          kind: "table",
          head: ["Doel", "Rechtsgrond"],
          rows: [
            [
              "Je pilotaanvraag bekijken en contact met je opnemen",
              "Je toestemming (art. 6.1.a AVG). Je kunt die altijd intrekken.",
            ],
            [
              "De website tonen en beveiligen, en misbruik tegengaan (bijvoorbeeld te veel aanvragen of pogingen om in te loggen)",
              "Ons gerechtvaardigd belang om de dienst veilig te houden (art. 6.1.f AVG).",
            ],
            [
              "Werktijd registreren voor een werkgever",
              "Wij handelen op instructie van de werkgever. De werkgever kiest zelf zijn rechtsgrond, bijvoorbeeld een wettelijke verplichting waar registratie verplicht is, of de uitvoering van de arbeidsovereenkomst.",
            ],
          ],
        },
        {
          kind: "p",
          text: "We nemen geen beslissingen over mensen die alleen door een computer worden genomen. Cloxa toont uren en tellers als feitelijke registratie. Het berekent geen loon.",
        },
      ],
    },
    {
      id: "bewaartermijn",
      heading: "Hoelang bewaren we gegevens?",
      blocks: [
        {
          kind: "table",
          head: ["Gegevens", "Bewaartermijn"],
          rows: [
            [
              "Pilotaanvragen",
              "12 maanden na de aanvraag. Daarna worden ze automatisch verwijderd.",
            ],
            ["Afgeleide codes tegen misbruik", "Maximaal 24 uur."],
            [
              "Tijdsregistraties en de bijbehorende logboeken",
              "Minstens 5 jaar. Daarna maken we de persoonsgegevens anoniem. De werkgever kan een langere termijn instellen.",
            ],
            [
              "Gegevens van een medewerker die uit dienst is",
              "Zolang de bewaartermijn van de registraties loopt. Daarna maken we de identiteit anoniem: de uren blijven, de naam verdwijnt.",
            ],
          ],
        },
      ],
    },
    {
      id: "ontvangers",
      heading: "Wie helpt ons bij de verwerking?",
      blocks: [
        {
          kind: "p",
          text: "We werken met deze partijen (onderverwerkers). We verkopen geen gegevens en gebruiken ze niet voor reclame.",
        },
        {
          kind: "table",
          head: ["Partij", "Waarvoor", "Waar"],
          rows: [
            ["Supabase", "De database en het inloggen", "EU (Frankfurt)"],
            [
              "Hostinger (server)",
              "De server waarop de website en de app draaien",
              "Datacenter in de EU",
            ],
            [
              "Hostinger (e-mail)",
              "E-mails verzenden, zoals inlogcodes, uitnodigingen en een melding aan ons bij een nieuwe pilotaanvraag",
              `EU ${TO_FILL}`,
            ],
            [
              "Cloudflare Turnstile",
              "Nagaan of een formulier door een persoon wordt ingevuld. We gebruiken dit alleen als we het inschakelen. Cloudflare kan dan je IP-adres en browsergegevens verwerken.",
              `${TO_FILL} (locatie controleren)`,
            ],
          ],
        },
        {
          kind: "p",
          text: "We bewaren gegevens in de EU. Als een partij gegevens buiten de EU zou verwerken, zorgen we voor een geldig doorgiftemechanisme en vermelden we dat hier.",
        },
      ],
    },
    {
      id: "beveiliging",
      heading: "Hoe beveiligen we gegevens?",
      blocks: [
        {
          kind: "list",
          items: [
            "Al het verkeer loopt via een beveiligde verbinding (HTTPS).",
            "Elke organisatie ziet alleen haar eigen gegevens.",
            "Leidinggevenden en beheerders moeten inloggen met een tweede stap (een beveiligingsapp of passkey).",
            "Correcties komen bij de registraties, ze vervangen niets. Zo blijft zichtbaar wat er gebeurde.",
          ],
        },
        {
          kind: "p",
          text: "Geen enkel systeem is helemaal veilig. Merk je iets vreemds op, laat het ons dan meteen weten.",
        },
      ],
    },
    {
      id: "rechten",
      heading: "Jouw rechten",
      blocks: [
        {
          kind: "p",
          text: "Je hebt het recht om:",
        },
        {
          kind: "list",
          items: [
            "te weten welke gegevens we van je hebben en een kopie te krijgen;",
            "fouten te laten verbeteren;",
            "gegevens te laten verwijderen of de verwerking te laten beperken, als de wet dat toelaat;",
            "bezwaar te maken tegen verwerking op basis van ons gerechtvaardigd belang;",
            "je gegevens mee te nemen in een gangbaar bestand, waar dat van toepassing is;",
            "je toestemming in te trekken. Dat heeft geen gevolgen voor wat we eerder deden.",
          ],
        },
        {
          kind: "p",
          text: "Gaat het over je uren als medewerker? Vraag het dan aan je werkgever. Gaat het over je website-bezoek of pilotaanvraag? Mail ons via het adres onderaan. We antwoorden binnen een maand.",
        },
        {
          kind: "p",
          text: "Ben je niet tevreden over ons antwoord? Je kunt een klacht indienen bij de Gegevensbeschermingsautoriteit (GBA), via gegevensbeschermingsautoriteit.be.",
        },
      ],
    },
    {
      id: "contact",
      heading: "Contact",
      blocks: [
        {
          kind: "list",
          items: [company.name, company.kbo, company.address, company.email],
        },
      ],
    },
    {
      id: "wijzigingen",
      heading: "Wijzigingen",
      blocks: [
        {
          kind: "p",
          text: "We kunnen deze tekst aanpassen, bijvoorbeeld als we een nieuwe partij inschakelen. Bovenaan zie je wanneer hij het laatst is bijgewerkt.",
        },
      ],
    },
  ],
};

export const termsDocument: LegalDocument = {
  title: "Voorwaarden voor de pilot",
  ...UPDATED,
  intro:
    "Deze voorwaarden gelden voor bedrijven die Cloxa uitproberen in een pilot. Ze zijn bewust kort en eenvoudig.",
  sections: [
    {
      id: "wie",
      heading: "Wie zijn wij?",
      blocks: [
        {
          kind: "list",
          items: [company.name, company.kbo, company.address, company.email],
        },
        {
          kind: "p",
          text: "“Cloxa” is het bedrijf hierboven. “De klant” is het bedrijf dat de pilot aanvraagt.",
        },
      ],
    },
    {
      id: "pilot",
      heading: "Wat is de pilot?",
      blocks: [
        {
          kind: "list",
          items: [
            "Een pilot is een proefperiode waarin de klant Cloxa uitprobeert.",
            "De pilot is gratis. Willen we daarna een prijs vragen, dan spreken we die vooraf en schriftelijk af met de klant.",
            `De pilot duurt ${TO_FILL}, tenzij we iets anders afspreken.`,
            "Cloxa activeert een pilot handmatig, op aanvraag. Cloxa mag een aanvraag weigeren.",
          ],
        },
      ],
    },
    {
      id: "gebruik",
      heading: "Hoe gebruik je Cloxa?",
      blocks: [
        {
          kind: "list",
          items: [
            "De klant geeft juiste gegevens door en zorgt dat elke gebruiker zijn eigen account gebruikt.",
            "De klant gebruikt Cloxa niet voor iets wat de wet of deze voorwaarden niet toelaten, en probeert de beveiliging niet te omzeilen.",
            "De klant zorgt dat zijn medewerkers weten dat hun werktijd wordt geregistreerd.",
          ],
        },
      ],
    },
    {
      id: "geen-garantie",
      heading: "Geen garantie op beschikbaarheid",
      blocks: [
        {
          kind: "list",
          items: [
            "Voor de pilot geldt geen serviceniveau (geen SLA). We doen ons best, maar Cloxa kan soms niet beschikbaar zijn, bijvoorbeeld bij onderhoud of storingen.",
            "We bieden ondersteuning op redelijke wijze, zonder vaste reactietijd.",
            `Elke partij kan de pilot stoppen met een opzegtermijn van ${TO_FILL}.`,
          ],
        },
      ],
    },
    {
      id: "verantwoordelijkheid",
      heading: "De klant blijft verantwoordelijk voor de wet",
      blocks: [
        {
          kind: "list",
          items: [
            "Cloxa registreert feitelijk werktijd. Het geeft geen juridisch advies en berekent geen loon of andere gevolgen van uren.",
            "De klant blijft zelf verantwoordelijk voor zijn wettelijke verplichtingen als werkgever, zoals het bijhouden van de juiste registraties, het arbeidsreglement, de loonadministratie en de bescherming van persoonsgegevens.",
            "Cloxa vervangt Dimona niet, en ook Checkin@Work, CIAO en de GKS niet. De klant blijft die meldingen zelf doen.",
            "Een algemene verplichting om arbeidstijd te registreren is gepland, maar nog geen wet: het is een ontwerp. Cloxa garandeert dan ook niet dat het gebruik ervan aan alle wettelijke eisen voldoet, nu of later.",
            "Tellers en totalen in Cloxa zijn indicatief.",
          ],
        },
      ],
    },
    {
      id: "gegevens",
      heading: "Persoonsgegevens",
      blocks: [
        {
          kind: "list",
          items: [
            "De klant is verantwoordelijk voor de gegevens van zijn medewerkers. Cloxa verwerkt ze als verwerker, volgens de verwerkersovereenkomst.",
            "Voor de gegevens van bezoekers en van pilotaanvragen geldt de privacyverklaring.",
          ],
        },
      ],
    },
    {
      id: "einde",
      heading: "Als de pilot stopt",
      blocks: [
        {
          kind: "list",
          items: [
            "De klant kan zijn uren vooraf laten exporteren.",
            "Sommige registraties moet een werkgever een aantal jaren bewaren. Wil de klant die gegevens houden, dan exporteert en bewaart hij ze zelf.",
            `Na het einde van de pilot verwijderen of anonimiseren we de gegevens van de klant binnen ${TO_FILL}, tenzij we iets anders afspreken.`,
          ],
        },
      ],
    },
    {
      id: "aansprakelijkheid",
      heading: "Aansprakelijkheid",
      blocks: [
        {
          kind: "p",
          text: `Cloxa is alleen aansprakelijk voor schade zoals hier beschreven. ${TO_FILL} (een jurist bepaalt de precieze beperking).`,
        },
      ],
    },
    {
      id: "recht",
      heading: "Toepasselijk recht",
      blocks: [
        {
          kind: "p",
          text: `Op deze voorwaarden is Belgisch recht van toepassing. Bij een geschil zijn de rechtbanken van ${TO_FILL} bevoegd.`,
        },
      ],
    },
    {
      id: "contact",
      heading: "Contact",
      blocks: [
        {
          kind: "list",
          items: [company.name, company.kbo, company.address, company.email],
        },
      ],
    },
  ],
};

export const dpaDocument: LegalDocument = {
  title: "Verwerkersovereenkomst",
  ...UPDATED,
  intro:
    "Dit is een model van een verwerkersovereenkomst volgens artikel 28 van de AVG (GDPR). Ze geldt tussen de klant (de verwerkingsverantwoordelijke) en Cloxa (de verwerker), voor de gegevens van medewerkers die de klant in Cloxa registreert.",
  sections: [
    {
      id: "partijen",
      heading: "Partijen",
      blocks: [
        {
          kind: "list",
          items: [
            `De klant: ${TO_FILL} (naam, ondernemingsnummer, adres). Verwerkingsverantwoordelijke.`,
            `Cloxa: ${TO_FILL} (naam, ondernemingsnummer, adres). Verwerker.`,
          ],
        },
      ],
    },
    {
      id: "voorwerp",
      heading: "1. Voorwerp en duur",
      blocks: [
        {
          kind: "p",
          text: "Cloxa verwerkt persoonsgegevens voor de klant om werktijd te registreren, zoals beschreven in bijlage 1. Deze overeenkomst geldt zolang Cloxa gegevens van de klant verwerkt, ook tijdens een pilot.",
        },
      ],
    },
    {
      id: "instructies",
      heading: "2. Instructies van de klant",
      blocks: [
        {
          kind: "list",
          items: [
            "Cloxa verwerkt persoonsgegevens alleen op gedocumenteerde instructies van de klant. De instellingen die de klant in Cloxa kiest en deze overeenkomst zijn die instructies.",
            "Vindt Cloxa dat een instructie strijdig is met de AVG, dan meldt Cloxa dat aan de klant.",
            "De klant beslist zelf over de rechtsgrond en het doel van de verwerking, en informeert zijn medewerkers.",
          ],
        },
      ],
    },
    {
      id: "vertrouwelijkheid",
      heading: "3. Vertrouwelijkheid",
      blocks: [
        {
          kind: "p",
          text: "Wie bij Cloxa toegang heeft tot de gegevens, is gebonden aan vertrouwelijkheid en krijgt alleen toegang als dat nodig is.",
        },
      ],
    },
    {
      id: "beveiliging",
      heading: "4. Beveiliging",
      blocks: [
        {
          kind: "p",
          text: "Cloxa neemt passende technische en organisatorische maatregelen om de gegevens te beveiligen. Bijlage 2 geeft een overzicht.",
        },
      ],
    },
    {
      id: "onderverwerkers",
      heading: "5. Onderverwerkers",
      blocks: [
        {
          kind: "list",
          items: [
            "De klant geeft Cloxa algemene toestemming om de onderverwerkers uit bijlage 3 in te schakelen.",
            `Wil Cloxa een onderverwerker toevoegen of vervangen, dan verwittigt Cloxa de klant minstens ${TO_FILL} vooraf. De klant kan dan bezwaar maken.`,
            "Cloxa sluit met elke onderverwerker een overeenkomst met dezelfde verplichtingen als in deze overeenkomst, en blijft verantwoordelijk tegenover de klant.",
          ],
        },
      ],
    },
    {
      id: "rechten",
      heading: "6. Rechten van betrokkenen",
      blocks: [
        {
          kind: "p",
          text: "Cloxa helpt de klant, met passende middelen, om verzoeken van medewerkers te beantwoorden, zoals een vraag om inzage. Krijgt Cloxa zelf zo'n verzoek van een medewerker van de klant, dan stuurt Cloxa het door en beantwoordt het niet zelf.",
        },
      ],
    },
    {
      id: "bijstand",
      heading: "7. Bijstand bij andere verplichtingen",
      blocks: [
        {
          kind: "p",
          text: "Cloxa helpt de klant, rekening houdend met de aard van de verwerking, bij de beveiliging, bij het melden van datalekken en bij een gegevensbeschermingseffectbeoordeling (DPIA) als die nodig is.",
        },
      ],
    },
    {
      id: "datalekken",
      heading: "8. Datalekken",
      blocks: [
        {
          kind: "p",
          text: `Ontdekt Cloxa een inbreuk op de beveiliging van persoonsgegevens van de klant, dan verwittigt Cloxa de klant zonder onredelijke vertraging, en uiterlijk binnen ${TO_FILL}. Cloxa geeft de informatie die de klant nodig heeft om het lek te melden.`,
        },
      ],
    },
    {
      id: "doorgifte",
      heading: "9. Doorgifte buiten de EU",
      blocks: [
        {
          kind: "p",
          text: "Cloxa bewaart de gegevens in de EU. Cloxa geeft geen persoonsgegevens door buiten de EU zonder de klant te verwittigen en een geldig doorgiftemechanisme te gebruiken.",
        },
      ],
    },
    {
      id: "audit",
      heading: "10. Controle",
      blocks: [
        {
          kind: "p",
          text: `Cloxa geeft de klant de informatie die nodig is om aan te tonen dat Cloxa deze overeenkomst naleeft, en laat audits toe. Een audit wordt vooraf aangekondigd, minstens ${TO_FILL} op voorhand, en verstoort de dienst zo weinig mogelijk.`,
        },
      ],
    },
    {
      id: "einde",
      heading: "11. Einde van de verwerking",
      blocks: [
        {
          kind: "list",
          items: [
            "Na het einde van de dienst verwijdert of anonimiseert Cloxa de gegevens van de klant, of geeft ze terug in een gangbaar bestand. De klant kiest.",
            "Voor registraties die de klant als werkgever een aantal jaren moet bewaren, is de klant zelf verantwoordelijk om ze op te halen (te exporteren) en te bewaren.",
            "Cloxa mag gegevens langer bewaren als de wet dat vraagt.",
          ],
        },
      ],
    },
    {
      id: "recht",
      heading: "12. Aansprakelijkheid en recht",
      blocks: [
        {
          kind: "p",
          text: `Op deze overeenkomst is Belgisch recht van toepassing. Bij een geschil zijn de rechtbanken van ${TO_FILL} bevoegd. Voor aansprakelijkheid gelden de voorwaarden van de dienst. ${TO_FILL}`,
        },
      ],
    },
    {
      id: "bijlage-1",
      heading: "Bijlage 1: gegevens en betrokkenen",
      blocks: [
        {
          kind: "table",
          head: ["Onderdeel", "Beschrijving"],
          rows: [
            [
              "Doel",
              "Werktijd van medewerkers feitelijk registreren, plannen en exporteren.",
            ],
            [
              "Betrokkenen",
              "Medewerkers, leidinggevenden en beheerders van de klant, inclusief studenten, flexi-jobbers en interim-medewerkers als de klant die onderdelen gebruikt.",
            ],
            [
              "Soorten gegevens",
              "Naam, e-mailadres, rol, koppeling aan locaties, geplande uren, registraties (starten, stoppen, pauzes) met servertijd en toesteltijd, correcties met reden, logboek, kiosk-code (afgeleide vorm) en gegevens van optionele onderdelen. Geen biometrische gegevens en geen GPS-locatie.",
            ],
            [
              "Bewaartermijn",
              "Minstens 5 jaar, daarna anonimiseren. De klant kan een langere termijn instellen.",
            ],
          ],
        },
      ],
    },
    {
      id: "bijlage-2",
      heading: "Bijlage 2: beveiligingsmaatregelen",
      blocks: [
        {
          kind: "list",
          items: [
            "Beveiligde verbinding (HTTPS) voor al het verkeer.",
            "Gescheiden gegevens per organisatie, met toegangsregels in de database zelf.",
            "Inloggen met een e-mailcode of link, zonder wachtwoord. Leidinggevenden en beheerders hebben een tweede stap nodig.",
            "Beperking van pogingen om in te loggen.",
            "Registraties en logboek kunnen alleen aangevuld worden. Een correctie komt erbij en vervangt niets.",
            "Toegang van personeel van Cloxa tot klantgegevens alleen waar nodig.",
            "Beveiligde hosting in de EU met beperkte toegang tot de server.",
          ],
        },
      ],
    },
    {
      id: "bijlage-3",
      heading: "Bijlage 3: onderverwerkers",
      blocks: [
        {
          kind: "table",
          head: ["Onderverwerker", "Waarvoor", "Waar"],
          rows: [
            ["Supabase", "Database en inloggen", "EU (Frankfurt)"],
            [
              "Hostinger (server)",
              "Server voor de website en de app",
              "Datacenter in de EU",
            ],
            [
              "Hostinger (e-mail)",
              "E-mails zoals inlogcodes en uitnodigingen",
              `EU ${TO_FILL}`,
            ],
            [
              "Cloudflare Turnstile",
              "Controle op formulieren van bezoekers, alleen als dit is ingeschakeld. Geen gegevens van medewerkers.",
              `${TO_FILL} (locatie controleren)`,
            ],
          ],
        },
      ],
    },
    {
      id: "ondertekening",
      heading: "Ondertekening",
      blocks: [
        {
          kind: "p",
          text: `Datum en plaats: ${TO_FILL}. Handtekening van de klant: ${TO_FILL}. Handtekening van Cloxa: ${TO_FILL}.`,
        },
      ],
    },
  ],
};
