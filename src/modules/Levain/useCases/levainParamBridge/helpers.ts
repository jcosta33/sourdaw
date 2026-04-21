import { logger } from '#/infra/logger/appLogger';
import { type persistDeviceParam, type getAllTracks } from '#/modules/Arrangement/useCases';
import { createRafBatcher } from '#/utils/DOM/createRafBatcher';

import { type LevainPatch } from '../../models/LevainPatch';
import { levainStore, setLevainParam, setMacro } from '../../stores/levainStore';
import { type autoLoadLevainSamples } from '../autoLoadSamples';

export type LevainDevice = {
    setParam: (name: string, value: number) => void;
    handleCc: (cc: number, value: number) => void;
    setInstrument?: (instrumentId: string) => void;
};

export type LevainBridgeDeps = {
    getAllTracks: typeof getAllTracks;
    persistDeviceParam: typeof persistDeviceParam;
    autoLoadLevainSamples: typeof autoLoadLevainSamples;
};

export function camelToSnake(str: string): string {
    return str.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function createLevainBridge(deps: LevainBridgeDeps) {
    const activeDevices = new Map<string, LevainDevice>();
    const activePorts = new Map<string, MessagePort>();

    // §33.2 — Shared rAF-batch primitive. Last-write-wins per rustKey,
    // coalesced into one flush per animation frame.
    // Modified to include deviceId in the flush param.
    // We can use a composite key for the batcher: `${deviceId}:${rustKey}`
    const paramBatcher = createRafBatcher<number>();
function flushParam(compositeKey: string, value: number): void {
    const parts = compositeKey.split(':');
    const deviceId = parts[0];
    if (!deviceId) return;
    const rustKey = parts.slice(1).join(':');
    const device = activeDevices.get(deviceId);
    if (device) {
        device.setParam(rustKey, value);
    }
    deps.persistDeviceParam(deviceId, rustKey, value);
}

    function queueParam(deviceId: string, rustKey: string, value: number): void {
        paramBatcher.schedule(`${deviceId}:${rustKey}`, value, flushParam);
    }

    function getDevice(deviceId: string): LevainDevice | undefined {
        return activeDevices.get(deviceId);
    }

    function loadSamplesForInstrument(deviceId: string, instrumentId: string): void {
        // Tell the engine which instrument it now is, so the realism layer
        // (body modes, sympathetic strings, breath/bow noise) reconfigures.
        activeDevices.get(deviceId)?.setInstrument?.(instrumentId);
        const port = activePorts.get(deviceId);
        if (!port) {
            return;
        }
        deps.autoLoadLevainSamples(deviceId, port, instrumentId).catch((error) => {
            logger.warn(`[LevainBridge] Sample load failed for device ${deviceId}:`, error);
        });
    }

    function registerLevainDevice(deviceId: string, device: LevainDevice, port?: MessagePort): void {
        activeDevices.set(deviceId, device);
        if (port) {
            activePorts.set(deviceId, port);
            const state = levainStore.value?.[deviceId];
            if (state?.patch) {
                loadSamplesForInstrument(deviceId, state.patch.instrumentId);
                queueParam(deviceId, 'master_gain', state.patch.masterGain);
                queueParam(deviceId, 'legato_enabled', state.patch.legato.enabled ? 1 : 0);
                queueParam(deviceId, 'humanize_amount', state.patch.humanize.amount);
                queueParam(deviceId, 'vibrato_depth', state.patch.expression.vibratoDepthMax);

                for (const [i, m] of state.patch.micPositions.entries()) {
                    queueParam(deviceId, `mic_${i}_volume`, m.volume);
                    queueParam(deviceId, `mic_${i}_pan`, m.pan);
                    queueParam(deviceId, `mic_${i}_enabled`, m.enabled ? 1 : 0);
                }
            }
        }
    }

    function unregisterLevainDevice(deviceId: string): void {
        activeDevices.delete(deviceId);
        activePorts.delete(deviceId);

        const state = levainStore.value;
        if (state && state[deviceId]) {
            const next = { ...state };
            delete next[deviceId];
            levainStore.set(next);
        }

        // We can't cancelAll easily per-device without changing the batcher,
        // but it's okay to let pending updates naturally drop since the device is removed from map.
    }
    function setLevainParamWithAudio<K extends keyof LevainPatch>(deviceId: string, key: K, value: LevainPatch[K]): void {
        setLevainParam(deviceId, key, value);

        if (key === 'currentArticulation' && typeof value === 'string') {
            const patch = levainStore.value?.[deviceId]?.patch;
            if (patch) {
                const artIndex = patch.articulations.findIndex((a) => a.type === value);
                if (artIndex !== -1) {
                    queueParam(deviceId, 'current_articulation', artIndex);
                }
            }
        } else if (typeof value === 'number') {
            const rustKey = camelToSnake(key as string);
            queueParam(deviceId, rustKey, value);
        } else if (typeof value === 'boolean') {
            const rustKey = camelToSnake(key as string);
            queueParam(deviceId, rustKey, value ? 1.0 : 0.0);
        } else if (typeof value === 'object' && value !== null) {
            for (const [childKey, childVal] of Object.entries(value)) {
                if (typeof childVal === 'number') {
                    const rustKey = `${camelToSnake(key as string)}_${camelToSnake(childKey)}`;
                    queueParam(deviceId, rustKey, childVal);
                } else if (typeof childVal === 'boolean') {
                    const rustKey = `${camelToSnake(key as string)}_${camelToSnake(childKey)}`;
                    queueParam(deviceId, rustKey, childVal ? 1.0 : 0.0);
                }
            }
        }
    }

    function setMacroWithAudio(deviceId: string, index: number, value: number): void {
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
                device.setParam('mic_0_volume', 1.0 - value * 0.5);
                device.setParam('mic_1_volume', value);
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
        }
    }

    function sendHumanizeToEngine(deviceId: string, amount: number): void {
        const device = getDevice(deviceId);
        if (device) {
            device.setParam('humanize', amount);
        }
    }

    function sendLegatoEnabledToEngine(deviceId: string, enabled: boolean): void {
        const device = getDevice(deviceId);
        if (device) {
            device.setParam('legato_enabled', enabled ? 1.0 : 0.0);
        }
    }

    function sendMicParamToEngine(deviceId: string, micIndex: number, param: string, value: number): void {
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
        sendHumanizeToEngine,
        sendLegatoEnabledToEngine,
        sendMicParamToEngine,
    };
}

export type LevainBridgeApi = ReturnType<typeof createLevainBridge>;
