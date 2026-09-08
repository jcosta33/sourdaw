type PendingLock = {
    callback: LockGrantedCallback<unknown>;
};

export type ControlledLockManager = {
    locks: Pick<LockManager, 'request'>;
    requestedNames: string[];
};

export function createControlledLockManager(): ControlledLockManager {
    const activeNames = new Set<string>();
    const queues = new Map<string, PendingLock[]>();
    const requestedNames: string[] = [];

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
        void Promise.resolve(pending.callback(null)).finally(() => {
            activeNames.delete(name);
            drain(name);
        });
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

    return { locks: new ControlledExclusiveLockManager(), requestedNames };
}
