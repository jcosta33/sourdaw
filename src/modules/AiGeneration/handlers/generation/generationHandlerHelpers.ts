import { type addTrack, type getTrackStoreState } from '#/modules/Arrangement/useCases';
import { getTransportState } from '#/modules/Transport/useCases';

import { type ChordVoicing } from '../../models/GenerationStyles';
import { CHORD_PROGRESSION_STYLES } from '../../useCases/generateChordProgression/algorithm';
import { DRUM_PATTERN_STYLES } from '../../useCases/generateDrumPattern/algorithm';
import { MELODY_STYLES, SCALE_TYPES } from '../../useCases/generateMelody/algorithm';

// Derive the accepted-style sets from the algorithm rosters (their single
// source of truth) rather than re-listing them here. Hand-maintained copies
// drifted out of sync — drum 8/17, chord 8/12, scale 7/14 — so a valid
// selection was silently coerced to the default in `createGenerationHandler`.
// Deriving from the algorithm unions means a new style is accepted the moment
// the algorithm handles it, with no second list to update.
export const VALID_DRUM_STYLES: ReadonlySet<string> = new Set(DRUM_PATTERN_STYLES);

export const VALID_MELODY_STYLES: ReadonlySet<string> = new Set(MELODY_STYLES);

export const VALID_SCALES: ReadonlySet<string> = new Set(SCALE_TYPES);

export const VALID_CHORD_STYLES: ReadonlySet<string> = new Set(CHORD_PROGRESSION_STYLES);

// `ChordVoicing` ('close' | 'open' | 'spread' | 'power') has no runtime roster
// to derive from without importing the algorithm's private switch; the union
// is small and stable. Keep the literal list, typed against the union so it
// fails the build if a voicing is added or renamed.
const VOICING_VALUES = ['close', 'open', 'spread', 'power'] as const satisfies readonly ChordVoicing[];
type VoicingNotListed = Exclude<ChordVoicing, (typeof VOICING_VALUES)[number]>;
const _assertVoicingsCoverUnion: VoicingNotListed extends never ? true : never = true;
void _assertVoicingsCoverUnion;
export const VALID_VOICINGS: ReadonlySet<string> = new Set(VOICING_VALUES);

type MidiTrackDeps = {
    getTrackStoreState: typeof getTrackStoreState;
    addTrack: typeof addTrack;
};

export function resolveOrCreateMidiTrack(
    trackId: string | undefined,
    fallbackName: string,
    deps: MidiTrackDeps
): string | null {
    if (trackId) {
        return trackId;
    }

    const state = deps.getTrackStoreState();
    const selectedId = state?.selectedTrackId;

    if (selectedId) {
        const selected = state?.tracks.find((time) => time.id === selectedId);
        if (selected && selected.kind === 'midi') {
            return selectedId;
        }
    }

    const firstMidi = state?.tracks.find((time) => time.kind === 'midi');
    if (firstMidi) {
        return firstMidi.id;
    }

    const newTrack = deps.addTrack({ name: fallbackName, kind: 'midi' });
    return newTrack?.id ?? null;
}

export function getPlayheadBeat(): number {
    const transport = getTransportState();
    return transport?.playheadPosition ?? 0;
}
