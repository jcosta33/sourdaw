import { type BridgeDeps, type GlutenBatchEntry } from './helpers';

type CreateFlushHandlersOutput = {
    flushParam: (_compositeKey: string, entry: GlutenBatchEntry) => void;
    previewParam: (_compositeKey: string, entry: GlutenBatchEntry) => void;
    pushParamImmediately: (deviceId: string, key: string, value: number) => void;
};

export function createFlushHandlers(deps: BridgeDeps): CreateFlushHandlersOutput {
    /**
     * The transient half of a gesture: drive the engine so the compressor
     * responds under the user's thumb, and write nothing to project truth.
     *
     * A `RotaryKnob` sweep emits `onChange(value, true)` on every pointer-move
     * that crosses a step (`RotaryKnob.tsx:305`) and once more with `false` on
     * release (`:189`). Persisting each of those would put one Automerge
     * transaction and one undo entry per frame into the history for a single
     * knob move. The value the user settles on is committed once, by
     * `setGlutenParamWithAudio`'s non-transient branch.
     */
    function previewParam(_compositeKey: string, entry: GlutenBatchEntry): void {
        const target = deps.resolveEligibleDeviceWriteTarget(entry.deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        deps.updateDeviceParam(target.trackId, target.deviceId, entry.key, entry.value);
    }

    function flushParam(_compositeKey: string, entry: GlutenBatchEntry): void {
        const target = deps.resolveEligibleDeviceWriteTarget(entry.deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        deps.updateDeviceParam(target.trackId, target.deviceId, entry.key, entry.value);
        deps.persistDeviceParam(target.deviceId, entry.key, entry.value);
    }

    function pushParamImmediately(deviceId: string, key: string, value: number): void {
        const target = deps.resolveEligibleDeviceWriteTarget(deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        deps.updateDeviceParam(target.trackId, target.deviceId, key, value);
        deps.persistDeviceParam(target.deviceId, key, value);
    }

    return { flushParam, previewParam, pushParamImmediately };
}
