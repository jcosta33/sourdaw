import {
    type AudioDeviceInfo,
    decodeAudioFile as decodeAudioFileImpl,
    getAudioDevices as getAudioDevicesImpl,
} from '#/modules/AudioEngine/useCases';
import { setWorkspaceMode as setWorkspaceModeImpl } from '#/modules/Workspace/useCases';

export type { AudioDeviceInfo };

export function setWorkspaceMode(...args: Parameters<typeof setWorkspaceModeImpl>) {
    return setWorkspaceModeImpl(...args);
}

export async function getAudioDevices(): Promise<AudioDeviceInfo[]> {
    return getAudioDevicesImpl();
}

export function decodeAudioFile(...args: Parameters<typeof decodeAudioFileImpl>) {
    return decodeAudioFileImpl(...args);
}
