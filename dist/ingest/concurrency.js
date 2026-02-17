/**
 * Simple concurrency primitives for limiting parallel work.
 */
export class Semaphore {
    limit;
    current = 0;
    queue = [];
    constructor(limit) {
        this.limit = limit;
        if (limit < 1)
            throw new Error("Semaphore limit must be >= 1");
    }
    /** Acquire a slot. Resolves immediately if capacity is available, otherwise waits. */
    acquire() {
        if (this.current < this.limit) {
            this.current++;
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.queue.push(resolve);
        });
    }
    /** Release a slot, allowing the next queued caller to proceed. */
    release() {
        const next = this.queue.shift();
        if (next) {
            // Hand the slot directly to the next waiter (current stays the same)
            next();
        }
        else {
            this.current--;
        }
    }
    /** Run a function with automatic acquire/release. */
    async run(fn) {
        await this.acquire();
        try {
            return await fn();
        }
        finally {
            this.release();
        }
    }
    /** Current number of active slots. */
    get active() {
        return this.current;
    }
    /** Number of callers waiting for a slot. */
    get waiting() {
        return this.queue.length;
    }
}
/**
 * Map over items with a concurrency limit.
 * Like Promise.all(items.map(fn)) but at most `limit` calls run concurrently.
 * Each item's result (or error) is collected in order.
 */
export async function mapConcurrent(items, limit, fn) {
    const sem = new Semaphore(limit);
    const promises = items.map((item, i) => sem.run(() => fn(item, i)));
    return Promise.allSettled(promises);
}
