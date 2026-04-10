import { isTauri as detectTauriEnvironment } from '../repositories/nativeAIBridge/isTauri';
import {
    generateMidiAI as generateMidiAIFromNativeBridge,
    type MidiGenerationResult as NativeMidiGenerationResult,
} from '../repositories/nativeAIBridge/midiGeneration';
import { denoiseAudio as denoiseAudioFromNativeBridge } from '../repositories/nativeAIBridge/audioDenoising';

export type MidiGenerationNote = {
    pitch: number;
    velocity: number;
    start_beat: number;
    duration_beats: number;
};

export type MidiGenerationResult = {
    notes: MidiGenerationNote[];
    model_used: NativeMidiGenerationResult['model_used'];
    generation_time_ms: NativeMidiGenerationResult['generation_time_ms'];
};

export type DenoiseResult = {
    samples: number[];
    noise_floor_db: number;
    processing_time_ms: number;
};

/**
 * Public contract for native AI bridge operations.
 */
export function isTauri(): boolean {
    return detectTauriEnvironment();
}

export function generateMidiAI(
    ...args: Parameters<typeof generateMidiAIFromNativeBridge>
): Promise<MidiGenerationResult> {
    return generateMidiAIFromNativeBridge(...args);
}

export function denoiseAudio(
    ...args: Parameters<typeof denoiseAudioFromNativeBridge>
): ReturnType<typeof denoiseAudioFromNativeBridge> {
    return denoiseAudioFromNativeBridge(...args);
}
