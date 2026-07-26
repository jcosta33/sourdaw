import { processAudioIPC as processAudioIPCRepo } from '../../repositories/pluginBridge/processAudioIPC';

/**
 * Process an audio block through a plugin instance (IPC bridge).
 * Sends raw audio bytes to Rust and returns processed bytes when available.
 */
type ProcessAudioIPCInput = {
    instanceId: string;
    audioBytes: Uint8Array;
};

type ProcessAudioIPCOutput = Promise<Uint8Array | null>;

export function processAudioIPC(input: ProcessAudioIPCInput): ProcessAudioIPCOutput {
    return processAudioIPCRepo(input);
}
