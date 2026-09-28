/**
 * The three numbers on top of Vandaag. Pure: the page reads the data and
 * hands one entry per person in here.
 */
export interface BoardPerson {
  /** The shift open right now (any start day), or `null`. */
  readonly open: { readonly onBreak: boolean } | null;
  /** Has a shift that started today (Brussels). */
  readonly clockedToday: boolean;
  /** Epoch ms of the first block planned to start today, or `null`. */
  readonly firstStartToday: number | null;
}

export interface BoardCounts {
  readonly working: number;
  readonly onBreak: number;
  readonly notStarted: number;
}

/**
 * Open shifts count as working or on break whatever day they began: a night
 * worker who started at 21:30 is simply working at 01:13. "Nog niet gestart"
 * is only someone whose planned start today has passed and who is neither
 * working nor has worked yet today.
 */
export function boardCounts(people: readonly BoardPerson[], now: number): BoardCounts {
  let working = 0;
  let onBreak = 0;
  let notStarted = 0;
  for (const person of people) {
    if (person.open) {
      if (person.open.onBreak) onBreak += 1;
      else working += 1;
    } else if (
      !person.clockedToday &&
      person.firstStartToday !== null &&
      person.firstStartToday <= now
    ) {
      notStarted += 1;
    }
  }
  return { working, onBreak, notStarted };
}
