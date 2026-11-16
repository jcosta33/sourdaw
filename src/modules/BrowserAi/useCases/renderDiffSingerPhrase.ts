import { type RenderProvenance, type RenderQuality } from '../models/RenderProgress';
import { type MidiNote } from '../services/midiToDdspInput';

type RenderDiffSingerPhraseInput = {
    phraseId: string;
    voicebankId: string;
    lyrics: string;
    notes: MidiNote[];
    phonemeToId?: Record<string, number>;
    renderQuality?: RenderQuality;
    depth?: number;
    speakerEmbed?: Float32Array;
    seed?: number;
};

type RenderDiffSingerPhraseOutput = Promise<{
    audio: Float32Array;
    sampleRate: number;
    provenance: RenderProvenance;
}>;

export function renderDiffSingerPhrase(_input: RenderDiffSingerPhraseInput): RenderDiffSingerPhraseOutput {
    return Promise.reject(new Error('Singing synthesis is unavailable until a compatible vocoder is admitted.'));
}
