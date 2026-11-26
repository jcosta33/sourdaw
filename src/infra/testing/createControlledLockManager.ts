type PendingLock = {
    callback: LockGrantedCallback<unknown>;
};

export type ControlledLockManager = {
    locks: Pick<LockManager, 'request'>;
    requestedNames: string[];
    /** Resolves when the next request (for `name`, when given) arrives; requests made earlier never count. */
    nextRequest: (name?: string) => Promise<void>;
};

export function createControlledLockManager(): ControlledLockManager {
    const activeNames = new Set<string>();
    const queues = new Map<string, PendingLock[]>();
    const requestedNames: string[] = [];
    const requestWaiters: { name: string | undefined; resolve: () => void }[] = [];

    const nextRequest = (name?: string): Promise<void> => {
        const { promise, resolve } = Promise.withResolvers<void>();
        requestWaiters.push({ name, resolve });
        return promise;
    };

    const notifyRequested = (name: string): void => {
        for (let index = requestWaiters.length - 1; index >= 0; index -= 1) {
            const waiter = requestWaiters[index]!;
            if (waiter.name === undefined || waiter.name === name) {
                requestWaiters.splice(index, 1);
                waiter.resolve();
            }
        }
    };

    const drain = (name: string): void => {
        if (activeNames.has(name)) {
            return;
        }
        const queue = queues.get(name);
        const pending = queue?.shift();
        if (!pending) {
            return;
        }
        activeNames.add(name);
        // A granted request gets a lock, a refused `ifAvailable` request gets
        // `null` — the platform's only signal of which happened, and the one a
        // liveness probe reads to tell "nobody holds this" from "I waited".
        void Promise.resolve(pending.callback({ name, mode: 'exclusive' })).finally(() => {
            activeNames.delete(name);
            drain(name);
        });
    };

    const isGrantableNow = (name: string): boolean => {
        return !activeNames.has(name) && (queues.get(name)?.length ?? 0) === 0;
    };

    class ControlledExclusiveLockManager implements Pick<LockManager, 'request'> {
        request<TResult>(name: string, callback: LockGrantedCallback<TResult>): Promise<Awaited<TResult>>;
        request<TResult>(
            name: string,
            options: LockOptions,
            callback: LockGrantedCallback<TResult>
        ): Promise<Awaited<TResult>>;
        request<TResult>(
            name: string,
            optionsOrCallback: LockOptions | LockGrantedCallback<TResult>,
            suppliedCallback?: LockGrantedCallback<TResult>
        ): Promise<Awaited<TResult>> {
            const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
            const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : suppliedCallback;
            if (!callback) {
                return Promise.reject(new TypeError('Lock callback is required'));
            }
            if (options.mode !== undefined && options.mode !== 'exclusive') {
                return Promise.reject(new Error('Controlled lock manager supports exclusive locks only'));
            }
            requestedNames.push(name);
            notifyRequested(name);
            if (options.ifAvailable === true && !isGrantableNow(name)) {
                // Not queued, deliberately: `ifAvailable` either takes the lock
                // now or reports that it could not, and a caller that ends up
                // waiting has learned nothing about the holder.
                return Promise.resolve(callback(null));
            }
            return new Promise<Awaited<TResult>>((resolve, reject) => {
                const queue = queues.get(name) ?? [];
                queues.set(name, queue);
                queue.push({
                    callback: async (lock) => Promise.resolve(callback(lock)).then(resolve, reject),
                });
                drain(name);
            });
        }
    }

    return { locks: new ControlledExclusiveLockManager(), requestedNames, nextRequest };
}
