import { createStore } from '#/infra/store/createStore';

/**
 * How long each loaded external plugin instance keeps sounding after its input
 * stops — a reverb's decay, a delay's repeats — as the plugin last reported it.
 *
 * Runtime state, not project truth: the figure is the plugin's own answer about
 * the instance this process loaded, and it is gone with the instance. The load
 * seeds it, `plugin-tail-changed` revises it, and unload or a graph rebuild
 * drops it.
 *
 * Frames of the rate the instance was activated with, never seconds: both plugin
 * formats reserve the top of the range for a tail that never ends, and a
 * converted sentinel would read as an ordinary duration. A reader converts, and
 * decides what an unending tail means for it.
 */
export type ExternalPluginTailState = {
    tailSamplesByInstanceId: Record<string, number>;
};

export const defaultExternalPluginTailState: ExternalPluginTailState = {
    tailSamplesByInstanceId: {},
};

export const externalPluginTailStore = createStore<ExternalPluginTailState>({
    initialData: defaultExternalPluginTailState,
});

/**
 * Writers are module-private: they are not on the `stores/` barrel, so foreign
 * modules read this store and never write it.
 */

/**
 * Which write last touched each instance's tail. A seed, a revision and a drop
 * each take the next value of one counter, and a drop keeps its own rather than
 * resetting, so a stamp issued before an instance was dropped never matches one
 * a later seed of the same id takes.
 */
const tailStamps = new Map<string, number>();
let lastTailStamp = 0;

function advanceTailStamp(instanceId: string): void {
    lastTailStamp += 1;
    tailStamps.set(instanceId, lastTailStamp);
}

/** Each instance's stamp as it stands now, for a read that is about to be issued. */
export function issueExternalPluginTailRead(instanceIds: readonly string[]): ReadonlyMap<string, number | undefined> {
    return new Map(instanceIds.map((instanceId) => [instanceId, tailStamps.get(instanceId)]));
}

/**
 * Publish a tail a host read answered, only if nothing has written that
 * instance's tail since the read was issued. A newer answer, a
 * `plugin-tail-changed` revision, or an unload and reload under the same id
 * each advance the stamp, and the answer is then older than what the store
 * holds. Publishing advances the stamp too, so an older overlapping read drops.
 */
export function publishExternalPluginTailRead(
    instanceId: string,
    issuedStamp: number | undefined,
    tailSamples: number
): void {
    if (tailStamps.get(instanceId) !== issuedStamp) {
        return;
    }
    reviseExternalPluginTail(instanceId, tailSamples);
}

export function writeExternalPluginTail(instanceId: string, tailSamples: number): void {
    advanceTailStamp(instanceId);
    externalPluginTailStore.update((state) => {
        const current = state ?? defaultExternalPluginTailState;
        return {
            ...current,
            tailSamplesByInstanceId: { ...current.tailSamplesByInstanceId, [instanceId]: tailSamples },
        };
    });
}

/**
 * Revise the tail of an instance whose load already seeded it. A change for an
 * instance with no entry is dropped: recording it would describe a plugin that
 * no longer exists. The caller holds a change for an instance still loading
 * and hands it to the load's seed instead.
 */
export function reviseExternalPluginTail(instanceId: string, tailSamples: number): void {
    if (externalPluginTailStore.value?.tailSamplesByInstanceId[instanceId] === undefined) {
        return;
    }
    advanceTailStamp(instanceId);
    externalPluginTailStore.update((state) => {
        const current = state ?? defaultExternalPluginTailState;
        return {
            ...current,
            tailSamplesByInstanceId: { ...current.tailSamplesByInstanceId, [instanceId]: tailSamples },
        };
    });
}

export function dropExternalPluginTail(instanceId: string): void {
    advanceTailStamp(instanceId);
    externalPluginTailStore.update((state) => {
        const current = state ?? defaultExternalPluginTailState;
        if (current.tailSamplesByInstanceId[instanceId] === undefined) {
            return current;
        }
        const tailSamplesByInstanceId = Object.fromEntries(
            Object.entries(current.tailSamplesByInstanceId).filter(([id]) => id !== instanceId)
        );
        return { ...current, tailSamplesByInstanceId };
    });
}
