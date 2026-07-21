import { LEGACY_MIDI_PROBABILITY_SEED, midiStore } from '../stores/midiStore';

type ResetMidiStoreForProjectInput = {
    generateProbabilitySeed?: boolean;
};

function generateProbabilitySeed(): number {
    const seed = new Uint32Array(1);
    crypto.getRandomValues(seed);
    return seed[0] ?? 0;
}

export function resetMidiStoreForProject({
    generateProbabilitySeed: shouldGenerateProbabilitySeed = false,
}: ResetMidiStoreForProjectInput = {}): void {
    let probabilitySeed = LEGACY_MIDI_PROBABILITY_SEED;
    if (shouldGenerateProbabilitySeed) {
        probabilitySeed = generateProbabilitySeed();
    }

    midiStore.set({
        probabilitySeed,
        notesByClipId: {},
        ccByClipId: {},
        pitchBendByClipId: {},
    });
}
