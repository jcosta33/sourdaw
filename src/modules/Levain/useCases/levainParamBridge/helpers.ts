import { type LevainPatch } from '../../models/LevainPatch';
import { levainStore, setLevainParam, setMacro } from '../../stores/levainStore';
import { autoLoadLevainSamples } from '../autoLoadSamples';
import { persistDeviceParam, getAllTracks } from '#/modules/Arrangement/useCases';

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
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function createLevainBridge(deps: LevainBridgeDeps) {
    let activeDevice: LevainDevice | null = null;
    let activePort: MessagePort | null = null;
    let activeDeviceId: string | null = null;

    const latestValues = new Map<string, number>();
    const pendingUpdates = new Map<string, number>();

    function flushParam(key: string): void {
        pendingUpdates.delete(key);
        const value = latestValues.get(key);
        if (value === undefined) {
            return;
        }
        latestValues.delete(key);

        const device = getDevice();
        if (device) {
            device.setParam(key, value);
        }
        if (activeDeviceId) {
            deps.persistDeviceParam(activeDeviceId, key, value);
        }
    }

    function queueParam(rustKey: string, value: number): void {
        latestValues.set(rustKey, value);
        if (!pendingUpdates.has(rustKey)) {
            pendingUpdates.set(
                rustKey,
                requestAnimationFrame(() => flushParam(rustKey))
            );
        }
    }

    function getDevice(): LevainDevice | null {
        return activeDevice;
    }

    function loadSamplesForInstrument(instrumentId: string): void {
        // Tell the engine which instrument it now is, so the realism layer
        // (body modes, sympathetic strings, breath/bow noise) reconfigures.
        activeDevice?.setInstrument?.(instrumentId);
        if (!activePort) {
            return;
        }
        deps.autoLoadLevainSamples(activePort, instrumentId).catch((err) => {
            console.warn('[LevainBridge] Sample load failed:', err);
        });
    }

    function registerLevainDevice(device: LevainDevice, port?: MessagePort): void {
        activeDevice = device;
        activeDeviceId = null;
        for (const track of deps.getAllTracks()) {
            const d = track.devices.find((dev) => dev.type === 'levain');
            if (d) {
                activeDeviceId = d.id;
                break;
            }
        }
        if (port) {
            activePort = port;
            const state = levainStore.value;
            if (state?.patch) {
                loadSamplesForInstrument(state.patch.instrumentId);
                queueParam('master_gain', state.patch.masterGain);
                queueParam('legato_enabled', state.patch.legato.enabled ? 1 : 0);
                queueParam('humanize_amount', state.patch.humanize.amount);
                queueParam('vibrato_depth', state.patch.expression.vibratoDepthMax);

                state.patch.micPositions.forEach((m, i) => {
                    queueParam(`mic_${i}_volume`, m.volume);
                    queueParam(`mic_${i}_pan`, m.pan);
                    queueParam(`mic_${i}_enabled`, m.enabled ? 1 : 0);
                });
            }
        }
    }

    function unregisterLevainDevice(): void {
        activeDevice = null;
        activePort = null;
        for (const rafId of pendingUpdates.values()) {
            cancelAnimationFrame(rafId);
        }
        pendingUpdates.clear();
        latestValues.clear();
    }

    function setLevainParamWithAudio<K extends keyof LevainPatch>(key: K, value: LevainPatch[K]): void {
        setLevainParam(key, value);

        if (key === 'currentArticulation' && typeof value === 'string') {
            const patch = levainStore.value?.patch;
            if (patch) {
                const artIndex = patch.articulations.findIndex((a) => a.type === value);
                if (artIndex !== -1) {
                    queueParam('current_articulation', artIndex);
                }
            }
        } else if (typeof value === 'number') {
            const rustKey = camelToSnake(key as string);
            queueParam(rustKey, value);
        } else if (typeof value === 'boolean') {
            const rustKey = camelToSnake(key as string);
            queueParam(rustKey, value ? 1.0 : 0.0);
        } else if (typeof value === 'object' && value !== null) {
            for (const [childKey, childVal] of Object.entries(value)) {
                if (typeof childVal === 'number') {
                    const rustKey = camelToSnake(key as string) + '_' + camelToSnake(childKey);
                    queueParam(rustKey, childVal);
                } else if (typeof childVal === 'boolean') {
                    const rustKey = camelToSnake(key as string) + '_' + camelToSnake(childKey);
                    queueParam(rustKey, childVal ? 1.0 : 0.0);
                }
            }
        }
    }

    function setMacroWithAudio(index: number, value: number): void {
        setMacro(index, value);

        const device = getDevice();
        if (!device) {
            return;
        }

        const state = levainStore.value;
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

    function sendHumanizeToEngine(amount: number): void {
        const device = getDevice();
        if (device) {
            device.setParam('humanize', amount);
        }
    }

    function sendLegatoEnabledToEngine(enabled: boolean): void {
        const device = getDevice();
        if (device) {
            device.setParam('legato_enabled', enabled ? 1.0 : 0.0);
        }
    }

    function sendMicParamToEngine(micIndex: number, param: string, value: number): void {
        const device = getDevice();
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