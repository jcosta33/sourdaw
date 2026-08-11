import { audioEngine } from '../../repositories/createWebAudioEngine';

/**
 * Register a global tuning table with the engine.
 * This table is applied to currently loaded Fermenter instruments.
 */
export function registerTuningTable(frequencies: number[]): void {
    if (frequencies.length !== 128) {
        throw new Error('Tuning table must contain exactly 128 frequencies');
    }

    audioEngine.registerTuningTable(frequencies);
}
