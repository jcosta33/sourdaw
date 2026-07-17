import { chordTrackStore } from '#/modules/MIDI/stores';

type ChordQuality =
    | 'major'
    | 'minor'
    | 'dim'
    | 'aug'
    | 'sus2'
    | 'sus4'
    | '7'
    | 'maj7'
    | 'min7'
    | 'dim7'
    | 'aug7'
    | '6'
    | 'min6'
    | '9'
    | 'add9'
    | 'min9'
    | '7sus4';

type ChordSpec = { root: number; quality: ChordQuality; duration: number };

type SetChordProgressionInput = {
    chords: ChordSpec[];
    repeatUntilBeat: number;
};

export function setChordProgression(input: SetChordProgressionInput): void {
    if (input.chords.length === 0) {
        chordTrackStore.set({ enabled: true, events: [] });
        return;
    }
    const events = [];
    let beat = 0;
    let progressionIndex = 0;
    while (beat < input.repeatUntilBeat) {
        const chord = input.chords[progressionIndex % input.chords.length]!;
        const duration = Math.min(chord.duration, input.repeatUntilBeat - beat);
        events.push({
            id: `chord-${crypto.randomUUID()}`,
            beat,
            root: chord.root % 12,
            quality: chord.quality,
            duration,
        });
        beat += chord.duration;
        progressionIndex += 1;
    }
    chordTrackStore.set({ enabled: true, events });
}
