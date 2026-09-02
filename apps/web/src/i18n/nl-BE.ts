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
    acceptInvitationTitle: "Uitnodiging aanvaarden",
    resetPasswordTitle: "Nieuw wachtwoord instellen",
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
    description: "Meld je aan met het e-mailadres waarmee je bent uitgenodigd.",
    forgotPassword: "Wachtwoord vergeten?",
    invitationHelp: "Een uitnodiging ontvangen? Bekijk hoe registratie werkt.",
    invitationLink: "Registreren via uitnodiging",
  },
  signup: {
    title: "Registreren kan alleen via uitnodiging.",
    description:
      "Open de persoonlijke link in de uitnodigingsmail van je organisatie. Openbare registratie blijft uitgeschakeld.",
    noInvitation: "Geen uitnodiging? Neem contact op met je manager.",
    backToLogin: "Terug naar aanmelden",
  },
  forgotPassword: {
    title: "Wachtwoord herstellen",
    description:
      "Vul je e-mailadres in om een link voor een nieuw wachtwoord aan te vragen.",
    privacy:
      "Je krijgt dezelfde bevestiging, ook als er geen account bij het e-mailadres hoort.",
    backToLogin: "Terug naar aanmelden",
  },
  employee: {
    title: "Medewerker",
    description:
      "Hier komt de mobiele werkruimte voor tijdregistratie, handmatige invoer en eigen correctieverzoeken.",
    status: "Aangemeld",
  },
  manager: {
    title: "Manager",
    description:
      "Hier komt de werkruimte voor correctiebeoordeling, goedgekeurde export en wijzigingsgeschiedenis.",
    status: "Aangemeld",
  },
  auth: {
    email: "E-mailadres",
    password: "Wachtwoord",
    newPassword: "Nieuw wachtwoord",
    passwordConfirmation: "Herhaal nieuw wachtwoord",
    passwordHelp: "Gebruik 12 tot 128 tekens. Een lange, unieke wachtzin is geschikt.",
    loginSubmit: "Aanmelden",
    logout: "Afmelden",
    logoutFailure: "Afmelden is niet gelukt. Probeer opnieuw.",
    recoverySubmit: "Herstellink aanvragen",
    pending: "Even wachten…",
    invalidForm: "Controleer de ingevulde velden.",
    loginFailure:
      "Aanmelden lukt niet met deze gegevens. Controleer je e-mailadres en wachtwoord.",
    recoverySuccess:
      "Als dit e-mailadres bij een account hoort, ontvang je een e-mail met verdere stappen.",
    invitationSuccess:
      "Als uitnodigen mogelijk is, ontvangt de medewerker een e-mail. Controleer de lokale inbox.",
    invitationFailure:
      "De uitnodiging kon niet worden verwerkt. Probeer opnieuw of vraag hulp aan je manager.",
    invitationUnavailable:
      "Deze uitnodiging is niet beschikbaar. Ze kan verlopen, ingetrokken of al gebruikt zijn. Vraag je manager om hulp.",
    recoveryUnavailable:
      "Deze herstellink is niet beschikbaar. Vraag een nieuwe link aan om je wachtwoord te herstellen.",
    passwordFailure:
      "Het wachtwoord kon niet worden opgeslagen. Probeer opnieuw of vraag een nieuwe link aan.",
  },
  authValidation: {
    email: "Vul een geldig e-mailadres in.",
    password: "Gebruik een wachtwoord van 12 tot 128 tekens.",
    passwordConfirmation: "Vul tweemaal hetzelfde nieuwe wachtwoord in.",
    displayName: "Gebruik maximaal 100 tekens voor de weergavenaam.",
    employeeCode: "Gebruik maximaal 32 tekens voor de medewerkerscode.",
  },
  invitation: {
    title: "Medewerker uitnodigen",
    description:
      "Nodig een medewerker uit voor je eigen organisatie. De medewerker stelt via de e-mail een wachtwoord in.",
    email: "E-mailadres medewerker",
    displayName: "Weergavenaam (optioneel)",
    employeeCode: "Medewerkerscode (optioneel)",
    submit: "Uitnodiging versturen",
    localOnly:
      "Lokale testomgeving: gebruik alleen fictieve gegevens. E-mails blijven in de lokale Supabase-inbox.",
  },
  acceptInvitation: {
    title: "Uitnodiging aanvaarden",
    description:
      "Stel je wachtwoord in om de uitnodiging te aanvaarden en je medewerkersaccount te activeren.",
    submit: "Wachtwoord instellen",
  },
  resetPassword: {
    title: "Nieuw wachtwoord instellen",
    description:
      "Kies een nieuw wachtwoord voor je account. Andere sessies worden daarna afgemeld.",
    submit: "Wachtwoord opslaan",
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
      unsupported:
        "Je account is aan meerdere actieve organisaties gekoppeld. Deze situatie wordt nog niet ondersteund. Vraag je manager om hulp.",
    },
  },
  authCallback: {
    failureCode: "aanmelding-mislukt",
  },
} as const;

export type DutchMessages = typeof nlBE;
