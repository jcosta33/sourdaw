import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleReplayGeneratedMidi } from '../handleReplayGeneratedMidi';

const mocks = vi.hoisted(() => ({
    addClip: vi.fn(),
    afterTrackAmbiguousCommit: vi.fn(),
    afterTrackCommit: vi.fn(),
    getTrackStoreState: vi.fn(),
    hasDurableMidiGenerationResult: vi.fn(),
    restoreTrack: vi.fn(),
    setNotesForClip: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    addClip: mocks.addClip,
    getTrackStoreState: mocks.getTrackStoreState,
    restoreTrackAtIndexWithDeferredAddedEvent: mocks.restoreTrack,
}));
vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    setNotesForClip: mocks.setNotesForClip,
}));
vi.mock('../hasDurableMidiGenerationResult', () => ({
    hasDurableMidiGenerationResult: mocks.hasDurableMidiGenerationResult,
}));

const sourceClip = {
    id: 'source-clip',
    trackId: 'source-track',
    name: 'Source',
    startBeat: 0,
    endBeat: 4,
    type: 'midi' as const,
};
const sourceNotes = [{ id: 'source-note', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }];
const generatedNotes = [{ id: 'generated-note', pitch: 36, startBeat: 0, duration: 1, velocity: 90 }];

describe('handleReplayGeneratedMidi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'source-track', kind: 'midi', clips: [sourceClip] }],
        });
    });

    it('replaces notes only when the serialized source snapshot is still exact', async () => {
        mocks.hasDurableMidiGenerationResult.mockReturnValueOnce(false).mockReturnValueOnce(true);

        const result = await handleReplayGeneratedMidi.execute({
            type: 'replayGeneratedMidi',
            payload: {
                operation: {
                    kind: 'replace-notes',
                    trackId: 'source-track',
                    clip: sourceClip,
                    expectedNotes: sourceNotes,
                    replacementNotes: generatedNotes,
                },
            },
        });

        expect(result).toEqual({ status: 'written' });
        expect(mocks.setNotesForClip).toHaveBeenCalledWith('source-clip', generatedNotes);
    });

    it('recreates a generated track and MIDI clip with stable ids without selecting it', async () => {
        mocks.hasDurableMidiGenerationResult.mockReturnValue(true);
        const generatedTrack = {
            id: 'generated-track',
            name: 'Bass',
            kind: 'midi',
            color: '#123456',
            devices: [{ id: 'stable-device' }],
            alternatives: [{ id: 'stable-alternative' }],
            clips: [
                {
                    id: 'generated-clip',
                    trackId: 'generated-track',
                    name: 'Bassline',
                    startBeat: 0,
                    endBeat: 4,
                    type: 'midi',
                },
            ],
        };
        const trackJson = JSON.stringify(generatedTrack);
        mocks.restoreTrack.mockReturnValue({
            track: generatedTrack,
            afterCommit: mocks.afterTrackCommit,
            afterAmbiguousCommit: mocks.afterTrackAmbiguousCommit,
        });

        const result = await handleReplayGeneratedMidi.execute({
            type: 'replayGeneratedMidi',
            payload: {
                operation: {
                    kind: 'create-track',
                    source: { trackId: 'source-track', clip: sourceClip, notes: sourceNotes },
                    trackJson,
                    trackIndex: 1,
                    clip: {
                        id: 'generated-clip',
                        trackId: 'generated-track',
                        name: 'Bassline',
                        startBeat: 0,
                        endBeat: 4,
                        type: 'midi',
                    },
                    notes: generatedNotes,
                },
            },
        });

        expect(mocks.restoreTrack).toHaveBeenCalledWith({
            trackJson,
            trackIndex: 1,
        });
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).toHaveBeenCalledWith('generated-clip', generatedNotes);
        if (result?.status !== 'written') {
            throw new Error('Expected replay write');
        }
        await result.afterCommit?.();
        expect(mocks.afterTrackCommit).toHaveBeenCalledOnce();
    });

    it('conflicts before writing when a generated clip id now exists anywhere', async () => {
        mocks.hasDurableMidiGenerationResult.mockReturnValue(true);
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                { id: 'source-track', kind: 'midi', clips: [sourceClip] },
                { id: 'foreign-track', kind: 'midi', clips: [{ id: 'generated-clip' }] },
            ],
        });

        const result = await handleReplayGeneratedMidi.execute({
            type: 'replayGeneratedMidi',
            payload: {
                operation: {
                    kind: 'create-clip',
                    source: { trackId: 'source-track', clip: sourceClip, notes: sourceNotes },
                    targetTrackId: 'source-track',
                    clip: {
                        id: 'generated-clip',
                        trackId: 'source-track',
                        name: 'Intro',
                        startBeat: 0,
                        endBeat: 4,
                        type: 'midi',
                    },
                    notes: generatedNotes,
                },
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    });
});
