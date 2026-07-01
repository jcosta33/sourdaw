import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleGenerateBassline } from '../handleGenerateBassline';

const mocks = vi.hoisted(() => ({
    addTrack: vi.fn(),
    addClip: vi.fn(),
    getNotesForClip: vi.fn(),
    addMidiNote: vi.fn(),
    generateToolCalls: vi.fn(),
    llmGenerateNotes: vi.fn(),
    info: vi.fn(),
    notifyUser: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    addTrack: mocks.addTrack,
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

describe('handleGenerateBassline', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset the shared track-state fixture so missing-clip tests do not
        // leak into other tests (declaration order aside).
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 4, endBeat: 8, name: 'Lead', type: 'midi' }] }],
        });
    });

    it('generates a bassline on a new clip on the new track when trackId is omitted', async () => {
        mocks.getNotesForClip.mockReturnValue([{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }]);
        mocks.addTrack.mockReturnValue({ id: 't2' });
        mocks.addClip.mockReturnValue({ id: 'bass-clip' });
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 36, startBeat: 0, duration: 1, velocity: 80 }]);

        await handleGenerateBassline.execute({
            type: 'generateBassline',
            payload: { clipId: 'c1' },
        });

        expect(mocks.addTrack).toHaveBeenCalledWith({ name: 'Bass (root-fifth)', kind: 'midi' });
        expect(mocks.getTrackStoreState).toHaveBeenCalledTimes(1);

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
        expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('Generated root-fifth bassline'));
    });

    it('bails (does not fall back to the source clip) when the reference clip is missing on a new track', async () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
        mocks.getNotesForClip.mockReturnValue([]);
        mocks.addTrack.mockReturnValue({ id: 't2' });
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 36, startBeat: 0, duration: 1, velocity: 80 }]);

        await expect(
            handleGenerateBassline.execute({
                type: 'generateBassline',
                payload: { clipId: 'missing' },
            })
        ).rejects.toThrow(/source clip not found/i);

        expect(mocks.notifyUser).toHaveBeenCalledWith('Bassline generation failed: source clip not found', 'error');
        expect(mocks.getTrackStoreState).toHaveBeenCalledTimes(1);
        // Critically: nothing is appended to the source clip id.
        expect(mocks.addMidiNote).not.toHaveBeenCalled();
    });

    it('bails if track creation fails', async () => {
        mocks.getNotesForClip.mockReturnValue([]);
        mocks.addTrack.mockReturnValue(null);

        await handleGenerateBassline.execute({
            type: 'generateBassline',
            payload: { clipId: 'c1' },
        });

        expect(mocks.llmGenerateNotes).not.toHaveBeenCalled();
    });

    it('should not append generated notes to the source clip when the new clip cannot be created', async () => {
        mocks.getNotesForClip.mockReturnValueOnce([{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }]);
        mocks.addTrack.mockReturnValueOnce({ id: 't2' });
        mocks.addClip.mockReturnValueOnce(null);
        mocks.llmGenerateNotes.mockResolvedValueOnce([{ pitch: 36, startBeat: 0, duration: 1, velocity: 80 }]);

        await expect(
            handleGenerateBassline.execute({
                type: 'generateBassline',
                payload: { clipId: 'c1' },
            })
        ).rejects.toThrow(/could not create clip/i);

        expect(mocks.notifyUser).toHaveBeenCalledWith('Bassline generation failed: could not create clip', 'error');
        expect(mocks.addMidiNote).not.toHaveBeenCalled();
    });

    it('uses provided trackId instead of creating one', async () => {
        mocks.llmGenerateNotes.mockResolvedValue([]);

        await handleGenerateBassline.execute({
            type: 'generateBassline',
            payload: { clipId: 'c1', trackId: 't-existing', style: 'walking' },
        });

        expect(mocks.addTrack).not.toHaveBeenCalled();
        expect(mocks.getTrackStoreState).not.toHaveBeenCalled();
        expect(mocks.llmGenerateNotes).toHaveBeenCalledWith(
            mocks.generateToolCalls,
            expect.stringContaining('walking'),
            [],
            'c1'
        );
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
