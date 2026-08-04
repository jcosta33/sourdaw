import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleCompleteMidi } from '../handleCompleteMidi';

const mocks = vi.hoisted(() => {
    const transactionScope = vi.fn((callback: () => void) => callback());
    return {
        captureTransactionScope: vi.fn(() => transactionScope),
        transactionScope,
        getNotesForClip: vi.fn(),
        setNotesForClip: vi.fn(),
        addMidiNote: vi.fn((clipId: string, pitch: number, startBeat: number, duration: number, velocity: number) => ({
            id: `written-${clipId}`,
            pitch,
            startBeat,
            duration,
            velocity,
            probability: 100,
        })),
        generateToolCalls: vi.fn(),
        llmGenerateNotes: vi.fn(),
        info: vi.fn(),
        addClip: vi.fn(),
        notifyUser: vi.fn(),
        getTrackStoreState: vi.fn(),
    };
});

vi.mock('#/infra/store/storage/createAutomergeStorage', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/infra/store/storage/createAutomergeStorage')>()),
    captureAutomergeStorageTransactionScope: mocks.captureTransactionScope,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    addClip: mocks.addClip,
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    getNotesForClip: mocks.getNotesForClip,
    addMidiNote: mocks.addMidiNote,
    setNotesForClip: mocks.setNotesForClip,
}));

vi.mock('#/modules/AiRuntime/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiRuntime/useCases')>()),
    generateToolCalls: mocks.generateToolCalls,
}));

vi.mock('../llmNoteHelpers', () => ({
    llmGenerateNotes: mocks.llmGenerateNotes,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: mocks.info },
}));

describe('handleCompleteMidi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset the shared track-state fixture so tests that change the getter
        // result (missing-clip, clamping) do not leak
        // into the others regardless of declaration order.
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 4, endBeat: 8, name: 'Lead', type: 'midi' }] }],
        });
    });

    it('generates forward completion notes', async () => {
        const existing = [{ id: 'existing-note', pitch: 60, startBeat: 0, duration: 4, velocity: 100 }];
        mocks.getNotesForClip.mockReturnValue(existing);
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 62, startBeat: 4, duration: 1, velocity: 90 }]);

        const result = await handleCompleteMidi.execute({
            type: 'completeMidi',
            payload: { clipId: 'c1', bars: 2, direction: 'forward' },
        });

        expect(mocks.llmGenerateNotes).toHaveBeenCalledWith(
            mocks.generateToolCalls,
            expect.stringContaining('Continue'),
            existing,
            'c1',
            { allowNegativeStartBeat: false }
        );

        expect(mocks.addMidiNote).toHaveBeenCalledWith('c1', 62, 4, 1, 90);
        expect(mocks.captureTransactionScope).toHaveBeenCalledTimes(1);
        expect(mocks.transactionScope).toHaveBeenCalledTimes(1);
        expect(mocks.captureTransactionScope.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.llmGenerateNotes.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
        expect(mocks.transactionScope.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.addMidiNote.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
        expect(mocks.getTrackStoreState).toHaveBeenCalledTimes(2);
        expect(mocks.info).not.toHaveBeenCalled();
        if (result?.status !== 'written') {
            throw new Error('Expected a written completion result');
        }
        await result.afterCommit?.();
        expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('Completed 1 notes'));
    });

    it('generates backward lead-in notes on a new prepended clip', async () => {
        const existing = [{ id: 'existing-note', pitch: 60, startBeat: 0, duration: 4, velocity: 100 }];
        mocks.getNotesForClip.mockReturnValue(existing);
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 58, startBeat: -4, duration: 1, velocity: 80 }]);
        mocks.addClip.mockReturnValue({
            id: 'new-clip-id',
            startBeat: 0,
            endBeat: 4,
            name: 'Lead (intro)',
            type: 'midi',
        });

        await handleCompleteMidi.execute({
            type: 'completeMidi',
            payload: { clipId: 'c1', bars: 1, direction: 'backward' },
        });

        expect(mocks.llmGenerateNotes).toHaveBeenCalledWith(
            mocks.generateToolCalls,
            expect.stringContaining('BEFORE'),
            existing,
            'c1',
            { allowNegativeStartBeat: true }
        );

        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({
                trackId: 't1',
                startBeat: 0, // max(0, 4 - 4)
                endBeat: 4,
                name: 'Lead (intro)',
            })
        );

        // Note is shifted relative to its minimum startBeat (-4)
        // Shifted start = -4 - (-4) = 0
        expect(mocks.getTrackStoreState).toHaveBeenCalledTimes(2);
        expect(mocks.addMidiNote).toHaveBeenCalledWith('new-clip-id', 58, 0, 1, 80);
        expect(mocks.transactionScope).toHaveBeenCalledTimes(1);
        expect(mocks.transactionScope.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.addClip.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
    });

    it('clamps backward notes so they never overflow the prepended clip bounds', async () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 4, endBeat: 8, name: 'Lead', type: 'midi' }] }],
        });
        mocks.getNotesForClip.mockReturnValue([
            { id: 'existing-note', pitch: 60, startBeat: 0, duration: 4, velocity: 100 },
        ]);
        // bars:1 → durationBeats 4, newStartBeat max(0, 4-4)=0, clipLength 4.
        // Notes the LLM emitted span the whole window plus one overflowing note.
        mocks.llmGenerateNotes.mockResolvedValue([
            { pitch: 50, startBeat: 0, duration: 6, velocity: 70 }, // duration overflows → trimmed to 4
            { pitch: 52, startBeat: 4, duration: 1, velocity: 70 }, // starts at clip end → dropped
        ]);
        mocks.addClip.mockReturnValue({
            id: 'intro-clip',
            startBeat: 0,
            endBeat: 4,
            name: 'Lead (intro)',
            type: 'midi',
        });

        const result = await handleCompleteMidi.execute({
            type: 'completeMidi',
            payload: { clipId: 'c1', bars: 1, direction: 'backward' },
        });

        // First note kept but trimmed to fit [0, 4); second note dropped entirely.
        expect(mocks.addMidiNote).toHaveBeenCalledTimes(1);
        expect(mocks.addMidiNote).toHaveBeenCalledWith('intro-clip', 50, 0, 4, 70);
        expect(mocks.info).not.toHaveBeenCalled();
        if (result?.status !== 'written') {
            throw new Error('Expected a written backward completion result');
        }
        await result.afterCommit?.();
        expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('Completed 1 notes'));
    });

    it('surfaces an error (and skips the success log) when the source clip is not found on backward completion', async () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
        mocks.getNotesForClip.mockReturnValue([]);
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 58, startBeat: -4, duration: 1, velocity: 80 }]);

        const result = await handleCompleteMidi.execute({
            type: 'completeMidi',
            payload: { clipId: 'missing', bars: 1, direction: 'backward' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.notifyUser).toHaveBeenCalledWith('Complete MIDI failed: source clip not found', 'error');
        expect(mocks.getTrackStoreState).toHaveBeenCalledTimes(1);
        expect(mocks.llmGenerateNotes).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.info).not.toHaveBeenCalled();
    });

    it('returns a conflict without writing when the source changes during inference', async () => {
        const existing = [{ id: 'existing-note', pitch: 60, startBeat: 0, duration: 4, velocity: 100 }];
        mocks.getTrackStoreState
            .mockReturnValueOnce({
                tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 4, endBeat: 8, name: 'Lead', type: 'midi' }] }],
            })
            .mockReturnValueOnce({ tracks: [] });
        mocks.getNotesForClip.mockReturnValue(existing);
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 62, startBeat: 4, duration: 1, velocity: 90 }]);

        const result = await handleCompleteMidi.execute({
            type: 'completeMidi',
            payload: { clipId: 'c1', direction: 'forward' },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.transactionScope).not.toHaveBeenCalled();
        expect(mocks.addMidiNote).not.toHaveBeenCalled();
    });

    it('returns no-write before inference when a backward completion has no room', async () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 0, endBeat: 4, name: 'Lead', type: 'midi' }] }],
        });
        mocks.getNotesForClip.mockReturnValue([]);

        const result = await handleCompleteMidi.execute({
            type: 'completeMidi',
            payload: { clipId: 'c1', direction: 'backward' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.notifyUser).toHaveBeenCalledWith('Complete MIDI failed: no room before the source clip', 'error');
        expect(mocks.llmGenerateNotes).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
    });

    it('provides a description', () => {
        const existing = [{ id: 'existing-note', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }];
        mocks.getNotesForClip.mockReturnValue(existing);
        const desc = handleCompleteMidi.describe({
            type: 'completeMidi',
            payload: { clipId: 'c1' },
        });
        expect(desc.label).toBe('AI: complete MIDI phrase');
        expect(desc.inverseAction).toEqual({
            type: 'restoreMidiClipNotes',
            payload: {
                clipId: 'c1',
                notes: existing,
                expectedNotes: [],
            },
        });
    });

    it('describes backward completion with an exact generated-clip inverse', () => {
        mocks.getNotesForClip.mockReturnValue([]);
        const desc = handleCompleteMidi.describe({
            type: 'completeMidi',
            payload: { clipId: 'c1', direction: 'backward' },
        });

        expect(desc.inverseAction?.type).toBe('discardDuplicatedClip');
        if (desc.inverseAction?.type !== 'discardDuplicatedClip') {
            throw new Error('Expected generated clip inverse');
        }
        expect(desc.inverseAction.payload.clipId).toMatch(/^clip-ai-/);
    });

    it('replays the exact forward result without invoking the model again', async () => {
        const existing = [{ id: 'existing-note', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }];
        mocks.getNotesForClip.mockReturnValue(existing);
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 62, startBeat: 1, duration: 1, velocity: 90 }]);
        const action = {
            type: 'completeMidi' as const,
            payload: { clipId: 'c1', direction: 'forward' as const },
        };
        const description = handleCompleteMidi.describe(action);

        await handleCompleteMidi.execute(action);
        await handleCompleteMidi.execute(action);

        expect(mocks.llmGenerateNotes).toHaveBeenCalledTimes(1);
        expect(mocks.setNotesForClip).toHaveBeenCalledWith('c1', [
            ...existing,
            {
                id: 'written-c1',
                pitch: 62,
                startBeat: 1,
                duration: 1,
                velocity: 90,
                probability: 100,
            },
        ]);
        expect(description.inverseAction).toEqual({
            type: 'restoreMidiClipNotes',
            payload: {
                clipId: 'c1',
                notes: existing,
                expectedNotes: [
                    ...existing,
                    {
                        id: 'written-c1',
                        pitch: 62,
                        startBeat: 1,
                        duration: 1,
                        velocity: 90,
                        probability: 100,
                    },
                ],
            },
        });
    });

    it('is undoable', () => {
        expect(handleCompleteMidi.undoable).toBe(true);
    });
});
