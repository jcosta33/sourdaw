import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleGenerateBassline } from '../handleGenerateBassline';

const mocks = vi.hoisted(() => {
    const transactionScope = vi.fn((callback: () => void) => callback());
    return {
        captureTransactionScope: vi.fn(() => transactionScope),
        transactionScope,
        addTrack: vi.fn(),
        addClip: vi.fn(),
        getNotesForClip: vi.fn(),
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
        notifyUser: vi.fn(),
        getTrackStoreState: vi.fn(),
        afterTrackCommit: vi.fn(),
        afterTrackAmbiguousCommit: vi.fn(),
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
    addTrackWithDeferredAddedEvent: mocks.addTrack,
    addClip: mocks.addClip,
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    getNotesForClip: mocks.getNotesForClip,
    addMidiNote: mocks.addMidiNote,
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

function createTrackCreation(track: { id: string; name: string; kind: string; clips: unknown[] }) {
    return {
        track,
        afterCommit: mocks.afterTrackCommit,
        afterAmbiguousCommit: mocks.afterTrackAmbiguousCommit,
    };
}

describe('handleGenerateBassline', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getNotesForClip.mockReturnValue([]);
        mocks.addTrack.mockReturnValue(null);
        mocks.addClip.mockReturnValue(null);
        // Reset the shared track-state fixture so missing-clip tests do not
        // leak into other tests (declaration order aside).
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                { id: 't1', kind: 'midi', clips: [{ id: 'c1', startBeat: 4, endBeat: 8, name: 'Lead', type: 'midi' }] },
            ],
        });
    });

    it('generates a bassline on a new clip on the new track when trackId is omitted', async () => {
        mocks.getNotesForClip.mockReturnValue([{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }]);
        mocks.addTrack.mockReturnValue(
            createTrackCreation({ id: 't2', name: 'Bass (root-fifth)', kind: 'midi', clips: [] })
        );
        mocks.addClip.mockReturnValue({
            id: 'bass-clip',
            startBeat: 4,
            endBeat: 8,
            name: 'Bassline (root-fifth)',
            type: 'midi',
        });
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 36, startBeat: 0, duration: 1, velocity: 80 }]);

        const result = await handleGenerateBassline.execute({
            type: 'generateBassline',
            payload: { clipId: 'c1' },
        });

        expect(mocks.addTrack).toHaveBeenCalledWith({
            name: 'Bass (root-fifth)',
            kind: 'midi',
        });
        expect(mocks.getTrackStoreState).toHaveBeenCalledTimes(2);

        // A new clip is created on the new track (t2), mirroring the source clip's span.
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({ trackId: 't2', startBeat: 4, endBeat: 8, name: 'Bassline (root-fifth)' })
        );

        // Assert it calls LLM helper with the correct arguments
        expect(mocks.llmGenerateNotes).toHaveBeenCalledWith(
            mocks.generateToolCalls,
            expect.stringContaining('root-fifth'),
            [{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            'c1'
        );

        // Notes land on the NEW clip, never on the source clip ('c1').
        expect(mocks.addMidiNote).toHaveBeenCalledWith('bass-clip', 36, 0, 1, 80);
        expect(mocks.captureTransactionScope).toHaveBeenCalledTimes(1);
        expect(mocks.transactionScope).toHaveBeenCalledTimes(1);
        expect(mocks.captureTransactionScope.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.llmGenerateNotes.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
        expect(mocks.transactionScope.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.addClip.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
        expect(mocks.transactionScope.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.addMidiNote.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
        expect(mocks.afterTrackCommit).not.toHaveBeenCalled();
        expect(mocks.info).not.toHaveBeenCalled();
        if (result?.status !== 'written') {
            throw new Error('Expected a written bassline result');
        }
        await result.afterCommit?.();
        expect(mocks.afterTrackCommit).toHaveBeenCalledTimes(1);
        expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('Generated root-fifth bassline'));
    });

    it('bails (does not fall back to the source clip) when the reference clip is missing on a new track', async () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
        mocks.getNotesForClip.mockReturnValue([]);
        mocks.addTrack.mockReturnValue(
            createTrackCreation({ id: 't2', name: 'Bass (root-fifth)', kind: 'midi', clips: [] })
        );
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 36, startBeat: 0, duration: 1, velocity: 80 }]);

        const result = await handleGenerateBassline.execute({
            type: 'generateBassline',
            payload: { clipId: 'missing' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.notifyUser).toHaveBeenCalledWith('Bassline generation failed: source clip not found', 'error');
        expect(mocks.getTrackStoreState).toHaveBeenCalledTimes(1);
        expect(mocks.llmGenerateNotes).not.toHaveBeenCalled();
        // Critically: nothing is appended to the source clip id.
        expect(mocks.addMidiNote).not.toHaveBeenCalled();
    });

    it('does not publish deferred effects after an ambiguous non-durable write', async () => {
        mocks.addTrack.mockReturnValue(
            createTrackCreation({ id: 't2', name: 'Bass (root-fifth)', kind: 'midi', clips: [] })
        );
        mocks.addClip.mockReturnValue({
            id: 'bass-clip',
            startBeat: 4,
            endBeat: 8,
            name: 'Bassline (root-fifth)',
            type: 'midi',
        });
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 36, startBeat: 0, duration: 1, velocity: 80 }]);

        const result = await handleGenerateBassline.execute({
            type: 'generateBassline',
            payload: { clipId: 'c1' },
        });
        if (result?.status !== 'written') {
            throw new Error('Expected a written bassline result');
        }
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

        await result.afterAmbiguousCommit?.();

        expect(mocks.afterTrackAmbiguousCommit).not.toHaveBeenCalled();
        expect(mocks.info).not.toHaveBeenCalled();
    });

    it('bails if track creation fails', async () => {
        mocks.getNotesForClip.mockReturnValue([]);
        mocks.addTrack.mockReturnValue(null);
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 36, startBeat: 0, duration: 1, velocity: 80 }]);

        const result = await handleGenerateBassline.execute({
            type: 'generateBassline',
            payload: { clipId: 'c1' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.llmGenerateNotes).toHaveBeenCalledTimes(1);
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.addMidiNote).not.toHaveBeenCalled();
    });

    it('should not append generated notes to the source clip when the new clip cannot be created', async () => {
        mocks.getNotesForClip.mockReturnValue([
            { id: 'existing-note', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
        ]);
        mocks.addTrack.mockReturnValueOnce(
            createTrackCreation({ id: 't2', name: 'Bass (root-fifth)', kind: 'midi', clips: [] })
        );
        mocks.addClip.mockReturnValueOnce(null);
        mocks.llmGenerateNotes.mockResolvedValueOnce([{ pitch: 36, startBeat: 0, duration: 1, velocity: 80 }]);

        const result = await handleGenerateBassline.execute({
            type: 'generateBassline',
            payload: { clipId: 'c1' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Bassline generation failed: could not create the target clip',
            'error'
        );
        expect(mocks.addMidiNote).not.toHaveBeenCalled();
    });

    it('creates a dedicated bass clip on the provided target track', async () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                { id: 't1', kind: 'midi', clips: [{ id: 'c1', startBeat: 4, endBeat: 8, name: 'Lead', type: 'midi' }] },
                { id: 't-existing', kind: 'midi', clips: [] },
            ],
        });
        mocks.addClip.mockReturnValue({
            id: 'target-bass-clip',
            startBeat: 4,
            endBeat: 8,
            name: 'Bassline (walking)',
            type: 'midi',
        });
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 36, startBeat: 0, duration: 1, velocity: 80 }]);

        await handleGenerateBassline.execute({
            type: 'generateBassline',
            payload: { clipId: 'c1', trackId: 't-existing', style: 'walking' },
        });

        expect(mocks.addTrack).not.toHaveBeenCalled();
        expect(mocks.llmGenerateNotes).toHaveBeenCalledWith(
            mocks.generateToolCalls,
            expect.stringContaining('walking'),
            [],
            'c1'
        );
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({ trackId: 't-existing', startBeat: 4, endBeat: 8 })
        );
        expect(mocks.addMidiNote).toHaveBeenCalledWith('target-bass-clip', 36, 0, 1, 80);
        expect(mocks.addMidiNote).not.toHaveBeenCalledWith('c1', 36, 0, 1, 80);
    });

    it('returns a conflict without creating a track when the source changes during inference', async () => {
        mocks.getTrackStoreState
            .mockReturnValueOnce({
                tracks: [
                    {
                        id: 't1',
                        kind: 'midi',
                        clips: [{ id: 'c1', startBeat: 4, endBeat: 8, name: 'Lead', type: 'midi' }],
                    },
                ],
            })
            .mockReturnValueOnce({ tracks: [] });
        mocks.getNotesForClip.mockReturnValue([
            { id: 'existing-note', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
        ]);
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 36, startBeat: 0, duration: 1, velocity: 80 }]);

        const result = await handleGenerateBassline.execute({
            type: 'generateBassline',
            payload: { clipId: 'c1' },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.transactionScope).not.toHaveBeenCalled();
        expect(mocks.addTrack).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.addMidiNote).not.toHaveBeenCalled();
    });

    it('returns a conflict when the provided target track disappears during inference', async () => {
        const sourceAndTarget = {
            tracks: [
                {
                    id: 't1',
                    kind: 'midi',
                    clips: [{ id: 'c1', startBeat: 4, endBeat: 8, name: 'Lead', type: 'midi' }],
                },
                { id: 't-existing', kind: 'midi', clips: [] },
            ],
        };
        const sourceOnly = {
            tracks: [
                {
                    id: 't1',
                    kind: 'midi',
                    clips: [{ id: 'c1', startBeat: 4, endBeat: 8, name: 'Lead', type: 'midi' }],
                },
            ],
        };
        mocks.getTrackStoreState
            .mockReturnValueOnce(sourceAndTarget)
            .mockReturnValueOnce(sourceAndTarget)
            .mockReturnValueOnce(sourceAndTarget)
            .mockReturnValueOnce(sourceOnly);
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 36, startBeat: 0, duration: 1, velocity: 80 }]);

        const result = await handleGenerateBassline.execute({
            type: 'generateBassline',
            payload: { clipId: 'c1', trackId: 't-existing' },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.addMidiNote).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('provides a description', () => {
        const desc1 = handleGenerateBassline.describe({
            type: 'generateBassline',
            payload: { clipId: 'c1' },
        });
        expect(desc1.label).toBe('AI: generate root-fifth bassline');

        const desc2 = handleGenerateBassline.describe({
            type: 'generateBassline',
            payload: { clipId: 'c1', style: 'walking' },
        });
        expect(desc2.label).toBe('AI: generate walking bassline');
    });

    it('is marked as undoable', () => {
        expect(handleGenerateBassline.undoable).toBe(true);
    });
});
