import { addTrack, getTrackStoreState } from '#/modules/Arrangement/useCases';
import { getTransportState } from '#/modules/Transport/useCases';

export const VALID_DRUM_STYLES: ReadonlySet<string> = new Set([
    'four-on-floor',
    'breakbeat',
    'trap',
    'jazz',
    'latin',
    'rock',
    'dnb',
    'half-time',
]);

export const VALID_MELODY_STYLES: ReadonlySet<string> = new Set([
    'simple',
    'arpeggiated',
    'stepwise',
    'rhythmic',
    'ambient',
]);

export const VALID_SCALES: ReadonlySet<string> = new Set([
    'major',
    'minor',
    'pentatonic',
    'minor-pentatonic',
    'blues',
    'dorian',
    'mixolydian',
]);

export const VALID_CHORD_STYLES: ReadonlySet<string> = new Set([
    'pop',
    'jazz',
    'classical',
    'edm',
    'blues',
    'rnb',
    'folk',
    'cinematic',
]);

export const VALID_VOICINGS: ReadonlySet<string> = new Set(['close', 'open', 'spread', 'power']);

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
        const selected = state?.tracks.find((t) => t.id === selectedId);
        if (selected && selected.kind === 'midi') {
            return selectedId;
        }
    }

    const firstMidi = state?.tracks.find((t) => t.kind === 'midi');
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
