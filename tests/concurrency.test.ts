import { describe, it, expect } from "vitest";
import { Semaphore, mapConcurrent } from "../src/ingest/concurrency.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Semaphore", () => {
  it("allows up to limit concurrent runs", async () => {
    const sem = new Semaphore(2);
    let maxConcurrent = 0;
    let current = 0;

    const task = async () => {
      current++;
      if (current > maxConcurrent) maxConcurrent = current;
      await sleep(20);
      current--;
    };

    await Promise.all([
      sem.run(task),
      sem.run(task),
      sem.run(task),
      sem.run(task),
      sem.run(task),
    ]);

    expect(maxConcurrent).toBe(2);
  });

  it("queues excess callers", async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];

    const task = (id: number) => async () => {
      order.push(id);
      await sleep(10);
    };

    await Promise.all([
      sem.run(task(1)),
      sem.run(task(2)),
      sem.run(task(3)),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });

  it("reports active and waiting counts", async () => {
    const sem = new Semaphore(1);
    expect(sem.active).toBe(0);
    expect(sem.waiting).toBe(0);

    await sem.acquire();
    expect(sem.active).toBe(1);

    // Start a second acquire that will queue
    const p = sem.acquire();
    expect(sem.waiting).toBe(1);

    sem.release(); // releases to queued waiter
    await p;
    expect(sem.active).toBe(1);
    expect(sem.waiting).toBe(0);

    sem.release();
    expect(sem.active).toBe(0);
  });

  it("throws on invalid limit", () => {
    expect(() => new Semaphore(0)).toThrow("Semaphore limit must be >= 1");
    expect(() => new Semaphore(-1)).toThrow("Semaphore limit must be >= 1");
  });

  it("releases slot even when fn throws", async () => {
    const sem = new Semaphore(1);
    try {
      await sem.run(async () => {
        throw new Error("boom");
      });
    } catch {
      // expected
    }
    expect(sem.active).toBe(0);
  });
});

describe("mapConcurrent", () => {
  it("processes all items", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await mapConcurrent(items, 2, async (n) => n * 10);
    const values = results
      .filter((r): r is PromiseFulfilledResult<number> => r.status === "fulfilled")
      .map((r) => r.value);
    expect(values).toEqual([10, 20, 30, 40, 50]);
  });

  it("respects concurrency limit", async () => {
    let maxConcurrent = 0;
    let current = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await mapConcurrent(items, 3, async () => {
      current++;
      if (current > maxConcurrent) maxConcurrent = current;
      await sleep(10);
      current--;
    });

    expect(maxConcurrent).toBeLessThanOrEqual(3);
    expect(maxConcurrent).toBeGreaterThanOrEqual(1);
  });

  it("captures individual item errors without aborting", async () => {
    const items = [1, 2, 3];
    const results = await mapConcurrent(items, 5, async (n) => {
      if (n === 2) throw new Error("fail on 2");
      return n * 10;
    });

    expect(results[0]).toEqual({ status: "fulfilled", value: 10 });
    expect(results[1].status).toBe("rejected");
    expect(results[2]).toEqual({ status: "fulfilled", value: 30 });
  });

  it("handles empty input", async () => {
    const results = await mapConcurrent([], 3, async () => "never");
    expect(results).toEqual([]);
  });

  it("provides index to callback", async () => {
    const items = ["a", "b", "c"];
    const results = await mapConcurrent(items, 5, async (item, idx) => `${item}:${idx}`);
    const values = results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
      .map((r) => r.value);
    expect(values).toEqual(["a:0", "b:1", "c:2"]);
  });
});
