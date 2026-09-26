import { logger } from '#/infra/logger/appLogger';
import {
    type Track,
    type persistDeviceParam,
    type resolveEligibleDeviceWriteTarget,
} from '#/modules/Arrangement/stores';
import { type sendNativeLiveMidiControl, type writeNativeBuiltinParameters } from '#/modules/AudioEngine/useCases';
import { createRafBatcher } from '#/utils/DOM/createRafBatcher';

import { getArticulationId, isArticulationType, type LevainPatch } from '../../models/LevainPatch';
import {
    defaultLevainState,
    levainStore,
    setCurrentArticulation,
    setLevainParam,
    type setLoadedMicPositions,
    setMacro,
} from '../../stores/levainStore';
import { type autoLoadLevainSamples } from '../autoLoadSamples';
import { getLevainProjectParameterId } from '../getLevainProjectParameterId';
import { hydrateLevainStateFromProject } from '../hydrateLevainStateFromProject';
import { projectLevainPatchToEngineParameters } from '../projectLevainPatchToEngineParameters';

import { camelToSnake } from './camelToSnake';

export type LevainDevice = {
    setParam: (name: string, value: number) => void;
    handleCc: (cc: number, value: number) => void;
};

export type LevainSampleLoadOutcome = 'ready' | 'failed' | 'cancelled';

type SampleLoadOperation = {
    controller: AbortController;
    completion: Promise<LevainSampleLoadOutcome>;
    successor?: SampleLoadOperation;
};

export type LevainBridgeDeps = {
    getAllTracks: () => Track[];
    persistDeviceParam: typeof persistDeviceParam;
    autoLoadLevainSamples: typeof autoLoadLevainSamples;
    /**
     * The panel's loaded-bank readout. `loadSamplesForInstrument` is the only
     * caller — see its own comment for why the shared `autoLoadLevainSamples`
     * loader must not write this itself.
     */
    setLoadedMicPositions: typeof setLoadedMicPositions;
    resolveEligibleDeviceWriteTarget: typeof resolveEligibleDeviceWriteTarget;
    /**
     * The native session's door for values already spelled in the engine's own
     * vocabulary, which is exactly what this bridge holds.
     */
    writeNativeBuiltinParameters: typeof writeNativeBuiltinParameters;
    /**
     * The native session's door for a live controller message.
     *
     * A continuous controller is not a device parameter, so it cannot travel
     * the parameter door above: the instrument reads it through its own
     * controller surface, and this is the route that reaches it on a natively
     * carried strip.
     */
    sendNativeLiveMidiControl: typeof sendNativeLiveMidiControl;
};

/**
 * The strip and device one write addresses.
 *
 * The track id is not decoration: the native door is addressed by strip, and
 * `resolveEligibleDeviceWriteTarget` is already the one place that answers
 * which strip owns a device — so a write carries the resolution it was
 * admitted by rather than resolving the owner a second time.
 */
type LevainWriteTarget = { trackId: string; deviceId: string };

export function createLevainBridge(deps: LevainBridgeDeps) {
    const activeDevices = new Map<string, LevainDevice>();
    const activePorts = new Map<string, MessagePort>();
    // Per-device load cancellation. A new instrument load for a device aborts
    // the previous one so the last-started load — not the last-finishing one —
    // wins the worklet zone map and the UI progress.
    const loadOperations = new Map<string, SampleLoadOperation>();

    // §33.2 — Shared rAF-batch primitive. Last-write-wins per rustKey,
    // coalesced into one flush per animation frame.
    // Modified to include deviceId in the flush param.
    // We can use a composite key for the batcher: `${deviceId}:${rustKey}`
    const paramBatcher = createRafBatcher<number>();
    // Track which composite keys are currently pending per device so teardown
    // can cancel exactly this device's batches. The batcher does not expose its
    // key set, so we mirror it here; entries are dropped on flush and on cancel.
    const pendingKeysByDevice = new Map<string, Set<string>>();

    /**
     * One engine-spelled write to both carriers of the strip.
     *
     * The worklet write is unchanged; the native send is additive, and silent
     * when the live session is not carrying this device. Both are needed at
     * once because a natively carried strip still keeps its Web Audio node as
     * the fallback carrier — the node has to hold the current value for the
     * moment the session's gate reopens at Stop.
     *
     * Every engine-spelled write in this bridge goes through here, so there is
     * one place that knows a Levain device has two carriers.
     */
    function setRuntimeParam(target: LevainWriteTarget, rustKey: string, value: number): void {
        activeDevices.get(target.deviceId)?.setParam(rustKey, value);
        deps.writeNativeBuiltinParameters(target.trackId, target.deviceId, { [rustKey]: value });
    }

    /**
     * One controller gesture to both carriers of the strip.
     *
     * The twin of [`setRuntimeParam`] for the messages that are not parameters:
     * a continuous controller reaches the instrument through its own controller
     * surface on either carrier, so a macro bound to one is sent twice for the
     * same reason a parameter is — the natively carried strip sounds it, and
     * the Web Audio node holds it for the moment the session's gate reopens.
     *
     * `value` is the raw 7-bit byte, which is the only scale either surface
     * reads: the instrument divides expression and dynamics by full scale
     * itself, so a normalized fraction sent here would land as near silence.
     * Channel 0, because a macro is moved by the panel rather than played on a
     * channel, and the body applies a controller to the whole instrument.
     */
    function sendCc(target: LevainWriteTarget, controller: number, value: number): void {
        activeDevices.get(target.deviceId)?.handleCc(controller, value);
        void deps.sendNativeLiveMidiControl({
            trackId: target.trackId,
            deviceId: target.deviceId,
            controller,
            value,
            channel: 0,
        });
    }

    function flushParam(compositeKey: string, value: number): void {
        const parts = compositeKey.split(':');
        const deviceId = parts[0];
        if (!deviceId) {
            return;
        }
        pendingKeysByDevice.get(deviceId)?.delete(compositeKey);
        const target = deps.resolveEligibleDeviceWriteTarget(deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        const rustKey = parts.slice(1).join(':');
        setRuntimeParam(target, rustKey, value);
        deps.persistDeviceParam(deviceId, getLevainProjectParameterId(rustKey), value);
    }

    function queueParam(deviceId: string, rustKey: string, value: number): void {
        const compositeKey = `${deviceId}:${rustKey}`;
        let keys = pendingKeysByDevice.get(deviceId);
        if (!keys) {
            keys = new Set<string>();
            pendingKeysByDevice.set(deviceId, keys);
        }
        keys.add(compositeKey);
        paramBatcher.schedule(compositeKey, value, flushParam);
    }

    async function followCurrentSampleLoad(operation: SampleLoadOperation): Promise<LevainSampleLoadOutcome> {
        let current = operation;
        let outcome = await current.completion;
        while (outcome === 'cancelled' && current.successor) {
            current = current.successor;
            outcome = await current.completion;
        }
        return outcome;
    }

    function loadSamplesForInstrument(deviceId: string, instrumentId: string): Promise<LevainSampleLoadOutcome> {
        const target = deps.resolveEligibleDeviceWriteTarget(deviceId);
        if (target.status !== 'eligible') {
            return Promise.resolve('cancelled');
        }

        const port = activePorts.get(deviceId);
        if (!port) {
            return Promise.resolve('failed');
        }

        // A new load starting immediately invalidates whatever bank the panel
        // last showed — the Stage card must stop rendering the previous bank's
        // mic rows while this one is in flight, not carry them over stale. This
        // is the only route that writes `loadedMicPositions`: the offline export
        // route drives the same loader with the live device's id and must never
        // touch the live panel's rows (see `autoLoadLevainSamples`'s own comment).
        // A rejected load never commits: the worklet only aborts the *pending*
        // bank, so the previously committed bank keeps sounding. The rejection
        // branch below restores these kept names rather than leaving the panel
        // on the transient null.
        const previousMicPositions = levainStore.value?.[deviceId]?.loadedMicPositions ?? null;
        deps.setLoadedMicPositions(deviceId, null);

        const controller = new AbortController();
        const sampleLoad = deps.autoLoadLevainSamples(deviceId, port, instrumentId, controller.signal);
        const observedLoad = sampleLoad.then<LevainSampleLoadOutcome, LevainSampleLoadOutcome>(
            (micPositions) => {
                // A superseding load already owns the UI; don't set names over it.
                if (controller.signal.aborted) {
                    return 'cancelled';
                }
                deps.setLoadedMicPositions(deviceId, micPositions);
                return 'ready';
            },
            (error) => {
                if (controller.signal.aborted) {
                    return 'cancelled';
                }
                logger.warn(`[LevainBridge] Sample load failed for device ${deviceId}:`, error);
                // Restore the previously committed bank's names: the engine
                // kept sounding it, so the panel's rows must match.
                deps.setLoadedMicPositions(deviceId, previousMicPositions);
                return 'failed';
            }
        );
        const { promise: aborted, resolve: resolveAborted } = Promise.withResolvers<LevainSampleLoadOutcome>();
        function onAbort(): void {
            resolveAborted('cancelled');
        }
        controller.signal.addEventListener('abort', onAbort, { once: true });
        const completion = Promise.race([observedLoad, aborted]).finally(() => {
            controller.signal.removeEventListener('abort', onAbort);
        });
        const operation: SampleLoadOperation = { controller, completion };
        const previous = loadOperations.get(deviceId);
        if (previous) {
            previous.successor = operation;
            previous.controller.abort();
        }
        loadOperations.set(deviceId, operation);
        void completion.then(() => {
            if (loadOperations.get(deviceId) === operation) {
                loadOperations.delete(deviceId);
            }
            return undefined;
        });
        return followCurrentSampleLoad(operation);
    }

    function registerLevainDevice(
        deviceId: string,
        device: LevainDevice,
        port?: MessagePort
    ): Promise<LevainSampleLoadOutcome> {
        const target = deps.resolveEligibleDeviceWriteTarget(deviceId);
        if (target.status !== 'eligible') {
            return Promise.resolve('cancelled');
        }

        activeDevices.set(deviceId, device);
        let contentSettlement: Promise<LevainSampleLoadOutcome> = Promise.resolve('failed');
        if (port) {
            activePorts.set(deviceId, port);
            // Seed a store entry on first registration so newly-added devices get
            // their instrument's samples loaded — without this the worklet has no
            // zones and produces silence until the user opens the panel and changes
            // presets.
            //
            // Project truth first, module default only for a device that has never
            // been pointed at an instrument. A reload wipes this store, so reading
            // the default here unconditionally is what made every saved Levain track
            // come back as violin-1.
            const instances = levainStore.value ?? {};
            const state = instances[deviceId] ?? hydrateLevainStateFromProject(deviceId) ?? defaultLevainState;
            if (!instances[deviceId]) {
                levainStore.set({ ...instances, [deviceId]: state });
            }

            for (const parameter of projectLevainPatchToEngineParameters(state.patch)) {
                setRuntimeParam(target, parameter.name, parameter.value);
            }
            contentSettlement = loadSamplesForInstrument(deviceId, state.patch.instrumentId);
        }
        return contentSettlement;
    }

    function unregisterLevainDevice(deviceId: string): void {
        activeDevices.delete(deviceId);
        activePorts.delete(deviceId);
        // Cancel any in-flight sample load so it can't write back to a store
        // entry we're about to delete (the store mutators also no-op on a
        // missing device, but cancelling avoids the wasted decode work).
        loadOperations.get(deviceId)?.controller.abort();
        loadOperations.delete(deviceId);

        // Cancel this device's pending rAF batches by their deterministic keys.
        // The `activeDevices` miss already guards `device.setParam`, but
        // `persistDeviceParam` in `flushParam` is unconditional — a batch scheduled
        // before teardown would otherwise persist a stale param to project truth
        // for a device that no longer exists.
        const pendingKeys = pendingKeysByDevice.get(deviceId);
        if (pendingKeys) {
            for (const key of pendingKeys) {
                paramBatcher.cancel(key);
            }
            pendingKeysByDevice.delete(deviceId);
        }

        const state = levainStore.value;
        if (state && state[deviceId]) {
            const next = { ...state };
            delete next[deviceId];
            levainStore.set(next);
        }
    }
    function setLevainParamWithAudio<TKey extends keyof LevainPatch>(
        deviceId: string,
        key: TKey,
        value: LevainPatch[TKey]
    ): void {
        const target = deps.resolveEligibleDeviceWriteTarget(deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        if (key === 'currentArticulation' && isArticulationType(value)) {
            // `setCurrentArticulation`, not the generic setter: it also resolves
            // `currentArticulationDisplay` from the patch entry, which is what the
            // panel's "Artic" readout renders.
            setCurrentArticulation(deviceId, value);
            setRuntimeParam(target, 'current_articulation', getArticulationId(value));
            return;
        }

        setLevainParam(deviceId, key, value);

        if (typeof value === 'number') {
            const rustKey = camelToSnake(String(key));
            queueParam(deviceId, rustKey, value);
        } else {
            const maybeObject: unknown = value;
            if (typeof maybeObject !== 'object' || maybeObject === null) {
                return;
            }

            for (const [childKey, childVal] of Object.entries(maybeObject)) {
                if (typeof childVal === 'number') {
                    const rustKey = `${camelToSnake(String(key))}_${camelToSnake(childKey)}`;
                    queueParam(deviceId, rustKey, childVal);
                } else if (typeof childVal === 'boolean') {
                    const rustKey = `${camelToSnake(String(key))}_${camelToSnake(childKey)}`;
                    queueParam(deviceId, rustKey, childVal ? 1.0 : 0.0);
                }
            }
        }
    }

    // Macros are fire-and-forget performance gestures. The authoritative,
    // persisted state is the macro *position* itself (`patch.macros[index]`,
    // written by `setMacro` below and rendered by the panel's macro strip). The
    // per-engine effects a macro fans out to (CC gestures via `handleCc`; the
    // 'humanize'/'mic_*_volume'/'tone'/'attack'/'release' slots via
    // `setRuntimeParam`) are deliberately NOT mirrored back into the individual
    // `patch.micPositions` / `patch.humanize` store fields, and are not routed
    // through `persistDeviceParam`: a macro is a many-to-one control whose
    // inverse onto discrete patch fields is not well-defined (e.g. Space drives
    // two mic volumes; Tightness is `1 - value`). Reopening the panel therefore
    // shows the pre-macro per-field values while the macro knob retains its set
    // position. Use the granular controls (`setLevainParamWithAudio`) when a
    // change must be reflected and persisted per field.
    function setMacroWithAudio(deviceId: string, index: number, value: number): void {
        const target = deps.resolveEligibleDeviceWriteTarget(deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        setMacro(deviceId, index, value);

        const state = levainStore.value?.[deviceId];
        if (!state) {
            return;
        }

        const label = state.patch.macroLabels[index];
        switch (label) {
            // The three gestures every carrier reads as a controller rather
            // than as a parameter: dynamics, expression and vibrato are the
            // instrument's own continuous controllers, so they travel the
            // controller door on both carriers while the slots below travel
            // the parameter one.
            case 'Dynamics':
                sendCc(target, 1, Math.round(value * 127));
                break;
            case 'Expression':
                sendCc(target, 11, Math.round(value * 127));
                break;
            case 'Vibrato':
                sendCc(target, 2, Math.round(value * 127));
                break;
            case 'Tightness':
                setRuntimeParam(target, 'humanize', 1.0 - value);
                break;
            case 'Space': {
                // The room mic is whichever loaded index carries the 'room'
                // position type — not a fixed index, since a bank's mic order
                // is author-defined and most shipped banks carry no room mic
                // at all. The compact MicBlendSlider resolves the same way, so
                // both controls always agree on which index is 'room'.
                const loadedMicPositions = state.loadedMicPositions;
                const roomIndex = loadedMicPositions ? loadedMicPositions.indexOf('room') : -1;
                if (roomIndex === -1) {
                    // No loaded room mic: nothing for Space to blend toward.
                    break;
                }
                const closeIndex = loadedMicPositions ? loadedMicPositions.indexOf('close') : -1;
                if (closeIndex !== -1) {
                    setRuntimeParam(target, `mic_${closeIndex}_volume`, 1.0 - value * 0.5);
                }
                setRuntimeParam(target, `mic_${roomIndex}_volume`, value);
                break;
            }
            case 'Tone':
                setRuntimeParam(target, 'tone', value);
                break;
            case 'Attack':
                setRuntimeParam(target, 'attack', value);
                break;
            case 'Release':
                setRuntimeParam(target, 'release', value);
                break;
            case undefined:
            default:
                break;
        }
    }

    /**
     * Push a whole patch to the engine, the way registration and offline render do.
     *
     * Loading an instrument replaces every patch field at once, and forwarding a
     * hand-listed subset is what let the engine keep the previous instrument's mic
     * mix and articulation while the panel showed the new instrument's defaults.
     * Sharing `projectLevainPatchToEngineParameters` with the other two paths means
     * a field added to the patch cannot be forgotten by only one of them.
     *
     * Unlike registration this persists, because it is a user edit rather than a
     * replay of what was already saved. `current_articulation` is the exception:
     * articulation identity rides `Device.deviceState` (committed by
     * `initLevainDeviceStatePersistence`), so persisting the engine id here would
     * write a second, competing source of truth for the same choice.
     */
    function applyPatchToEngine(deviceId: string, patch: LevainPatch): void {
        const target = deps.resolveEligibleDeviceWriteTarget(deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        for (const { name, value } of projectLevainPatchToEngineParameters(patch)) {
            if (name === 'current_articulation') {
                setRuntimeParam(target, name, value);
                continue;
            }
            queueParam(deviceId, name, value);
        }
    }

    function sendMicParamToEngine(deviceId: string, micIndex: number, param: string, value: number): void {
        const target = deps.resolveEligibleDeviceWriteTarget(deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        queueParam(deviceId, `mic_${micIndex}_${param}`, value);
    }

    return {
        registerLevainDevice,
        unregisterLevainDevice,
        loadSamplesForInstrument,
        setLevainParamWithAudio,
        setMacroWithAudio,
        sendMicParamToEngine,
        applyPatchToEngine,
    };
}

export type LevainBridgeApi = ReturnType<typeof createLevainBridge>;
