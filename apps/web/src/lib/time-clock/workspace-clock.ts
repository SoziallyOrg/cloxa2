import { initialTimeClockActionState, type TimeClockActionState } from "./model";
import { validTimestamp, exactMicroseconds } from "./breaks";
import type { WorkState } from "./work-status";

export type WorkSnapshot = WorkState & { serverTime: string };
export type ClockIntent = "clock_in" | "clock_out" | "start_break" | "end_break";
export type ClockLocation = "header" | "panel";
export const CLOCK_FRESH_MS = 30_000;
export const CLOCK_REFRESH_MS = 5_000;
export const CLOCK_READ_MS = 8_000;
export type WorkspaceClockState = {
  scope: string;
  clock: WorkSnapshot | null;
  phase: "loading" | "confirmed" | "unavailable";
  refreshing: boolean;
  pending: boolean;
  pendingIntent: ClockIntent | null;
  feedbackOwner: ClockLocation;
  feedbackVersion: number;
  signedOut: boolean;
  feedback: TimeClockActionState;
  retry: ClockIntent | null;
};
const allowed: Record<WorkState["status"], readonly ClockIntent[]> = {
  not_working: ["clock_in"],
  working: ["start_break", "clock_out"],
  on_break: ["end_break"],
};
const resulting: Record<ClockIntent, WorkState["status"]> = {
  clock_in: "working",
  clock_out: "not_working",
  start_break: "on_break",
  end_break: "working",
};

/** Instance-local coordinator. No browser storage or shared authenticated cache. */
export class WorkspaceClock {
  private state: WorkspaceClockState;
  private listeners = new Set<() => void>();
  private revision = 0;
  private confirmedAt = 0;
  private newest: WorkSnapshot | null = null;
  private expected: WorkState["status"] | null = null;
  private readTask: Promise<void> | null = null;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private operation: { intent: ClockIntent; id: string } | null = null;
  private running = false;
  private feedbackSequence = 0;
  private presentedFeedback = 0;
  feedbackWasPresented(version: number) {
    return version <= this.presentedFeedback;
  }
  markFeedbackPresented(version: number) {
    if (this.feedbackWasPresented(version)) return false;
    this.presentedFeedback = version;
    return true;
  }
  constructor(
    scope: string,
    private io: {
      read: (scope: string) => Promise<WorkSnapshot | null>;
      submit: (
        previous: TimeClockActionState,
        form: FormData,
        scope: string,
      ) => Promise<TimeClockActionState>;
      now?: () => number;
      uuid?: () => string;
    },
  ) {
    this.state = this.empty(scope);
  }
  private empty(scope: string): WorkspaceClockState {
    return {
      scope,
      clock: null,
      phase: "loading",
      refreshing: false,
      pending: false,
      pendingIntent: null,
      feedbackOwner: "header",
      feedbackVersion: 0,
      signedOut: false,
      feedback: initialTimeClockActionState,
      retry: null,
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private now() {
    return this.io.now?.() ?? Date.now();
  }
  private publish(patch: Partial<WorkspaceClockState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private invalidateReads() {
    this.revision++;
    this.readTask = null;
    clearTimeout(this.expiry);
    clearTimeout(this.deadline);
  }
  start() {
    this.running = true;
    void this.refresh(true);
  }
  stop() {
    this.running = false;
    this.invalidateReads();
  }
  setScope(scope: string) {
    if (scope === this.state.scope) return;
    this.invalidateReads();
    this.newest = null;
    this.expected = null;
    this.operation = null;
    this.confirmedAt = 0;
    this.publish(this.empty(scope));
    if (this.running) void this.refresh(true);
  }
  clear(signingOut = false) {
    this.invalidateReads();
    if (signingOut) this.operation = null;
    this.publish({
      clock: null,
      phase: "loading",
      refreshing: false,
      signedOut: signingOut || this.state.signedOut,
      ...(signingOut ? { feedback: initialTimeClockActionState, retry: null } : {}),
    });
  }
  refresh = (force = false): Promise<void> => {
    if (!this.running || this.state.signedOut || this.state.pending)
      return Promise.resolve();
    if (this.readTask) return this.readTask;
    if (
      !force &&
      this.state.phase === "confirmed" &&
      this.now() - this.confirmedAt < CLOCK_REFRESH_MS
    )
      return Promise.resolve();
    const revision = ++this.revision,
      scope = this.state.scope;
    this.publish({ refreshing: true });
    const current = () =>
      this.running &&
      revision === this.revision &&
      scope === this.state.scope &&
      !this.state.signedOut;
    const fail = () => {
      this.publish({ clock: null, phase: "unavailable", refreshing: false });
    };
    // Bound the read UI. Late server responses cannot regain authority after timeout.
    this.deadline = setTimeout(() => {
      if (!current()) return;
      this.revision++;
      this.readTask = null;
      fail();
    }, CLOCK_READ_MS);
    const task = Promise.resolve()
      .then(() => this.io.read(scope))
      .then(
        (snapshot) => {
          if (!current()) return;
          if (
            !snapshot ||
            !validTimestamp(snapshot.serverTime) ||
            (this.newest &&
              (exactMicroseconds(snapshot.serverTime) <
                exactMicroseconds(this.newest.serverTime) ||
                (exactMicroseconds(snapshot.serverTime) ===
                  exactMicroseconds(this.newest.serverTime) &&
                  (snapshot.status !== this.newest.status ||
                    snapshot.currentStartedAt !== this.newest.currentStartedAt)))) ||
            (this.expected && snapshot.status !== this.expected)
          ) {
            fail();
            return;
          }
          const sameTime =
            this.newest &&
            exactMicroseconds(snapshot.serverTime) ===
              exactMicroseconds(this.newest.serverTime);
          if (sameTime && this.now() - this.confirmedAt >= CLOCK_FRESH_MS) {
            fail();
            return;
          }
          this.newest = snapshot;
          this.expected = null;
          if (!sameTime) this.confirmedAt = this.now();
          this.publish({ clock: snapshot, phase: "confirmed", refreshing: false });
          clearTimeout(this.expiry);
          this.expiry = setTimeout(
            () => {
              if (
                !this.running ||
                scope !== this.state.scope ||
                this.state.signedOut ||
                this.newest !== snapshot
              )
                return;
              this.publish({ clock: null, phase: "unavailable" });
              void this.refresh(true);
            },
            Math.max(0, CLOCK_FRESH_MS - (this.now() - this.confirmedAt)),
          );
        },
        () => {
          if (current()) fail();
        },
      )
      .finally(() => {
        if (revision === this.revision) {
          clearTimeout(this.deadline);
          this.readTask = null;
        }
      });
    this.readTask = task;
    return task;
  };
  canSubmit(intent: ClockIntent) {
    return (
      this.running &&
      !this.state.signedOut &&
      !this.state.pending &&
      this.state.phase === "confirmed" &&
      this.now() - this.confirmedAt < CLOCK_FRESH_MS &&
      !!this.state.clock &&
      (this.operation
        ? this.operation.intent === intent
        : allowed[this.state.clock.status].includes(intent))
    );
  }
  submit = async (intent: ClockIntent, owner: ClockLocation = "header") => {
    if (!this.canSubmit(intent)) return false;
    const scope = this.state.scope;
    if (!this.operation)
      this.operation = { intent, id: this.io.uuid?.() ?? crypto.randomUUID() };
    const operation = this.operation;
    this.invalidateReads();
    this.publish({
      pending: true,
      pendingIntent: intent,
      feedbackOwner: owner,
      refreshing: false,
      feedback: initialTimeClockActionState,
    });
    const form = new FormData();
    form.set("request_id", operation.id);
    form.set("operation", operation.intent);
    let result: TimeClockActionState;
    try {
      result = await this.io.submit(initialTimeClockActionState, form, scope);
    } catch {
      result = {
        status: "error",
        message:
          "Resultaat niet bevestigd. Controleer de werkstatus en probeer dezelfde actie opnieuw.",
      };
    }
    // Never unlock for a second operation merely because transport is slow.
    if (
      scope !== this.state.scope ||
      this.operation !== operation ||
      this.state.signedOut ||
      !this.running
    )
      return false;
    this.invalidateReads();
    if (result.requestId === operation.id) {
      this.operation = null;
      if (result.status === "success") this.expected = resulting[intent];
    }
    this.publish({
      pending: false,
      pendingIntent: null,
      feedbackVersion: ++this.feedbackSequence,
      clock: null,
      phase: "loading",
      feedback: result,
      retry: this.operation?.intent ?? null,
    });
    await this.refresh(true);
    return true;
  };
}
