export class JobQueue {
  #active = 0;
  #pending = [];

  constructor(limit = 1) {
    this.limit = limit;
  }

  enqueue(job) {
    this.#pending.push(job);
    this.#drain();
  }

  get size() {
    return this.#pending.length;
  }

  #drain() {
    while (this.#active < this.limit && this.#pending.length > 0) {
      const job = this.#pending.shift();
      this.#active += 1;
      Promise.resolve()
        .then(job)
        .catch((error) => console.error("job failed", error))
        .finally(() => {
          this.#active -= 1;
          this.#drain();
        });
    }
  }
}
