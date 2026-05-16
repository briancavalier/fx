/**
 * Clock that uses Date.now, performance.now, and setTimeout.
 * Timeouts longer than JS max timeout 2147483647 are supported.
 */
export class RealClock {
    now() {
        return Date.now();
    }
    monotonic() {
        return performance.now();
    }
    schedule(ms, task) {
        const d = new TimeoutDisposable();
        this._schedule(ms, task, d);
        return d;
    }
    _schedule(ms, task, d) {
        d._timeout = ms <= MAX_SET_TIMEOUT
            ? setTimeout(task, ms)
            : setTimeout(() => this._schedule(ms - MAX_SET_TIMEOUT, task, d));
    }
}
/**
 * Max JS setTimeout delay value. Timeouts larger than this will overflow to negative
 * and run immediately. Compensate by chaining timeouts.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/setTimeout#maximum_delay_value
 */
const MAX_SET_TIMEOUT = 2147483647;
/**
 * Virtual Clock implementation that allows time to be controlled manually.
 * Now will start at 0 or the provided origin, and monotonic time will
 * always start at 0. A VirtualClock must be advanced explicitly by calling
 * the step(milliseconds) or waitAll() methods.
 *
 * @example
 * // now and monotonic start at 0 unless provided
 * const vc = new VirtualClock()
 *
 * vc.schedule(1000, () => console.log('1 second has passed')
 *
 * // advance time by 1 second
 * // now and monotonic will be 1000, and any tasks scheduled
 * // for up to 1 second will execute
 *
 * await vc.step(1000)
 *
 * // '1 second has passed'
 */
export class VirtualClock {
    nowOrigin;
    _monotonic = 0;
    _target = 0;
    _tasks = [];
    _timeout;
    _disposed = false;
    constructor(nowOrigin = 0) {
        this.nowOrigin = nowOrigin;
    }
    monotonic() {
        return this._monotonic;
    }
    now() {
        return this.nowOrigin + Math.floor(this._monotonic);
    }
    get target() {
        return this._target;
    }
    get disposed() {
        return this._disposed;
    }
    [Symbol.dispose]() {
        this._disposed = true;
        this._tasks = [];
        this.clearTimeout();
    }
    step(millis) {
        if (this._disposed)
            return Promise.resolve();
        this._target = this._target + Math.max(0, millis);
        return this.runTasks();
    }
    waitAll() {
        return this.step(Infinity);
    }
    schedule(ms, task) {
        const t = { at: this.monotonic() + Math.max(0, ms), task };
        this._tasks.push(t);
        return new SpliceDisposable(this._tasks, t);
    }
    clearTimeout() {
        if (this._timeout) {
            clearTimeout(this._timeout);
            this._timeout = undefined;
        }
    }
    runTasks() {
        return this._disposed
            ? Promise.resolve()
            : new Promise(resolve => this.runTaskLoop(resolve));
    }
    runTaskLoop(resolve) {
        this._timeout = setTimeout(() => {
            // More tasks may have been added between timeouts,
            // so have to sort each time
            this._tasks.sort((a, b) => a.at - b.at);
            if (this._disposed || this._tasks.length === 0 || this._tasks[0].at > this._target) {
                this._monotonic = this._target;
                return resolve();
            }
            if (this._tasks[0].at <= this._target) {
                const t = this._tasks.shift();
                this._monotonic = t.at;
                t.task();
                this.runTaskLoop(resolve);
            }
        }, 0);
    }
}
class TimeoutDisposable {
    _timeout;
    [Symbol.dispose]() {
        clearTimeout(this._timeout);
    }
}
export class SpliceDisposable {
    array;
    value;
    constructor(array, value) {
        this.array = array;
        this.value = value;
    }
    [Symbol.dispose]() {
        const i = this.array.indexOf(this.value);
        if (i >= 0)
            this.array.splice(i, 1);
    }
}
