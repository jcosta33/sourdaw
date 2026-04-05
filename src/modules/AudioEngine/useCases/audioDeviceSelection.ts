/**
 * Audio device selection — input/output device management.
 *
 * Note: setSinkId cast is needed until lib.dom.d.ts ships the type.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { audioEngine } from '#/modules/AudioEngine/repositories/createWebAudioEngine';

const logger = Container.getInstance().get(Logger);

export type AudioDeviceInfo = {
    id: string;
    label: string;
    kind: 'audioinput' | 'audiooutput';
};

type AudioDeviceState = {
    selectedOutputId: string | null;
    selectedInputId: string | null;
};

export const audioDeviceStore = new Store<AudioDeviceState>(logger, {
    initialData: {
        selectedOutputId: null,
        selectedInputId: null,
    },
});

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
    const current = audioDeviceStore.value;
    audioDeviceStore.set({ ...current!, selectedOutputId: deviceId });
}

export function setInputDevice(deviceId: string): void {
    const current = audioDeviceStore.value;
    audioDeviceStore.set({ ...current!, selectedInputId: deviceId });
}

export function getSelectedInputId(): string | null {
    return audioDeviceStore.value?.selectedInputId ?? null;
}
