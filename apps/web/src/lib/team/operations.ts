// In-memory only: uncertain intents survive retries, never enter URLs or storage.
export class TeamOperations {
  private readonly pending = new Map<string, string>();
  constructor(private readonly uuid: () => string = () => crypto.randomUUID()) {}
  request(key: string) {
    let id = this.pending.get(key);
    if (!id) {
      id = this.uuid();
      this.pending.set(key, id);
    }
    return id;
  }
  confirm(key: string, requestId: string) {
    if (this.pending.get(key) === requestId) this.pending.delete(key);
  }
}
