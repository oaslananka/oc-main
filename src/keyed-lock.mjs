export function createKeyedSerialExecutor() {
  const tails = new Map();

  async function run(key, task) {
    const normalizedKey = String(key || "");
    if (!normalizedKey) throw new Error("Serial executor key is missing");
    if (typeof task !== "function") throw new TypeError("Serial executor task is missing");

    const prior = tails.get(normalizedKey) || Promise.resolve();
    const execution = prior.catch(() => {}).then(task);
    tails.set(normalizedKey, execution);

    try {
      return await execution;
    } finally {
      if (tails.get(normalizedKey) === execution) {
        tails.delete(normalizedKey);
      }
    }
  }

  return {
    run,
    size() {
      return tails.size;
    },
  };
}
