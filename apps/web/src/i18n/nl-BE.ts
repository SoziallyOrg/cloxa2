export const nlBE = {
  brand: {
    name: "Cloxa",
    descriptor: "Werkuren met een zichtbaar correctiespoor",
  },
  navigation: {
    home: "Start",
    login: "Aanmelden",
    mainLabel: "Hoofdnavigatie",
    skipToContent: "Ga naar de inhoud",
  },
  common: {
    backHome: "Terug naar start",
    foundationStatus: "Technische basis · geen productieomgeving",
    invitationOnly: "Alleen op uitnodiging",
    invitationRegistration: "Registreren via uitnodiging",
    openLogin: "Naar aanmelden",
  },
  metadata: {
    defaultDescription:
      "Cloxa bouwt aan een duidelijke registratie- en correctiestroom voor één klein Vlaams team.",
    defaultTitle: "Cloxa",
    forgotPasswordTitle: "Wachtwoord herstellen",
    loginTitle: "Aanmelden",
    signupTitle: "Registreren via uitnodiging",
  },
  manifest: {
    description:
      "Werkuren registreren, correcties beoordelen en goedgekeurde gegevens overdragen.",
    name: "Cloxa",
    shortName: "Cloxa",
  },
  home: {
    title: "Werkuren die correcties zichtbaar houden.",
    introduction:
      "Cloxa wordt gebouwd voor één Vlaamse organisatie, één werkplek en een team van 5 tot 20 medewerkers.",
    boundary:
      "Deze eerste versie zet alleen de veilige technische basis klaar. Tijdregistratie, goedkeuring en export volgen in afzonderlijke bouwstappen.",
    workflowTitle: "Van uitnodiging naar een controleerbaar bestand",
    workflowDescription:
      "Elke stap krijgt een duidelijke eigenaar. Een correctie vervangt later nooit stilletjes de vorige registratie.",
    workflow: [
      {
        title: "Uitnodigen en aanmelden",
        description: "De organisatie bepaalt wie toegang krijgt.",
      },
      {
        title: "Werkuren registreren",
        description: "De medewerker registreert feitelijke werkuren.",
      },
      {
        title: "Correctie beoordelen",
        description: "De manager ziet het verschil en neemt een besluit.",
      },
      {
        title: "Goedgekeurd exporteren",
        description: "Alleen goedgekeurde gegevens gaan naar CSV of JSON.",
      },
    ],
    scopeTitle: "Bewust klein gehouden",
    scopeItems: [
      "Nederlandstalige browserervaring",
      "Eén organisatie en één werkplek",
      "Geen loon- of overurenberekening",
      "Geen openbare registratie",
    ],
  },
  login: {
    title: "Aanmelden",
    description:
      "Aanmelden wordt aangesloten zodra uitnodigingen en het autorisatiemodel zijn uitgewerkt.",
    status: "Aanmeldformulier nog niet actief",
    forgotPassword: "Wachtwoord vergeten?",
    invitationHelp: "Een uitnodiging ontvangen? Bekijk hoe registratie werkt.",
    invitationLink: "Registreren via uitnodiging",
  },
  signup: {
    title: "Registreren kan alleen via uitnodiging.",
    description:
      "Open later de persoonlijke link in de uitnodigingsmail van je organisatie. Openbare registratie blijft uitgeschakeld.",
    noInvitation: "Geen uitnodiging? Neem contact op met je manager.",
    backToLogin: "Terug naar aanmelden",
  },
  forgotPassword: {
    title: "Wachtwoord herstellen",
    description:
      "Wachtwoordherstel wordt toegevoegd samen met de uitnodigings- en e-mailstroom.",
    privacy:
      "De uiteindelijke bevestiging zal nooit verklappen of een e-mailadres bestaat.",
    backToLogin: "Terug naar aanmelden",
  },
  employee: {
    title: "Medewerker",
    description:
      "Hier komt de mobiele werkruimte voor tijdregistratie, handmatige invoer en eigen correctieverzoeken.",
    status: "Werkruimte nog niet ingericht",
  },
  manager: {
    title: "Manager",
    description:
      "Hier komt de werkruimte voor correctiebeoordeling, goedgekeurde export en wijzigingsgeschiedenis.",
    status: "Werkruimte nog niet ingericht",
  },
  states: {
    loading: {
      title: "Pagina laden…",
      description: "De gevraagde inhoud wordt klaargezet.",
    },
    error: {
      title: "Deze pagina kon niet worden geladen.",
      description:
        "Probeer opnieuw. Blijft het probleem bestaan, ga dan terug naar start.",
      retry: "Opnieuw proberen",
    },
    notFound: {
      title: "Pagina niet gevonden",
      description: "Dit adres bestaat niet of is verplaatst.",
    },
    unauthorized: {
      title: "Geen toegang",
      description:
        "Je account heeft geen toegang tot deze werkruimte. Meld je aan met het juiste account of vraag je manager om hulp.",
    },
  },
  authCallback: {
    failureCode: "aanmelding-mislukt",
  },
} as const;

export type DutchMessages = typeof nlBE;
