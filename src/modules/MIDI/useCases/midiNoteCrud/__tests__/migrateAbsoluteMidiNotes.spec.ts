import { describe, it, expect, vi, beforeEach } from 'vitest';

import { migrateAbsoluteMidiNotes } from '../migrateAbsoluteMidiNotes';

const mocks = vi.hoisted(() => {
    const trackStoreValue: { value: unknown } = { value: null };
    const midiStoreValue: { value: unknown } = { value: null };
    return {
        trackStoreValue,
        midiStoreValue,
        midiStoreSet: vi.fn(),
        loggerInfo: vi.fn(),
    };
});

vi.mock('#/infra/logger/appLogger', () => ({ logger: { info: mocks.loggerInfo } }));
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
    },
}));
vi.mock('../../../stores/midiStore', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
        set: mocks.midiStoreSet,
    },
}));

function clip(overrides: Partial<{ id: string; name: string; type: string; startBeat: number }> = {}) {
    return { id: 'c1', name: 'Melody 1', type: 'midi', startBeat: 8, ...overrides };
}

function seedNote(startBeat: number) {
    mocks.midiStoreValue.value = {
        notesByClipId: { c1: [{ id: 'n1', pitch: 60, startBeat, duration: 1, velocity: 100 }] },
        ccByClipId: {},
        pitchBendByClipId: {},
    };
}

describe('migrateAbsoluteMidiNotes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStoreValue.value = null;
        mocks.midiStoreValue.value = null;
    });

    it('rewrites AI-named clip notes from timeline-absolute to clip-relative and logs the migration', () => {
        mocks.trackStoreValue.value = { tracks: [{ id: 't1', clips: [clip({ startBeat: 8 })] }] };
        seedNote(8);

        migrateAbsoluteMidiNotes();

        expect(mocks.midiStoreSet).toHaveBeenCalledWith(
            expect.objectContaining({
                notesByClipId: { c1: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }] },
            })
        );
        expect(mocks.loggerInfo).toHaveBeenCalledWith(expect.stringContaining('c1'));
        expect(mocks.loggerInfo).toHaveBeenCalledWith(expect.stringContaining('Melody 1'));
    });

    it.each([
        { label: 'non-AI-named clip', overrides: { name: 'My hand-drawn clip' }, noteStart: 8 },
        { label: 'clip at startBeat 0 (already relative)', overrides: { startBeat: 0 }, noteStart: 0 },
        { label: 'non-midi clip', overrides: { type: 'audio' }, noteStart: 8 },
        { label: 'AI-named clip whose earliest note already precedes clip start', overrides: {}, noteStart: 2 },
    ])('does not migrate: $label', ({ overrides, noteStart }) => {
        mocks.trackStoreValue.value = { tracks: [{ id: 't1', clips: [clip(overrides)] }] };
        seedNote(noteStart);

        migrateAbsoluteMidiNotes();

        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });

    it('does nothing when there are no stored notes for the clip', () => {
        mocks.trackStoreValue.value = { tracks: [{ id: 't1', clips: [clip({ startBeat: 8 })] }] };
        mocks.midiStoreValue.value = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };

        migrateAbsoluteMidiNotes();

        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });

    it('does nothing when the track or MIDI store is unavailable', () => {
        mocks.trackStoreValue.value = null;
        mocks.midiStoreValue.value = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };
        migrateAbsoluteMidiNotes();
        expect(mocks.midiStoreSet).not.toHaveBeenCalled();

        mocks.trackStoreValue.value = { tracks: [{ id: 't1', clips: [clip()] }] };
        mocks.midiStoreValue.value = null;
        migrateAbsoluteMidiNotes();
        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });
});
