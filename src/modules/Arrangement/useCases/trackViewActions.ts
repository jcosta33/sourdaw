/**
 * Track View Actions — re-exports for cross-module calls from Track presentation views.
 */
export { setWorkspaceMode } from '#/modules/Workspace/useCases/setWorkspaceMode';
export { getAudioDevices, type AudioDeviceInfo } from '#/modules/AudioEngine/useCases/audioDeviceSelection';
export { decodeAudioFile } from '#/modules/AudioEngine/useCases/decodeAudioFile';
