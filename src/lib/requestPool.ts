/** Limits concurrent background wire/HTTP work so feed enrichment cannot
 *  open hundreds of parallel backend calls (monitor = 2 columns × 20 rows). */

const DEFAULT_MAX = 4;

let active = 0;
const waiters: Array<() => void> = [];

function drain(): void {
  while (active < DEFAULT_MAX && waiters.length > 0) {
    active += 1;
    const run = waiters.shift()!;
    void Promise.resolve()
      .then(run)
      .finally(() => {
        active -= 1;
        drain();
      });
  }
}

export function runPooled<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    waiters.push(() => {
      void task().then(resolve, reject);
    });
    drain();
  });
}
