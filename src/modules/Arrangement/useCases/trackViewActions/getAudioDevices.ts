import { getAudioDevices as getAudioDevicesImpl } from '#/modules/AudioEngine/useCases';

// Local field-identical copy of AudioEngine's private getAudioDevices() row shape.
type AudioDeviceInfo = { id: string; label: string; kind: 'audioinput' | 'audiooutput' };

export type { AudioDeviceInfo };

export async function getAudioDevices(): Promise<AudioDeviceInfo[]> {
    return getAudioDevicesImpl();
}
