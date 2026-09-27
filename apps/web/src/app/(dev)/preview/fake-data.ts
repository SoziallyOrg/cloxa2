/**
 * Static fake data for the `/preview` design page. Never imported outside
 * `(dev)`: nothing here is a real employee, shift or organisation.
 */
import type { Shift } from "@cloxa/domain";

import type { KioskEmployee } from "@/components/kiosk/KioskHome";
import type {
  TodayBoardAttentionItem,
  TodayBoardPerson,
} from "@/components/manage/TodayBoard";

// A fixed "today" (Brussels, CEST) so the preview renders the same every time.
const TODAY_08_02 = Date.UTC(2026, 8, 28, 6, 2, 0);
const YESTERDAY_08_00 = Date.UTC(2026, 8, 27, 6, 0, 0);
const YESTERDAY_16_30 = Date.UTC(2026, 8, 27, 14, 30, 0);

export const FAKE_NOW = Date.UTC(2026, 8, 28, 9, 14, 0);

export const FAKE_TODAY_SHIFTS: readonly Shift[] = [
  {
    start: TODAY_08_02,
    end: null,
    breaks: [],
    grossMs: FAKE_NOW - TODAY_08_02,
    breakMs: 0,
    netMs: FAKE_NOW - TODAY_08_02,
    open: true,
    openBreak: false,
    overnight: false,
    edited: false,
  },
];

export const FAKE_PAST_SHIFTS: readonly Shift[] = [
  {
    start: YESTERDAY_08_00,
    end: YESTERDAY_16_30,
    breaks: [
      {
        start: YESTERDAY_08_00 + 4 * 3_600_000,
        end: YESTERDAY_08_00 + 4.5 * 3_600_000,
      },
    ],
    grossMs: YESTERDAY_16_30 - YESTERDAY_08_00,
    breakMs: 30 * 60_000,
    netMs: YESTERDAY_16_30 - YESTERDAY_08_00 - 30 * 60_000,
    open: false,
    openBreak: false,
    overnight: false,
    edited: true,
  },
];

const FIRST_NAMES = [
  "Amina",
  "Bram",
  "Chiara",
  "Driss",
  "Els",
  "Farid",
  "Griet",
  "Hamid",
  "Ines",
  "Jonas",
  "Kato",
  "Liesbeth",
  "Mounir",
  "Nele",
  "Omar",
];

export const FAKE_KIOSK_EMPLOYEES: readonly KioskEmployee[] = FIRST_NAMES.map(
  (name, index) => ({
    id: `employee-${index + 1}`,
    name: `${name} Peeters`,
  }),
);

export const FAKE_TODAY_BOARD_COUNTERS = {
  working: 6,
  onBreak: 2,
  notStarted: 3,
  deviations: 1,
};

export const FAKE_TODAY_BOARD_PEOPLE: readonly TodayBoardPerson[] = [
  {
    id: "1",
    name: "Amina Peeters",
    tone: "working",
    statusLabel: "Aan het werk",
    sinceLabel: "sinds 08:02",
  },
  {
    id: "2",
    name: "Bram Peeters",
    tone: "break",
    statusLabel: "Met pauze",
    sinceLabel: "sinds 12:01",
  },
  {
    id: "3",
    name: "Chiara Peeters",
    tone: "off",
    statusLabel: "Niet aan het werk",
    sinceLabel: null,
  },
  {
    id: "4",
    name: "Driss Peeters",
    tone: "error",
    statusLabel: "Vergeten uit te klokken",
    sinceLabel: "sinds gisteren 16:30",
  },
];

export const FAKE_TODAY_BOARD_ATTENTION: readonly TodayBoardAttentionItem[] = [
  { id: "1", name: "Driss Peeters", reason: "Vergeten uit te klokken" },
];
