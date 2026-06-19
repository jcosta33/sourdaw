import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CHORD_PROGRESSION_STYLES } from '../../../useCases/generateChordProgression/algorithm';
import { DRUM_PATTERN_STYLES } from '../../../useCases/generateDrumPattern/algorithm';
import { MELODY_STYLES, SCALE_TYPES } from '../../../useCases/generateMelody/algorithm';
import {
    resolveOrCreateMidiTrack,
    getPlayheadBeat,
    VALID_DRUM_STYLES,
    VALID_MELODY_STYLES,
    VALID_SCALES,
    VALID_CHORD_STYLES,
    VALID_VOICINGS,
} from '../generationHandlerHelpers';

const mocks = vi.hoisted(() => ({
    getTransportState: vi.fn(),
    addTrack: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', () => ({
    getTransportState: mocks.getTransportState,
}));

describe('generationHandlerHelpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('resolveOrCreateMidiTrack', () => {
        const deps = {
            addTrack: mocks.addTrack,
            getTrackStoreState: mocks.getTrackStoreState,
        };

        it('returns provided trackId if given', () => {
            const id = resolveOrCreateMidiTrack('explicit-id', 'Fallback', deps);
            expect(id).toBe('explicit-id');
            expect(mocks.getTrackStoreState).not.toHaveBeenCalled();
            expect(mocks.addTrack).not.toHaveBeenCalled();
        });

        it('returns selected track id if it is a midi track', () => {
            mocks.getTrackStoreState.mockReturnValue({
                selectedTrackId: 't2',
                tracks: [
                    { id: 't1', kind: 'audio' },
                    { id: 't2', kind: 'midi' },
                ],
            });
            const id = resolveOrCreateMidiTrack(undefined, 'Fallback', deps);
            expect(id).toBe('t2');
            expect(mocks.addTrack).not.toHaveBeenCalled();
        });

        it('returns first midi track if selected track is not midi', () => {
            mocks.getTrackStoreState.mockReturnValue({
                selectedTrackId: 't1',
                tracks: [
                    { id: 't1', kind: 'audio' },
                    { id: 't3', kind: 'midi' },
                ],
            });
            const id = resolveOrCreateMidiTrack(undefined, 'Fallback', deps);
            expect(id).toBe('t3');
            expect(mocks.addTrack).not.toHaveBeenCalled();
        });

        it('returns first midi track if no track is selected', () => {
            mocks.getTrackStoreState.mockReturnValue({
                selectedTrackId: null,
                tracks: [
                    { id: 't1', kind: 'audio' },
                    { id: 't3', kind: 'midi' },
                ],
            });
            const id = resolveOrCreateMidiTrack(undefined, 'Fallback', deps);
            expect(id).toBe('t3');
            expect(mocks.addTrack).not.toHaveBeenCalled();
        });

        it('creates a new track if no midi tracks exist', () => {
            mocks.getTrackStoreState.mockReturnValue({
                selectedTrackId: null,
                tracks: [{ id: 't1', kind: 'audio' }],
            });
            mocks.addTrack.mockReturnValue({ id: 'new-t' });

            const id = resolveOrCreateMidiTrack(undefined, 'Fallback', deps);
            expect(id).toBe('new-t');
            expect(mocks.addTrack).toHaveBeenCalledWith({ name: 'Fallback', kind: 'midi' });
        });

        it('returns null if track creation fails', () => {
            mocks.getTrackStoreState.mockReturnValue({
                selectedTrackId: null,
                tracks: [],
            });
            mocks.addTrack.mockReturnValue(null);

            const id = resolveOrCreateMidiTrack(undefined, 'Fallback', deps);
            expect(id).toBeNull();
        });
    });

    describe('getPlayheadBeat', () => {
        it('returns playhead position from transport state', () => {
            mocks.getTransportState.mockReturnValue({ playheadPosition: 12 });
            expect(getPlayheadBeat()).toBe(12);
        });

        it('returns 0 if transport state is unavailable', () => {
            mocks.getTransportState.mockReturnValue(null);
            expect(getPlayheadBeat()).toBe(0);
        });
    });

    // Regression: the hand-maintained VALID_* sets had drifted out of sync with
    // the algorithm rosters (drum 8/17, chord 8/12, scale 7/14), so valid
    // selections were silently coerced to the default. They are now derived
    // from the algorithm rosters, so every advertised style is accepted and the
    // counts match exactly.
    describe('VALID_* sets cover the full algorithm rosters', () => {
        it('accepts every drum-pattern style the algorithm handles', () => {
            expect(DRUM_PATTERN_STYLES.length).toBe(17);
            for (const style of DRUM_PATTERN_STYLES) {
                expect(VALID_DRUM_STYLES.has(style)).toBe(true);
            }
            expect(VALID_DRUM_STYLES.size).toBe(DRUM_PATTERN_STYLES.length);
            // Spot-check styles that the old hand-maintained set was missing.
            expect(VALID_DRUM_STYLES.has('reggae')).toBe(true);
            expect(VALID_DRUM_STYLES.has('house')).toBe(true);
            expect(VALID_DRUM_STYLES.has('techno')).toBe(true);
        });

        it('accepts every chord-progression style the algorithm handles', () => {
            expect(CHORD_PROGRESSION_STYLES.length).toBe(12);
            for (const style of CHORD_PROGRESSION_STYLES) {
                expect(VALID_CHORD_STYLES.has(style)).toBe(true);
            }
            expect(VALID_CHORD_STYLES.size).toBe(CHORD_PROGRESSION_STYLES.length);
            expect(VALID_CHORD_STYLES.has('neo-soul')).toBe(true);
            expect(VALID_CHORD_STYLES.has('gospel')).toBe(true);
        });

        it('accepts every scale the algorithm handles', () => {
            expect(SCALE_TYPES.length).toBe(14);
            for (const scale of SCALE_TYPES) {
                expect(VALID_SCALES.has(scale)).toBe(true);
            }
            expect(VALID_SCALES.size).toBe(SCALE_TYPES.length);
            expect(VALID_SCALES.has('lydian')).toBe(true);
            expect(VALID_SCALES.has('chromatic')).toBe(true);
        });

        it('accepts every melody style the algorithm handles', () => {
            for (const style of MELODY_STYLES) {
                expect(VALID_MELODY_STYLES.has(style)).toBe(true);
            }
            expect(VALID_MELODY_STYLES.size).toBe(MELODY_STYLES.length);
        });

        it('lists every chord voicing', () => {
            expect(VALID_VOICINGS.has('close')).toBe(true);
            expect(VALID_VOICINGS.has('open')).toBe(true);
            expect(VALID_VOICINGS.has('spread')).toBe(true);
            expect(VALID_VOICINGS.has('power')).toBe(true);
        });
    });
});
