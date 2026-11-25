type RebuildFence = {
    completion: Promise<void>;
    open: () => void;
};

/**
 * How long a rebuild fence waits for the lifecycle operations admitted before
 * it. An operation still pending then is a call inside a plugin that has not
 * returned and may never return, and the fence goes on without it.
 *
 * Above the native control gate's own deadline (`CONTROL_GATE_DEADLINE`, 10 s,
 * in `crates/sourdaw-native/src/host/native_bridge.rs`) plus the 2 s real-time
 * seam wait a control call adds after it, with room for the IPC answer: a call
 * queued natively behind a hung one answers with the unresponsive refusal
 * before this fires, so it fires only for the hung call itself, whose IPC never
 * answers.
 */
export const LIFECYCLE_SETTLEMENT_DEADLINE_MS = 15_000;

type RebuildFenceLease = {
    /**
     * Wait for every lifecycle operation admitted before the fence, and for
     * `alongside` (keyed by instance id), up to the settlement deadline, and
     * answer the instance ids whose operations had not settled by then.
     */
    waitForExistingOperations: (alongside: ReadonlyMap<string, Promise<unknown>>) => Promise<ReadonlySet<string>>;
    end: () => void;
};

type InstanceOperation = readonly [instanceId: string, operation: Promise<unknown>];

/** The instance ids of `operations` still pending at the settlement deadline. */
async function unsettledAtDeadline(operations: readonly InstanceOperation[]): Promise<ReadonlySet<string>> {
    const pending = new Set(operations);
    // Settlement is all that is waited for; each failure stays its own caller's.
    const settlements = operations.map(async (entry) => {
        await Promise.allSettled([entry[1]]);
        pending.delete(entry);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, LIFECYCLE_SETTLEMENT_DEADLINE_MS);
    });
    await Promise.race([Promise.all(settlements), deadline]).finally(() => clearTimeout(timer));
    return new Set(Array.from(pending, ([instanceId]) => instanceId));
}

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
        // Ordering only: the successor waits for the prior's settlement with the
        // prior's failure swallowed here, because serialization must order
        // operations, not propagate one failure into cancelling the next. The
        // failure stays the prior caller's own; the stored tail still rethrows
        // after cleanup, so anyone awaiting it keeps seeing real outcomes.
        const turn = previous ? previous.catch(() => undefined) : Promise.resolve();
        const result = turn.then(() => {
            try {
                return operation();
            } catch (error) {
                const failure =
                    error instanceof Error ? error : new Error('Plugin lifecycle operation failed', { cause: error });
                throw failure;
            }
        });

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
    async beginRebuildAfterCurrent(): Promise<RebuildFenceLease> {
        while (rebuildFence !== null) {
            await rebuildFence.completion;
        }
        return pluginLifecycleScheduler.beginRebuild();
    },

    beginRebuild(): RebuildFenceLease {
        if (rebuildFence) {
            throw new Error('External plugin runtime rebuild is already in progress');
        }
        const existingOperations = [...lifecycleTails.entries()];
        const fence = createRebuildFence();
        rebuildFence = fence;
        let ended = false;
        return {
            waitForExistingOperations: async (alongside) => {
                const unsettled = await unsettledAtDeadline([...existingOperations, ...alongside]);
                // A tail that cannot settle would hold the instance's next turn
                // forever, so it is let go; its own late settlement deletes
                // nothing, because it is no longer the stored tail.
                for (const [instanceId, tail] of existingOperations) {
                    if (unsettled.has(instanceId) && lifecycleTails.get(instanceId) === tail) {
                        lifecycleTails.delete(instanceId);
                    }
                }
                return unsettled;
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
