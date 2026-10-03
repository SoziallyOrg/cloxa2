/**
 * The shape of a clock fact, as appended to `clock_events`. Timestamps are
 * epoch milliseconds: callers convert from/to ISO or Date at the I/O
 * boundary, never inside this package.
 */

export type ClockEventType =
  "clock_in" | "clock_out" | "break_start" | "break_end" | "void";

export type ClockEventSource = "app" | "kiosk" | "mobile" | "correction";

/** Telework module (ADR 008): where a shift is worked. Only on a clock_in. */
export type WorkLocation = "site" | "home";

export interface ClockEvent {
  readonly id: string;
  readonly type: ClockEventType;
  /** Epoch milliseconds the fact refers to. */
  readonly occurredAt: number;
  readonly employeeId: string;
  readonly siteId: string;
  readonly source: ClockEventSource;
  /** The event this one replaces. That event stops being effective. */
  readonly supersedesEventId?: string;
  readonly correctionId?: string;
  /**
   * Queued on the device while offline (ADR 006): occurredAt is the captured
   * device time, recorded later. Absent means false.
   */
  readonly offline?: boolean;
  /** Epoch milliseconds the server received it, when the caller loaded it. */
  readonly serverAt?: number;
  /** Only on a clock_in, and only when the organization asks (telework). */
  readonly workLocation?: WorkLocation;
}
