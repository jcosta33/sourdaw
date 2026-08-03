import { logger } from '#/infra/logger/appLogger';
import {
    type Track,
    type persistDeviceParam,
    type resolveEligibleDeviceWriteTarget,
} from '#/modules/Arrangement/stores';
import { createRafBatcher } from '#/utils/DOM/createRafBatcher';

import { getArticulationId, isArticulationType, type LevainPatch } from '../../models/LevainPatch';
import { defaultLevainState, levainStore, setLevainParam, setMacro } from '../../stores/levainStore';
import { type autoLoadLevainSamples } from '../autoLoadSamples';
import { hydrateLevainStateFromProject } from '../hydrateLevainStateFromProject';

import { camelToSnake } from './camelToSnake';

export type LevainDevice = {
    setParam: (name: string, value: number) => void;
    handleCc: (cc: number, value: number) => void;
    setInstrument?: (instrumentId: string) => void;
};

export type LevainBridgeDeps = {
    getAllTracks: () => Track[];
    persistDeviceParam: typeof persistDeviceParam;
    autoLoadLevainSamples: typeof autoLoadLevainSamples;
    resolveEligibleDeviceWriteTarget: typeof resolveEligibleDeviceWriteTarget;
};

export function createLevainBridge(deps: LevainBridgeDeps) {
    const activeDevices = new Map<string, LevainDevice>();
    const activePorts = new Map<string, MessagePort>();
    // Per-device load cancellation. A new instrument load for a device aborts
    // the previous one so the last-started load — not the last-finishing one —
    // wins the worklet zone map and the UI progress.
    const loadControllers = new Map<string, AbortController>();

    // §33.2 — Shared rAF-batch primitive. Last-write-wins per rustKey,
    // coalesced into one flush per animation frame.
    // Modified to include deviceId in the flush param.
    // We can use a composite key for the batcher: `${deviceId}:${rustKey}`
    const paramBatcher = createRafBatcher<number>();
    // Track which composite keys are currently pending per device so teardown
    // can cancel exactly this device's batches. The batcher does not expose its
    // key set, so we mirror it here; entries are dropped on flush and on cancel.
    const pendingKeysByDevice = new Map<string, Set<string>>();
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
        const device = activeDevices.get(deviceId);
        if (device) {
            device.setParam(rustKey, value);
        }
        deps.persistDeviceParam(deviceId, rustKey, value);
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

    function getDevice(deviceId: string): LevainDevice | undefined {
        return activeDevices.get(deviceId);
    }

    function loadSamplesForInstrument(deviceId: string, instrumentId: string): void {
        const target = deps.resolveEligibleDeviceWriteTarget(deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        // Tell the engine which instrument it now is, so the realism layer
        // (body modes, sympathetic strings, breath/bow noise) reconfigures.
        activeDevices.get(deviceId)?.setInstrument?.(instrumentId);
        const port = activePorts.get(deviceId);
        if (!port) {
            return;
        }
        // Supersede any in-flight load for this device before starting a new one.
        loadControllers.get(deviceId)?.abort();
        const controller = new AbortController();
        loadControllers.set(deviceId, controller);
        deps.autoLoadLevainSamples(deviceId, port, instrumentId, controller.signal)
            .finally(() => {
                // Only clear the slot if it's still ours — a newer load may have
                // already replaced it.
                if (loadControllers.get(deviceId) === controller) {
                    loadControllers.delete(deviceId);
                }
            })
            .catch((error) => {
                logger.warn(`[LevainBridge] Sample load failed for device ${deviceId}:`, error);
            });
    }

    function registerLevainDevice(deviceId: string, device: LevainDevice, port?: MessagePort): void {
        const target = deps.resolveEligibleDeviceWriteTarget(deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        activeDevices.set(deviceId, device);
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

            loadSamplesForInstrument(deviceId, state.patch.instrumentId);
            queueParam(deviceId, 'master_gain', state.patch.masterGain);
            queueParam(deviceId, 'current_articulation', getArticulationId(state.patch.currentArticulation));
            queueParam(deviceId, 'legato_enabled', state.patch.legato.enabled ? 1 : 0);
            queueParam(deviceId, 'humanize_amount', state.patch.humanize.amount);
            // vibratoDepthMax is in cents (default 40, range 0-50). Send it to the
            // cents slot 'expression_vibrato_depth_max' — the same key the runtime
            // panel path uses (setLevainParamWithAudio expands expression.vibratoDepthMax
            // to this key). The CC-scaled slot 'vibrato_depth' expects a normalized
            // 0-1 value and would saturate a cents value to ~2x configured depth.
            queueParam(deviceId, 'expression_vibrato_depth_max', state.patch.expression.vibratoDepthMax);

            for (const [i, m] of state.patch.micPositions.entries()) {
                queueParam(deviceId, `mic_${i}_volume`, m.volume);
                queueParam(deviceId, `mic_${i}_pan`, m.pan);
                queueParam(deviceId, `mic_${i}_enabled`, m.enabled ? 1 : 0);
            }
        }
    }

    function unregisterLevainDevice(deviceId: string): void {
        activeDevices.delete(deviceId);
        activePorts.delete(deviceId);
        // Cancel any in-flight sample load so it can't write back to a store
        // entry we're about to delete (the store mutators also no-op on a
        // missing device, but cancelling avoids the wasted decode work).
        loadControllers.get(deviceId)?.abort();
        loadControllers.delete(deviceId);

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

        setLevainParam(deviceId, key, value);

        if (key === 'currentArticulation' && isArticulationType(value)) {
            queueParam(deviceId, 'current_articulation', getArticulationId(value));
        } else if (typeof value === 'number') {
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
    // `device.setParam`) are deliberately NOT mirrored back into the individual
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

        const device = getDevice(deviceId);
        if (!device) {
            return;
        }

        const state = levainStore.value?.[deviceId];
        if (!state) {
            return;
        }

        const label = state.patch.macroLabels[index];
        switch (label) {
            case 'Dynamics':
                device.handleCc(1, Math.round(value * 127));
                break;
            case 'Expression':
                device.handleCc(11, Math.round(value * 127));
                break;
            case 'Vibrato':
                device.handleCc(2, Math.round(value * 127));
                break;
            case 'Tightness':
                device.setParam('humanize', 1.0 - value);
                break;
            case 'Space':
                // The room mic is the 'room'-type position (index 2 in the default
                // patch). The compact MicBlendSlider drives the same mic, so both
                // controls must target the same index or they fight over 'room'.
                device.setParam('mic_0_volume', 1.0 - value * 0.5);
                device.setParam('mic_2_volume', value);
                break;
            case 'Tone':
                device.setParam('tone', value);
                break;
            case 'Attack':
                device.setParam('attack', value);
                break;
            case 'Release':
                device.setParam('release', value);
                break;
            case undefined:
            default:
                break;
        }
    }

    function sendMicParamToEngine(deviceId: string, micIndex: number, param: string, value: number): void {
        const target = deps.resolveEligibleDeviceWriteTarget(deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        const device = getDevice(deviceId);
        if (device) {
            device.setParam(`mic_${micIndex}_${param}`, value);
        }
    }

    return {
        registerLevainDevice,
        unregisterLevainDevice,
        loadSamplesForInstrument,
        setLevainParamWithAudio,
        setMacroWithAudio,
        sendMicParamToEngine,
    };
}

export type LevainBridgeApi = ReturnType<typeof createLevainBridge>;
