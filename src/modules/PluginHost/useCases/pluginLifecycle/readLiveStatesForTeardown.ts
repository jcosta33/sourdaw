import { bytesToBase64 } from '#/utils/base64';

import { getPluginState } from '../../repositories/pluginBridge/getPluginState';

import { externalPluginRestoreFailures } from './externalPluginRestoreFailures';
import { loadedExternalInstancePluginIds } from './loadedExternalInstances';
import { preservationReason } from './readExternalPluginStateForCapture';
import { serializePluginLifecycle } from './serializePluginLifecycle';

// The native read waits up to 2 s for the plugin's control lock before it
// answers; a teardown must never wait indefinitely on a hung plugin.
const TEARDOWN_STATE_READ_TIMEOUT_MS = 5000;

type TeardownStateRead =
    | Readonly<{ status: 'carried'; pluginId: string; stateChunk: string }>
    | Readonly<{ status: 'nothing' }>
    | Readonly<{ status: 'lost'; pluginId: string }>;

const NOTHING: TeardownStateRead = { status: 'nothing' };

async function readLiveState(instanceId: string): Promise<TeardownStateRead> {
    const pluginId = loadedExternalInstancePluginIds.get(instanceId);
    if (pluginId === undefined || preservationReason(instanceId) !== null) {
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

/** A read still pending at the deadline counts as lost; its late answer is ignored. */
function withinTeardownBudget(instanceId: string, read: Promise<TeardownStateRead>): Promise<TeardownStateRead> {
    const pluginId = loadedExternalInstancePluginIds.get(instanceId);
    const timedOut: TeardownStateRead = pluginId === undefined ? NOTHING : { status: 'lost', pluginId };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<TeardownStateRead>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), TEARDOWN_STATE_READ_TIMEOUT_MS);
    });
    return Promise.race([read, deadline]).finally(() => clearTimeout(timer));
}

function readForOrdering(instanceId: string, ordering: 'inside-lifecycle' | 'scheduled'): Promise<TeardownStateRead> {
    if (ordering === 'inside-lifecycle') {
        return readLiveState(instanceId);
    }
    return serializePluginLifecycle(instanceId, () => readLiveState(instanceId));
}

/**
 * Read the live state of instances an app-initiated teardown is about to
 * destroy, in parallel. Nothing is carried yet: `commitCarriedLiveStates`
 * keeps only the reads of instances the teardown really destroyed.
 *
 * `inside-lifecycle` reads directly, for a caller already holding the
 * instance's lifecycle turn or a rebuild fence — scheduling there would wait
 * on itself. `scheduled` takes each instance's own lifecycle turn.
 */
export async function readLiveStatesForTeardown(
    instanceIds: readonly string[],
    ordering: 'inside-lifecycle' | 'scheduled'
): Promise<ReadonlyMap<string, TeardownStateRead>> {
    const reads = instanceIds.map(async (instanceId) => {
        const read = readForOrdering(instanceId, ordering);
        return [instanceId, await withinTeardownBudget(instanceId, read)] as const;
    });
    return new Map(await Promise.all(reads));
}
