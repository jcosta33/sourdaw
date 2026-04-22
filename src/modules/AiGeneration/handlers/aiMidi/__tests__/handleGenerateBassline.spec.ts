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
    trackStore: {
        value: {
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'c1', startBeat: 4, endBeat: 8, name: 'Lead', type: 'midi' }
                    ]
                }
            ]
        }
    }
}));

vi.mock('#/modules/Arrangement', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    addTrack: mocks.addTrack,
    addClip: mocks.addClip,
    trackStore: mocks.trackStore,
}));

vi.mock('#/modules/MIDI', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getNotesForClip: mocks.getNotesForClip,
    addMidiNote: mocks.addMidiNote,
}));

vi.mock('#/modules/AiRuntime', async (importOriginal) => ({
    ...(await importOriginal<any>()),
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
    });

    it('generates a bassline on a new track when trackId is omitted', async () => {
        mocks.getNotesForClip.mockReturnValue([{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }]);
        mocks.addTrack.mockReturnValue({ id: 't2' });
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 36, startBeat: 0, duration: 1, velocity: 80 }]);

        await handleGenerateBassline.execute({
            type: 'generateBassline',
            payload: { clipId: 'c1' },
        });

        expect(mocks.addTrack).toHaveBeenCalledWith({ name: 'Bass (root-fifth)', kind: 'midi' });

        // Assert it calls LLM helper with the correct arguments
        expect(mocks.llmGenerateNotes).toHaveBeenCalledWith(
            mocks.generateToolCalls,
            expect.stringContaining('root-fifth'),
            [{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            'c1'
        );

        expect(mocks.addMidiNote).toHaveBeenCalledWith('c1', 36, 0, 1, 80);
        expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('Generated root-fifth bassline'));
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

    it('uses provided trackId instead of creating one', async () => {
        mocks.llmGenerateNotes.mockResolvedValue([]);

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
