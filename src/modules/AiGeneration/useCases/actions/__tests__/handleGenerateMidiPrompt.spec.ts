import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleGenerateMidiPrompt, buildSeedNotesFromPrompt } from '../handleGenerateMidiPrompt';

type UndoCallback = () => void;

type PushUndoEntryMock = (
    label: string,
    undoFn: UndoCallback,
    redoFn: UndoCallback,
    options?: { source?: string; groupId?: string; groupLabel?: string }
) => void;

const {
    updateTaskMock,
    addTrackMock,
    addClipMock,
    batchAddMidiNotesMock,
    setTrackStoreStateMock,
    setMidiStoreStateMock,
    pushUndoEntryMock,
    selectClipMock,
    trackStoreMock,
    midiStoreMock,
    workspaceStoreMock,
    generateMidiViaLlmMock,
} = vi.hoisted(() => ({
    updateTaskMock: vi.fn(),
    addTrackMock: vi.fn(),
    addClipMock: vi.fn(),
    batchAddMidiNotesMock: vi.fn(),
    setTrackStoreStateMock: vi.fn<(state: unknown) => void>(),
    setMidiStoreStateMock: vi.fn<(state: unknown) => void>(),
    pushUndoEntryMock: vi.fn<PushUndoEntryMock>(),
    selectClipMock: vi.fn(),
    trackStoreMock: {
        value: { tracks: [] as Array<{ id: string; kind: string }>, selectedTrackId: null as string | null },
        set: vi.fn(),
    },
    midiStoreMock: { value: {} as Record<string, unknown>, set: vi.fn() },
    workspaceStoreMock: { value: { selectedClipId: null as string | null }, set: vi.fn() },
    generateMidiViaLlmMock: vi.fn().mockResolvedValue([]),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...actual,
        generateMidiAI: vi.fn(),
        isTauri: () => false,
    };
});

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        addTrack: addTrackMock,
        addClip: addClipMock,
        setTrackStoreState: setTrackStoreStateMock,
    };
});

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...actual,
        trackStore: trackStoreMock,
    };
});

vi.mock('#/modules/MIDI/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/MIDI/stores')>();
    return {
        ...actual,
        midiStore: midiStoreMock,
    };
});

vi.mock('#/modules/Workspace/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Workspace/stores')>();
    return {
        ...actual,
        workspaceStore: workspaceStoreMock,
    };
});

vi.mock('#/modules/Workspace/useCases', () => ({
    selectClip: selectClipMock,
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/MIDI/useCases')>();
    return {
        ...actual,
        batchAddMidiNotes: batchAddMidiNotesMock,
        setMidiStoreState: setMidiStoreStateMock,
    };
});

vi.mock('#/modules/Command/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/stores')>();
    return {
        ...actual,
        pushUndoEntry: pushUndoEntryMock,
    };
});

vi.mock('#/modules/Transport/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/useCases')>();
    return {
        ...actual,
        getTransportState: vi.fn().mockReturnValue({ playheadPosition: 0 }),
    };
});

vi.mock('../../llmMidiGeneration', () => ({
    generateMidiViaLlm: generateMidiViaLlmMock,
}));

vi.mock('../addTask', () => ({
    addTask: vi.fn().mockReturnValue('task-1'),
}));

vi.mock('../updateTask', () => ({
    updateTask: updateTaskMock,
}));

describe('handleGenerateMidiPrompt', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStoreMock.value = { tracks: [], selectedTrackId: null };
        workspaceStoreMock.value = { selectedClipId: null };
        generateMidiViaLlmMock.mockResolvedValue([]);
    });

    it('should record an error task when generation yields no notes', async () => {
        await handleGenerateMidiPrompt('hello');

        expect(updateTaskMock).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                status: 'error',
                error: 'No notes generated — try rephrasing the prompt',
            })
        );
        expect(addTrackMock).not.toHaveBeenCalled();
        expect(addClipMock).not.toHaveBeenCalled();
        expect(batchAddMidiNotesMock).not.toHaveBeenCalled();
        expect(pushUndoEntryMock).not.toHaveBeenCalled();
        expect(selectClipMock).not.toHaveBeenCalled();
    });

    it('should register an undo entry and report error when the clip cannot be created on a freshly added track', async () => {
        const trackSnapshotBefore = { tracks: [], selectedTrackId: null };
        const trackSnapshotAfter = {
            tracks: [{ id: 'new-midi-track', kind: 'midi' }],
            selectedTrackId: 'new-midi-track',
        };
        const midiSnapshotBefore = { notesByClipId: {} };
        const midiSnapshotAfter = midiSnapshotBefore;
        trackStoreMock.value = trackSnapshotBefore;
        midiStoreMock.value = midiSnapshotBefore;

        // Notes generated, a new track is created, but addClip fails (returns null).
        generateMidiViaLlmMock.mockResolvedValue([{ pitch: 60, start_beat: 0, duration_beats: 1, velocity: 100 }]);
        addTrackMock.mockImplementation(() => {
            trackStoreMock.value = trackSnapshotAfter;
            return { id: 'new-midi-track' };
        });
        addClipMock.mockReturnValue(null);

        await handleGenerateMidiPrompt('a melody');

        // The orphan track is rolled-back-able: an undo entry was registered
        // even though no clip (and therefore no note batch) was inserted.
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(batchAddMidiNotesMock).not.toHaveBeenCalled();
        expect(selectClipMock).not.toHaveBeenCalled();
        // And the task is surfaced as an error, not a false success.
        expect(updateTaskMock).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                status: 'error',
                error: 'MIDI generation failed: could not create a clip for the notes',
            })
        );

        const undoEntryCall = pushUndoEntryMock.mock.calls[0];
        expect(undoEntryCall).toBeDefined();
        if (!undoEntryCall) {
            throw new Error('Expected clip-create failure to register an undo entry');
        }
        const [, undoCallback, redoCallback] = undoEntryCall;

        undoCallback();
        expect(setTrackStoreStateMock).toHaveBeenCalledWith(trackSnapshotBefore);
        expect(setMidiStoreStateMock).toHaveBeenCalledWith(midiSnapshotBefore);

        setTrackStoreStateMock.mockClear();
        setMidiStoreStateMock.mockClear();

        redoCallback();
        expect(setTrackStoreStateMock).toHaveBeenCalledWith(trackSnapshotAfter);
        expect(setMidiStoreStateMock).toHaveBeenCalledWith(midiSnapshotAfter);
    });

    it('should delegate generated clip selection through the Workspace use case', async () => {
        generateMidiViaLlmMock.mockResolvedValue([{ pitch: 60, start_beat: 0, duration_beats: 1, velocity: 100 }]);
        addTrackMock.mockReturnValue({ id: 'new-midi-track' });
        addClipMock.mockReturnValue({ id: 'generated-clip' });

        await handleGenerateMidiPrompt('a melody');

        expect(batchAddMidiNotesMock).toHaveBeenCalledWith('generated-clip', [
            { pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
        ]);
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(updateTaskMock).toHaveBeenCalledWith('task-1', expect.objectContaining({ status: 'success' }));
        expect(selectClipMock).toHaveBeenCalledWith('generated-clip');
        expect(workspaceStoreMock.set).not.toHaveBeenCalled();
    });
});

describe('buildSeedNotesFromPrompt', () => {
    it('falls back to an ascending C-major fragment when no key is named', () => {
        expect(buildSeedNotesFromPrompt('chill lofi groove')).toEqual([
            [60, 80, 0, 0.5],
            [62, 75, 0.5, 0.5],
            [64, 85, 1.0, 0.5],
            [65, 80, 1.5, 0.5],
        ]);
    });

    it('derives a minor-scale seed rooted on the key named in the prompt', () => {
        // F# minor: root pitch class 6 → MIDI 66; minor steps [0,2,3,5].
        const seed = buildSeedNotesFromPrompt('moody bassline in F# minor');
        expect(seed.map((s) => s[0])).toEqual([66, 68, 69, 71]);
    });

    it('derives a major-scale seed and is case-insensitive', () => {
        // D major: root pitch class 2 → MIDI 62; major steps [0,2,4,5].
        const seed = buildSeedNotesFromPrompt('Bright lead in D Major');
        expect(seed.map((s) => s[0])).toEqual([62, 64, 66, 67]);
    });

    it('does not treat an incidental note letter (no mode word) as a key', () => {
        // "cinematic" begins with c but has no major/minor → default C major.
        expect(buildSeedNotesFromPrompt('cinematic pad').map((s) => s[0])).toEqual([60, 62, 64, 65]);
    });
});
