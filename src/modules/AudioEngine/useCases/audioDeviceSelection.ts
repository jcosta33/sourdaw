import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { audioEngine } from '#/modules/AudioEngine/repositories/audioEngineInstance';

const logger = Container.getInstance().get(Logger);

export type AudioDeviceInfo = {
    id: string;
    label: string;
    kind: 'audioinput' | 'audiooutput';
};

type AudioDeviceSnapshot = {
    selectedOutputId: string | null;
    selectedInputId: string | null;
};

let selectedOutputId: string | null = null;
let selectedInputId: string | null = null;
const listeners = new Set<() => void>();

let cachedSnapshot: AudioDeviceSnapshot = {
    selectedOutputId: null,
    selectedInputId: null,
};

function buildSnapshot(): AudioDeviceSnapshot {
    if (cachedSnapshot.selectedOutputId !== selectedOutputId || cachedSnapshot.selectedInputId !== selectedInputId) {
        cachedSnapshot = { selectedOutputId, selectedInputId };
    }
    return cachedSnapshot;
}

function notify(): void {
    buildSnapshot();
    for (const cb of listeners) {
        cb();
    }
}

export async function getAudioDevices(): Promise<AudioDeviceInfo[]> {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices
            .filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput')
            .map((d) => ({
                id: d.deviceId,
                label: d.label || `Device ${d.deviceId.slice(0, 8)}`,
                kind: d.kind as 'audioinput' | 'audiooutput',
            }));
    } catch (error) {
        logger.warn(`Failed to enumerate audio devices: ${error}`);
        return [];
    }
}

export async function setOutputDevice(deviceId: string): Promise<void> {
    if ('setSinkId' in audioEngine.context) {
        try {
            await (audioEngine.context as unknown as { setSinkId(id: string): Promise<void> }).setSinkId(deviceId);
        } catch (error) {
            logger.warn(`Failed to set output device: ${error}`);
        }
    }
    selectedOutputId = deviceId;
    notify();
}

export function setInputDevice(deviceId: string): void {
    selectedInputId = deviceId;
    notify();
}

export function getSelectedInputId(): string | null {
    return selectedInputId;
}

export function subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => {
        listeners.delete(cb);
    };
}

export function getSnapshot(): AudioDeviceSnapshot {
    return buildSnapshot();
}
