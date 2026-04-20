import { audioEngine } from '../../repositories/createWebAudioEngine';

/**
 * Register a global tuning table with the engine.
 * This table will be used for built-in microtonal pitch shifting (Knead)
 * and broadcast to external plugins via MTS-ESP.
 */
export function registerTuningTable(frequencies: number[]): void {
    if (frequencies.length !== 128) {
        throw new Error('Tuning table must contain exactly 128 frequencies');
    }

    // 1. Update the Web Audio Engine (for Knead/Built-ins)
    audioEngine.registerTuningTable(frequencies);

    // 2. Update the Native Engine (for MTS-ESP)
    // In a real implementation, we would call a Tauri command here:
    // invoke('update_native_tuning_table', { frequencies });
}
