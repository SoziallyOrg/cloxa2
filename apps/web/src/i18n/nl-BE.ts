export const nlBE = {
  brand: {
    name: "Cloxa",
    descriptor: "Werkuren met een zichtbaar correctiespoor",
  },
  navigation: {
    home: "Start",
    login: "Aanmelden",
    workspace: "Werkruimte",
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
      "Start en stop je werk op deze werkplek. Tijdstippen komen rechtstreeks van de beveiligde databank.",
    status: "Aangemeld",
  },
  breaks: {
    onBreak: "Je bent met pauze",
    start: "Start pauze",
    end: "Beëindig pauze",
    started: "Pauze gestart.",
    ended: "Pauze beëindigd.",
    blockers: {
      no_open_shift: "Je hebt geen open werkregistratie. Je overzicht is bijgewerkt.",
      already_on_break: "Je was al met pauze. Je overzicht is bijgewerkt.",
      no_open_break: "Je hebt geen open pauze. Je overzicht is bijgewerkt.",
      invalid_interval: "Dit pauzetijdstip kan niet worden verwerkt. Probeer opnieuw.",
    },
    interlock: "Beëindig eerst je pauze om het werk te stoppen.",
    failure: "Pauze kon niet worden verwerkt. Vernieuw de pagina en probeer opnieuw.",
    summary: "Onbetaalde pauzes",
    gross: "Bruto",
    completed: "Afgeronde pauzes",
    net: "Netto gewerkt",
    open: "Nog open",
    conflict: "Het voorgestelde tijdvak moet alle geregistreerde pauzes bevatten.",
    help: "Alleen live start en einde. Dit zijn feitelijke onbetaalde intervallen, geen wettelijke rust- of loonberekening.",
  },
  timeClock: {
    working: "Je bent aan het werk",
    notWorking: "Je bent niet aan het werk",
    startedAt: "Gestart om",
    start: "Start werk",
    stop: "Stop werk",
    pending: "Registratie verwerken…",
    startSuccess: "Werk gestart.",
    alreadyWorking: "Je was al aan het werk. De huidige registratie blijft behouden.",
    stopSuccess: "Werk gestopt.",
    alreadyStopped: "Je was al gestopt. Er is niets gewijzigd.",
    failure: "Tijdregistratie is niet gelukt. Probeer opnieuw.",
    loadFailure: "Je tijdregistratie kon niet worden geladen.",
    retry: "Opnieuw proberen",
    today: "Registraties van vandaag",
    empty: "Vandaag zijn er nog geen registraties.",
    current: "Bezig",
    completed: "Afgerond",
    duration: "Duur",
  },
  corrections: {
    title: "Correcties",
    description:
      "Vraag een aanpassing aan of meld een ontbrekende registratie. Je oorspronkelijke tijdregistratie blijft ongewijzigd.",
    openCorrections: "Correctie aanvragen",
    backToClock: "Terug naar tijdklok",
    reportMissed: "Ontbrekende registratie melden",
    closedEntries: "Recente afgeronde registraties",
    closedEntriesHelp:
      "Kies een registratie om andere begin- of eindtijdstippen voor te stellen.",
    noClosedEntries: "Er zijn nog geen afgeronde registraties om te corrigeren.",
    requestCorrection: "Correctie aanvragen",
    adjustment: "Aanpassing van registratie",
    missedEntry: "Ontbrekende registratie",
    formHelp:
      "Vul Brusselse lokale tijd in. Je voorstel wordt pas een feitelijke registratie na latere beoordeling door een manager.",
    startLabel: "Voorgestelde start",
    endLabel: "Voorgesteld einde",
    timeHelp:
      "Gebruik dd/mm/jjjj uu:mm in Europe/Brussels. Ingevulde seconden blijven behouden; je mag ze aanpassen. Niet-bestaande lentetijden worden geweigerd.",
    dstLegend: "Herhaald herfstuur",
    startOccurrence: "Starttijd komt voor de",
    endOccurrence: "Eindtijd komt voor de",
    occurrenceNotNeeded: "Niet van toepassing",
    occurrenceEarlier: "Eerste keer (zomertijd)",
    occurrenceLater: "Tweede keer (wintertijd)",
    reasonLabel: "Reden",
    reasonHelp: "Verplicht, maximaal 500 tekens.",
    cancel: "Formulier sluiten",
    submit: "Aanvraag indienen",
    submitting: "Aanvraag indienen…",
    submissionSuccess: "Correctieaanvraag ingediend.",
    failure:
      "Correctieaanvraag is niet gelukt. Controleer je invoer en probeer opnieuw.",
    loadFailure: "Je correctieaanvragen konden niet worden geladen.",
    retry: "Opnieuw proberen",
    myRequests: "Mijn aanvragen",
    myRequestsHelp: "Ingediende aanvragen blijven zichtbaar met hun huidige status.",
    noRequests: "Je hebt nog geen correctieaanvragen.",
    withdraw: "Aanvraag intrekken",
    withdrawing: "Aanvraag intrekken…",
    withdrawSuccess: "Correctieaanvraag ingetrokken.",
    alreadyWithdrawn: "Correctieaanvraag was al ingetrokken.",
    withdrawFailure: "Intrekken is niet gelukt. Vernieuw de pagina en probeer opnieuw.",
    status: {
      pending: "In afwachting",
      withdrawn: "Ingetrokken",
      approved: "Goedgekeurd",
      rejected: "Afgewezen",
    },
    validation: {
      form: "Controleer alle ingevulde velden.",
      reason: "Vul een reden van maximaal 500 tekens in.",
      interval: "Het einde moet na de start liggen.",
      past: "Start en einde moeten volledig in het verleden liggen.",
      unchanged: "Wijzig minstens het begin- of eindtijdstip.",
      factualOverlap: "Dit voorstel overlapt een bestaande tijdregistratie.",
      pendingConflict: "Dit voorstel overlapt een aanvraag die nog in afwachting is.",
      target: "Deze afgeronde registratie kan niet worden gecorrigeerd.",
      nonexistentTime:
        "Dit lokale tijdstip bestaat niet door de omschakeling naar zomertijd.",
      ambiguousTime:
        "Dit lokale tijdstip komt tweemaal voor. Kies expliciet de eerste of tweede keer.",
    },
  },
  manager: {
    title: "Manager",
    description:
      "Beoordeel correctieaanvragen van je medewerkers en nodig medewerkers uit.",
    status: "Aangemeld",
  },
  managerMfa: {
    setupTitle: "Authenticator instellen",
    setupDescription:
      "Beveilig je managerwerkruimte met een code uit je authenticator-app.",
    setupHelp:
      "Start de instelling, scan daarna de QR-code en bevestig met de zescijferige code uit je app.",
    startSetup: "Authenticator instellen",
    enrollmentReady: "Scan de QR-code en bevestig daarna je actuele code.",
    qrAlt: "QR-code voor authenticator-app",
    manualHelp: "Kun je niet scannen? Voer deze sleutel handmatig in:",
    codeLabel: "Authenticatorcode",
    codeHelp: "Vul de actuele zescijferige code in.",
    completeSetup: "Instelling bevestigen",
    verifyTitle: "Authenticatorcode controleren",
    verifyDescription:
      "Vul de actuele code uit je geregistreerde authenticator-app in om verder te gaan.",
    verifySubmit: "Code controleren",
    recoveryTitle: "Herstel door beheerder nodig",
    recoveryDescription:
      "Je geregistreerde authenticator is niet meer bruikbaar. Managergegevens blijven geblokkeerd.",
    recoveryHelp:
      "Automatisch of zelf herstellen is niet mogelijk. Een vertrouwde lokale beheerder moet voor deze fictieve ontwikkelaccount een herstelvenster openen. Productieherstel en identiteitscontrole zijn niet beschikbaar.",
    recoveryWindowHelp:
      "Een lokale beheerder heeft een herstelvenster van 15 minuten geopend. Stel een vervangende authenticator in. Managergegevens blijven geblokkeerd tot de lokale beheerder exact deze kandidaat goedkeurt.",
    recoveryActiveHelp:
      "Start de native instelling, scan de QR-code en bevestig de actuele code. Dit geeft nog geen toegang tot managergegevens.",
    recoveryStartEnrollment: "Vervangende authenticator instellen",
    recoveryEnrollmentReady:
      "Scan de QR-code en bevestig daarna je actuele code. Deel de sleutel of code met niemand.",
    recoveryAwaitingOperator:
      "De vervangende authenticator is gecontroleerd. Toegang blijft geblokkeerd tot een lokale beheerder exact deze kandidaat goedkeurt.",
    recoveryCandidateLabel: "Niet-geheime kandidaatreferentie voor lokale beheerder:",
    recoveryExpiredHelp:
      "Het herstelvenster is verlopen. Toegang blijft geblokkeerd. Een lokale beheerder moet een nieuwe herstelcase starten.",
    recoveryFreshLoginHelp:
      "De vervangende authenticator is goedgekeurd. Meld je af en daarna opnieuw aan. Controleer vervolgens de nieuwe authenticatorcode om managergegevens te openen.",
    passwordRecoveryVerifyHelp:
      "Controleer eerst je geregistreerde authenticatorcode. Daarna kun je het wachtwoord wijzigen. Een wachtwoordlink vervangt of verwijdert je authenticator niet.",
    passwordRecoveryBlocked:
      "Je geregistreerde authenticator is niet bruikbaar. De wachtwoordlink kan MFA niet herstellen. Managergegevens en wachtwoordwijziging blijven geblokkeerd tot het afzonderlijke lokale herstel is afgerond.",
    genericFailure:
      "De code kon niet worden gecontroleerd. Controleer de code en probeer later opnieuw.",
  },
  managerCorrections: {
    title: "Correcties beoordelen",
    description:
      "Beoordeel het voorstel van je medewerker. Goedkeuren past de tijdregistratie aan; de oorspronkelijke gegevens blijven bewaard.",
    back: "Terug naar manager",
    pending: "In afwachting",
    history: "Eerdere aanvragen",
    historyHelp: "De 50 meest recente afgehandelde en ingetrokken aanvragen.",
    empty: "Er zijn geen aanvragen in afwachting.",
    noHistory: "Er zijn nog geen eerdere aanvragen.",
    employeeFallback: "Medewerker zonder weergavenaam",
    codeFallback: "Geen medewerkerscode",
    original: "Oorspronkelijke registratie",
    proposal: "Voorstel van medewerker",
    noOriginal: "Gemiste registratie: er is nog geen feitelijke registratie.",
    reason: "Reden van medewerker",
    submitted: "Ingediend op",
    resolved: "Beslist op",
    note: "Toelichting van manager",
    approve: "Goedkeuren",
    reject: "Afwijzen",
    confirmTitle: "Voorstel goedkeuren?",
    confirmHelp:
      "Je past deze exacte start en dit exacte einde toe op de tijdregistratie. Deze beslissing is definitief.",
    confirmApprove: "Goedkeuren en toepassen",
    rejectTitle: "Aanvraag afwijzen",
    rejectHelp:
      "Leg uit waarom je de aanvraag afwijst. De medewerker ziet je toelichting. De tijdregistratie verandert niet.",
    confirmReject: "Afwijzing bevestigen",
    optionalNote: "Toelichting (optioneel)",
    requiredNote: "Reden van afwijzing",
    noteHelp: "Maximaal 500 tekens. Deze toelichting is zichtbaar voor de medewerker.",
    noteValidation:
      "Vul een toelichting van maximaal 500 tekens in. Bij afwijzing is een reden verplicht.",
    cancel: "Annuleren",
    working: "Beslissing opslaan…",
    approved: "Aanvraag goedgekeurd. De tijdregistratie is aangepast.",
    rejected: "Aanvraag afgewezen. De tijdregistratie is ongewijzigd.",
    failure:
      "De beslissing kon niet worden verwerkt. Probeer opnieuw of herlaad de pagina.",
    loadFailure:
      "De correctieaanvragen konden niet worden geladen. Herlaad de pagina om opnieuw te proberen.",
    reload: "Pagina herladen",
    stale:
      "De oorspronkelijke registratie is intussen gewijzigd. Er is niets toegepast. Wijs deze aanvraag af en vraag om een nieuw voorstel.",
    overlap:
      "Het voorstel overlapt nu een bestaande tijdregistratie. Er is niets toegepast. Wijs de aanvraag af en vraag om een nieuw voorstel.",
    invalidInterval:
      "Het voorstel is geen geldige afgesloten periode in het verleden. Er is niets toegepast.",
    unavailable:
      "Deze aanvraag kan momenteel niet worden toegepast. Controleer de toegang van de medewerker en de werkplek.",
    alreadyDecided:
      "Deze aanvraag is al afgehandeld of ingetrokken. De actuele status is opnieuw geladen.",
    timezone:
      "Alle tijden: Europe/Brussels. De UTC-offset onderscheidt herhaalde wintertijduren.",
  },
  managerExports: {
    title: "Tijdregistraties exporteren",
    open: "Exports openen",
    description:
      "Bekijk feiten en blokkeringen, bevestig daarna een vaste momentopname voor CSV of JSON.",
    back: "Terug naar manager",
    periodHelp:
      "Kies maximaal 31 Brusselse kalenderdagen. Een afgesloten registratie hoort bij de periode waarin haar lokale startdatum valt; een nachtregistratie blijft volledig in die ene periode.",
    startLabel: "Startdatum (inclusief)",
    endLabel: "Einddatum (inclusief)",
    preview: "Voorbeeld controleren",
    previewing: "Voorbeeld laden…",
    previewReady: "Voorbeeld bijgewerkt. Controleer aantallen en meldingen.",
    previewFailure:
      "Het exportvoorbeeld kon niet worden geladen. Controleer de periode en probeer opnieuw.",
    invalidPeriod:
      "Kies een geldige periode van maximaal 31 dagen die niet in de toekomst eindigt.",
    previewTitle: "Feiten op dit moment",
    previewRecords: "Bekijk feitelijke registraties en versies",
    previewRecordsHelp:
      "Dit voorbeeld is een momentopname. Bij bevestiging controleert de databank opnieuw alle feiten en blokkeringen en legt zij de dan geldende versies vast.",
    missingName: "Naam ontbreekt",
    missingCode: "Personeelscode ontbreekt",
    sourceVersion: "Bronregistratie / versie",
    factualInterval: "Volledig interval (Brussel)",
    factualOrigin: "Feitelijke oorsprong",
    originClock: "Klokregistratie",
    originMissed: "Goedgekeurde ontbrekende registratie",
    lastCorrection: "Laatste correctie",
    records: "Registraties",
    employees: "Medewerkers",
    total: "Exacte totale duur",
    utcWindow: "UTC-selectievenster (einde exclusief):",
    blockersTitle: "Bevestigen is nu niet mogelijk",
    warningsTitle: "Let op",
    blockers: {
      breakDataRequiresV2:
        "Deze selectie bevat pauzes. Export met pauzegegevens is nog niet beschikbaar; hiervoor is een afzonderlijk beoordeelde v2 nodig.",
      noRecords: "Deze periode bevat geen geschikte afgesloten registraties.",
      openEntry: "Een open registratie overlapt deze periode.",
      pendingCorrection:
        "Een correctie in afwachting raakt een geselecteerd feit of deze periode.",
      rowLimit: "Deze selectie overschrijdt de grens van 10.000 registraties.",
      artifactTooLarge: "Deze selectie overschrijdt de veilige bestandsgrootte.",
    },
    warnings: {
      missingEmployeeCode:
        "Minstens één registratie heeft geen medewerkerscode; het veld blijft leeg.",
      missingDisplayName:
        "Minstens één registratie heeft geen weergavenaam; het veld blijft leeg.",
    },
    openCorrections: "Open correcties",
    confirm: "Deze momentopname bevestigen",
    confirmTitle: "Exacte momentopname bevestigen?",
    confirmHelp:
      "Je bevestigt exact de feitelijke versies die de databank opnieuw selecteert. Deze momentopname blijft vast. Een latere correctie vraagt een nieuwe export.",
    confirmCreate: "Momentopname maken",
    creating: "Momentopname maken…",
    cancel: "Annuleren",
    created: "Exportmomentopname gemaakt. CSV en JSON zijn nu beschikbaar.",
    createFailure:
      "De export kon niet worden bevestigd. Controleer het nieuwe voorbeeld en probeer opnieuw.",
    readyTitle: "Export beschikbaar",
    readyHelp:
      "Beide bestanden komen uit dezelfde vaste momentopname en delen dezelfde gegevenshash.",
    downloadCsv: "CSV downloaden",
    downloadJson: "JSON downloaden",
    historyTitle: "Recente exports",
    historyHelp: "De 20 meest recente bevestigde momentopnamen.",
    historyFailure: "De exportgeschiedenis kon niet worden geladen.",
    noHistory: "Er zijn nog geen bevestigde exports.",
    period: "Periode",
    createdAt: "Gemaakt op",
    counts: "Registraties · medewerkers",
    schema: "Schema",
    datasetHash: "SHA-256 van canonieke gegevens",
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
