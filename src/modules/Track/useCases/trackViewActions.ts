/**
 * Track View Actions — use case wrappers for cross-module calls
 * used by Track presentation views.
 */

// ── Workspace ─────────────────────────────────────────────────────
import { setWorkspaceMode as _setWorkspaceMode } from '#/modules/Workspace/useCases/setWorkspaceMode';
import { type Preferences, defaultPreferences } from '#/modules/Workspace/useCases/workspaceQueries';

export type { Preferences };
export { defaultPreferences };

export const setWorkspaceMode = (mode: Parameters<typeof _setWorkspaceMode>[0]): void =>
    _setWorkspaceMode(mode);

// ── AudioEngine ───────────────────────────────────────────────────
import {
    getAudioDevices as _getAudioDevices,
    type AudioDeviceInfo,
} from '#/modules/AudioEngine/useCases/audioDeviceSelection';
import { setTrackMute as _setTrackMute } from '#/modules/AudioEngine/useCases/trackAudioControls';
import { decodeAudioFile as _decodeAudioFile } from '#/modules/AudioEngine/useCases/decodeAudioFile';

export const getAudioDevices = (): Promise<AudioDeviceInfo[]> => _getAudioDevices();
export type { AudioDeviceInfo };

export const engineSetTrackMute = (trackId: string, muted: boolean, restoreGain?: number): void =>
    _setTrackMute(trackId, muted, restoreGain);
export const decodeAudioFile = (file: File): Promise<{ id: string; buffer: AudioBuffer }> => _decodeAudioFile(file);
