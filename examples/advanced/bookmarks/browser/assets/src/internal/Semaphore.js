export class Semaphore {
    total;
    waiters = [];
    available;
    constructor(total) {
        this.total = total;
        if (total <= 0)
            throw new RangeError(`Semaphore must be created with total > 0, got ${total}`);
        this.available = Math.floor(total);
    }
    acquire() {
        if (this.available > 0) {
            this.available--;
            return acquired();
        }
        return acquire(this.waiters);
    }
    release() {
        if (this.waiters.length)
            queueMicrotask(this.waiters.shift());
        else
            this.available++;
    }
}
const acquired = () => ({
    promise: Promise.resolve(),
    [Symbol.dispose]() { }
});
const acquire = (waiters) => {
    let waiter;
    let cancelled = false;
    return {
        promise: new Promise(r => waiters.push(waiter = () => {
            if (!cancelled)
                r();
        })),
        [Symbol.dispose]: () => {
            cancelled = true;
            const i = waiters.indexOf(waiter);
            if (i >= 0)
                waiters.splice(i, 1);
        }
    };
};
