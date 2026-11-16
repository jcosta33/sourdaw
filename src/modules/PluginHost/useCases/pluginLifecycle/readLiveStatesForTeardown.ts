import { bytesToBase64 } from '#/utils/base64';

import { getPluginState } from '../../repositories/pluginBridge/getPluginState';

import { carriedExternalPluginStateFence, carriedExternalPluginStates } from './carriedExternalPluginStates';
import { externalPluginRestoreFailures } from './externalPluginRestoreFailures';
import { loadedExternalInstancePluginIds } from './loadedExternalInstances';
import { preservationReason } from './preservationReason';
import { serializePluginLifecycle } from './serializePluginLifecycle';

// The native read bounds only its wait on the plugin's real-time seam (2 s);
// its wait on the plugin's control gate is unbounded while another control
// operation holds it, so a hung plugin can leave the read pending forever. A
// teardown must never wait on that, so the read is bounded here.
const TEARDOWN_STATE_READ_TIMEOUT_MS = 5000;

type TeardownStateRead =
    | Readonly<{ status: 'carried'; pluginId: string; stateChunk: string }>
    | Readonly<{ status: 'nothing' }>
    | Readonly<{ status: 'lost'; pluginId: string }>;

const NOTHING: TeardownStateRead = { status: 'nothing' };

type StampedTeardownStateRead = Readonly<{
    read: TeardownStateRead;
    /** The instance's carry-slot version when its read started. */
    slotVersion: number;
}>;

/**
 * The carry an activation still in flight is restoring. The activation keeps
 * the entry until it settles, so a removal landing first carries it forward
 * rather than leaving it to that settlement, which cannot tell the instance is
 * already being torn down.
 */
function carryBeingRestored(instanceId: string, pluginId: string): TeardownStateRead {
    const carried = carriedExternalPluginStates.get(instanceId);
    if (carried === undefined || carried.pluginId !== pluginId) {
        return NOTHING;
    }
    return { status: 'carried', pluginId, stateChunk: carried.stateChunk };
}

async function readLiveState(instanceId: string): Promise<TeardownStateRead> {
    const pluginId = loadedExternalInstancePluginIds.get(instanceId);
    if (pluginId === undefined) {
        return NOTHING;
    }
    const reason = preservationReason(instanceId);
    if (reason === 'restore-pending') {
        return carryBeingRestored(instanceId, pluginId);
    }
    if (reason !== null) {
        return NOTHING;
    }
    let bytes: Uint8Array;
    try {
        bytes = await getPluginState(instanceId);
    } catch {
        return { status: 'lost', pluginId };
    }
    if (externalPluginRestoreFailures.has(instanceId) || bytes.length === 0) {
        return NOTHING;
    }
    return { status: 'carried', pluginId, stateChunk: bytesToBase64(bytes) };
}

/**
 * Stamped when the read itself starts, not when its batch does: a scheduled
 * read waits for the instance's lifecycle turn, and a carry an activation took
 * while it waited is the one this read then sees as being restored.
 */
async function readStampedLiveState(instanceId: string): Promise<StampedTeardownStateRead> {
    const slotVersion = carriedExternalPluginStateFence.slotVersion(instanceId);
    return { read: await readLiveState(instanceId), slotVersion };
}

/** A read still pending at the deadline counts as lost; its late answer is ignored. */
function withinTeardownBudget(
    instanceId: string,
    read: Promise<StampedTeardownStateRead>
): Promise<StampedTeardownStateRead> {
    const pluginId = loadedExternalInstancePluginIds.get(instanceId);
    const timedOut: StampedTeardownStateRead = {
        read: pluginId === undefined ? NOTHING : { status: 'lost', pluginId },
        slotVersion: carriedExternalPluginStateFence.slotVersion(instanceId),
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<StampedTeardownStateRead>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), TEARDOWN_STATE_READ_TIMEOUT_MS);
    });
    return Promise.race([read, deadline]).finally(() => clearTimeout(timer));
}

/**
 * A scheduled read is bounded inside its lifecycle turn as well, so the deadline
 * releases the read and its turn: later TypeScript lifecycle operations on the
 * instance, and a rebuild queued behind them, proceed. A plugin hung inside its
 * own native call still holds the native control gate, so a later native unload
 * or retire of that same instance can still block.
 */
function readForOrdering(
    instanceId: string,
    ordering: 'inside-lifecycle' | 'scheduled'
): Promise<StampedTeardownStateRead> {
    if (ordering === 'inside-lifecycle') {
        return readStampedLiveState(instanceId);
    }
    return serializePluginLifecycle(instanceId, () =>
        withinTeardownBudget(instanceId, readStampedLiveState(instanceId))
    );
}

export type TeardownStateReads = Readonly<{
    /** The carry generation the batch started in. */
    generation: number;
    byInstanceId: ReadonlyMap<string, StampedTeardownStateRead>;
}>;

/**
 * Read the live state of instances an app-initiated teardown is about to
 * destroy, in parallel. Nothing is carried yet: `commitCarriedLiveStates`
 * keeps only the reads of instances the teardown really destroyed.
 *
 * `inside-lifecycle` reads directly, for a caller already holding the
 * instance's lifecycle turn or a rebuild fence — scheduling there would wait
 * on itself. `scheduled` takes each instance's own lifecycle turn; the wait for that
 * turn is bounded too.
 */
export async function readLiveStatesForTeardown(
    instanceIds: readonly string[],
    ordering: 'inside-lifecycle' | 'scheduled'
): Promise<TeardownStateReads> {
    const generation = carriedExternalPluginStateFence.generation();
    const reads = instanceIds.map(async (instanceId) => {
        const read = readForOrdering(instanceId, ordering);
        return [instanceId, await withinTeardownBudget(instanceId, read)] as const;
    });
    return { generation, byInstanceId: new Map(await Promise.all(reads)) };
}
