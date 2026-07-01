import { type GeneratedNote } from '../../models/GeneratedNote';

import { invokeAI } from './invokeAI';

export type MidiGenerationResult = {
    notes: GeneratedNote[];
    model_used: string;
    generation_time_ms: number;
};

export async function generateMidiAI(
    seedNotes: Array<[number, number, number, number]>,
    targetNotes = 16,
    temperature = 0.8,
    topK = 40
): Promise<MidiGenerationResult> {
    return (await invokeAI('generate_midi_ai', {
        request: {
            seed_notes: seedNotes,
            target_notes: targetNotes,
            temperature,
            top_k: topK,
        },
    })) as MidiGenerationResult;
}
