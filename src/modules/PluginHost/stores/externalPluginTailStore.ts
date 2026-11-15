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

export function writeExternalPluginTail(instanceId: string, tailSamples: number): void {
    externalPluginTailStore.update((state) => {
        const current = state ?? defaultExternalPluginTailState;
        return {
            ...current,
            tailSamplesByInstanceId: { ...current.tailSamplesByInstanceId, [instanceId]: tailSamples },
        };
    });
}

/**
 * Revise the tail of an instance this process holds. A change for an instance
 * with no entry is dropped: it was unloaded between the host's push and this
 * dispatch, and recording it would describe a plugin that no longer exists.
 */
export function reviseExternalPluginTail(instanceId: string, tailSamples: number): void {
    externalPluginTailStore.update((state) => {
        const current = state ?? defaultExternalPluginTailState;
        if (current.tailSamplesByInstanceId[instanceId] === undefined) {
            return current;
        }
        return {
            ...current,
            tailSamplesByInstanceId: { ...current.tailSamplesByInstanceId, [instanceId]: tailSamples },
        };
    });
}

export function dropExternalPluginTail(instanceId: string): void {
    externalPluginTailStore.update((state) => {
        const current = state ?? defaultExternalPluginTailState;
        if (current.tailSamplesByInstanceId[instanceId] === undefined) {
            return current;
        }
        const tailSamplesByInstanceId = { ...current.tailSamplesByInstanceId };
        delete tailSamplesByInstanceId[instanceId];
        return { ...current, tailSamplesByInstanceId };
    });
}
