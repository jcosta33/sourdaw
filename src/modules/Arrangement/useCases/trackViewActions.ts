/**
 * Track View Actions — use case wrappers for cross-module calls from Track presentation views.
 *
 * Each export uses `inject()` so tests can substitute collaborators via `injectDependencies`.
 */

import { inject } from '#/infra/di/inject';
import {
    type AudioDeviceInfo,
    decodeAudioFile as decodeAudioFileImpl,
    getAudioDevices as getAudioDevicesImpl,
} from '#/modules/AudioEngine/useCases';
import { setWorkspaceMode as setWorkspaceModeImpl } from '#/modules/Workspace/useCases';

export type { AudioDeviceInfo };

export const setWorkspaceMode = inject({ setWorkspaceModeImpl })(
    ({ setWorkspaceModeImpl }) =>
        function setWorkspaceMode(...args: Parameters<typeof setWorkspaceModeImpl>) {
            return setWorkspaceModeImpl(...args);
        }
);

export const getAudioDevices = inject({ getAudioDevicesImpl })(
    ({ getAudioDevicesImpl }) =>
        async function getAudioDevices(): Promise<AudioDeviceInfo[]> {
            return getAudioDevicesImpl();
        }
);

export const decodeAudioFile = inject({ decodeAudioFileImpl })(
    ({ decodeAudioFileImpl }) =>
        function decodeAudioFile(...args: Parameters<typeof decodeAudioFileImpl>) {
            return decodeAudioFileImpl(...args);
        }
);
