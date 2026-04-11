import { processAudioIPC as processAudioIPCRepo } from '../../repositories/pluginBridge/processAudioIPC';

/**
 * Process an audio block through a plugin instance (IPC bridge).
 * Sends Float32Array to Rust and returns processed audio.
 */
export function processAudioIPC(instanceId: string, audioData: Float32Array): ReturnType<typeof processAudioIPCRepo> {
    return processAudioIPCRepo(instanceId, audioData);
}