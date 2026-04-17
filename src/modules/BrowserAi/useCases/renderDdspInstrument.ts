/**
 * Use case: Render DDSP instrument audio from MIDI.
 *
 * DDSP instrument synthesis is not available in the browser build.
 * The Levain sample-based engine provides higher-quality instrument playback.
 * This stub is retained for API compatibility.
 */

import { type MidiNote } from '../services/midiToDdspInput';
import { type RenderProvenance } from '../models/RenderProgress';

type RenderDdspInstrumentInput = {
    phraseId: string;
    modelId: string;
    modelUrl: string;
    notes: MidiNote[];
    durationSec: number;
};

type RenderDdspInstrumentOutput = Promise<{
    audio: Float32Array;
    sampleRate: number;
    provenance: RenderProvenance;
}>;

export async function renderDdspInstrument(_input: RenderDdspInstrumentInput): RenderDdspInstrumentOutput {
    throw new Error(
        'DDSP instrument synthesis is not available in this build. ' +
        'Use the Levain instrument engine for MIDI playback.'
    );
}
