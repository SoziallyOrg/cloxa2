/**
 * The shape of a clock fact, as appended to `clock_events`. Timestamps are
 * epoch milliseconds: callers convert from/to ISO or Date at the I/O
 * boundary, never inside this package.
 */

export type ClockEventType =
  "clock_in" | "clock_out" | "break_start" | "break_end" | "void";

export type ClockEventSource = "app" | "kiosk" | "mobile" | "correction";

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
}
