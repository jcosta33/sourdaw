type RebuildFence = {
    completion: Promise<void>;
    open: () => void;
};

const lifecycleTails = new Map<string, Promise<void>>();
let rebuildFence: RebuildFence | null = null;

function createRebuildFence(): RebuildFence {
    const completion = Promise.withResolvers<void>();
    return { completion: completion.promise, open: completion.resolve };
}

export const pluginLifecycleScheduler = {
    schedule<Result>(instanceId: string, operation: () => Promise<Result>): Promise<Result> {
        const activeFence = rebuildFence;
        if (activeFence) {
            return activeFence.completion.then(() => pluginLifecycleScheduler.schedule(instanceId, operation));
        }

        const previous = lifecycleTails.get(instanceId);
        let result: Promise<Result>;
        if (previous) {
            result = previous.then(operation);
        } else {
            result = Promise.resolve().then(() => {
                try {
                    return operation();
                } catch (error) {
                    const failure =
                        error instanceof Error
                            ? error
                            : new Error('Plugin lifecycle operation failed', { cause: error });
                    throw failure;
                }
            });
        }

        const callerResult = result.then((value) => value);
        const completion = result.then(
            () => {
                if (lifecycleTails.get(instanceId) === completion) {
                    lifecycleTails.delete(instanceId);
                }
                return undefined;
            },
            (error: unknown) => {
                if (lifecycleTails.get(instanceId) === completion) {
                    lifecycleTails.delete(instanceId);
                }
                throw error;
            }
        );
        void completion.catch(() => undefined);
        lifecycleTails.set(instanceId, completion);
        return callerResult;
    },

    currentRebuildCompletion(): Promise<void> | null {
        return rebuildFence?.completion ?? null;
    },

    /**
     * Acquires a rebuild fence only after the currently active fence has
     * opened. The acquisition happens in the same continuation as the final
     * check, so another rebuild cannot slip in between a session-retirement
     * join and its own admission fence.
     */
    async beginRebuildAfterCurrent(): Promise<{ waitForExistingOperations: () => Promise<void>; end: () => void }> {
        while (rebuildFence !== null) {
            await rebuildFence.completion;
        }
        return pluginLifecycleScheduler.beginRebuild();
    },

    beginRebuild(): { waitForExistingOperations: () => Promise<void>; end: () => void } {
        if (rebuildFence) {
            throw new Error('External plugin runtime rebuild is already in progress');
        }
        const existingOperations = [...lifecycleTails.values()];
        const fence = createRebuildFence();
        rebuildFence = fence;
        let ended = false;
        return {
            waitForExistingOperations: async () => {
                await Promise.allSettled(existingOperations);
            },
            end: () => {
                if (ended) {
                    return;
                }
                ended = true;
                if (rebuildFence === fence) {
                    rebuildFence = null;
                }
                fence.open();
            },
        };
    },
};

export function serializePluginLifecycle<Result>(
    instanceId: string,
    operation: () => Promise<Result>
): Promise<Result> {
    return pluginLifecycleScheduler.schedule(instanceId, operation);
}
