import {
    generateMidiAI as generateMidiAIFromNativeBridge,
    type MidiGenerationResult as NativeMidiGenerationResult,
} from '../../repositories/nativeAIBridge/midiGeneration';

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

export function generateMidiAI(
    ...args: Parameters<typeof generateMidiAIFromNativeBridge>
): Promise<MidiGenerationResult> {
    return generateMidiAIFromNativeBridge(...args);
}
