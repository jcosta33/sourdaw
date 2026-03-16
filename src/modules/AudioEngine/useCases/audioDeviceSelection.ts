import { Container } from "#/helpers/DependencyInjector/Container";
import { Logger } from "#/helpers/Logger/Logger";
import { audioEngine } from "#/modules/AudioEngine/repositories/audioEngineInstance";

const logger = Container.getInstance().get(Logger);

export type AudioDeviceInfo = {
    id: string;
    label: string;
    kind: "audioinput" | "audiooutput";
};

type AudioDeviceSnapshot = {
    selectedOutputId: string | null;
    selectedInputId: string | null;
};

let selectedOutputId: string | null = null;
let selectedInputId: string | null = null;
const listeners = new Set<() => void>();

const notify = (): void => {
    for (const cb of listeners) {
        cb();
    }
};

export const getAudioDevices = async (): Promise<AudioDeviceInfo[]> => {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices
            .filter((d) => d.kind === "audioinput" || d.kind === "audiooutput")
            .map((d) => ({
                id: d.deviceId,
                label: d.label || `Device ${d.deviceId.slice(0, 8)}`,
                kind: d.kind as "audioinput" | "audiooutput",
            }));
    } catch (e) {
        logger.warn(`Failed to enumerate audio devices: ${e}`);
        return [];
    }
};

export const setOutputDevice = async (deviceId: string): Promise<void> => {
    if ("setSinkId" in audioEngine.context) {
        try {
            await (audioEngine.context as unknown as { setSinkId(id: string): Promise<void> }).setSinkId(deviceId);
        } catch (e) {
            logger.warn(`Failed to set output device: ${e}`);
        }
    }
    selectedOutputId = deviceId;
    notify();
};

export const setInputDevice = (deviceId: string): void => {
    selectedInputId = deviceId;
    notify();
};

export const getSelectedOutputId = (): string | null => selectedOutputId;
export const getSelectedInputId = (): string | null => selectedInputId;

export const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb);
    return () => {
        listeners.delete(cb);
    };
};

export const getSnapshot = (): AudioDeviceSnapshot => ({
    selectedOutputId,
    selectedInputId,
});
