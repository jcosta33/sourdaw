import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTrackState } from '#/modules/Arrangement/stores';
import { createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';

import { generateMidiVariations } from '../generateMidiVariations';

import type { AppAction } from '#/utils/handlerContract';

const mocks = vi.hoisted(() => ({
    captureProjectRevision: vi.fn(() => 'revision-1'),
    executeAppActionBatch: vi.fn(),
    generateWebLlmCompletion: vi.fn(),
    getNotesForClip: vi.fn(),
    getTrackStoreState: vi.fn(),
    resolveBackend: vi.fn(() => 'cloud'),
    streamCloudChatCompletion: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiRuntime/useCases')>()),
    generateWebLlmCompletion: mocks.generateWebLlmCompletion,
    resolveBackend: mocks.resolveBackend,
    streamCloudChatCompletion: mocks.streamCloudChatCompletion,
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeAppActionBatch: mocks.executeAppActionBatch,
    executeUserAppAction: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    captureProjectRevision: mocks.captureProjectRevision,
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    getNotesForClip: mocks.getNotesForClip,
}));

const sourceState = {
    tracks: [
        {
            id: 'track-1',
            clips: [{ id: 'clip-1', name: 'Verse', type: 'midi', startBeat: 8, endBeat: 12 }],
        },
    ],
};
const variationsJson = JSON.stringify({
    variations: [
        [{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
        [{ pitch: 62, startBeat: 1, duration: 0.5, velocity: 90 }],
        [{ pitch: 64, startBeat: 2, duration: 1, velocity: 80 }],
    ],
});

describe('generateMidiVariations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.captureProjectRevision.mockReturnValue('revision-1');
        mocks.getTrackStoreState.mockReturnValue(sourceState);
        mocks.getNotesForClip.mockReturnValue([{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }]);
        mocks.resolveBackend.mockReturnValue('cloud');
        mocks.streamCloudChatCompletion.mockImplementation((_messages, onToken) => {
            onToken(variationsJson);
            return Promise.resolve({ status: 'complete' });
        });
        mocks.executeAppActionBatch.mockResolvedValue({ status: 'committed', actions: [] });
    });

    it('streams hosted variations and applies the validated result as one compensable batch', async () => {
        await expect(generateMidiVariations('clip-1')).resolves.toBe(3);

        const [actions, options] = mocks.executeAppActionBatch.mock.calls[0] as [
            Array<{ type: string; payload: Record<string, unknown> }>,
            { source: string; requireCompensation: boolean },
        ];
        expect(actions.map((action) => action.type)).toEqual([
            'addClip',
            'addNotes',
            'addClip',
            'addNotes',
            'addClip',
            'addNotes',
        ]);
        expect(actions[0]?.payload).toMatchObject({ trackId: 'track-1', startBeat: 12, endBeat: 16 });
        expect(options).toMatchObject({ source: 'ai', requireCompensation: true });
    });

    it('draws compensable variations from a locked source clip', async () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 'track-1',
                    clips: [{ id: 'clip-1', name: 'Verse', type: 'midi', startBeat: 8, endBeat: 12, locked: true }],
                },
            ],
        });
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [createTrack({ id: 'track-1', kind: 'midi', name: 'Keys' })],
        });

        await expect(generateMidiVariations('clip-1')).resolves.toBe(3);

        const actions = mocks.executeAppActionBatch.mock.calls[0]?.[0] as AppAction[];
        const clipLocks = actions
            .filter((action) => action.type === 'addClip')
            .map((action) => action.payload.locked ?? false);

        expect(clipLocks).toEqual([false, false, false]);
        // A variation batch is dispatched with requireCompensation, and addNotes only describes an
        // inverse for a clip its own batch created unlocked — a copied source lock rejects the batch.
        const addNotes = getMidiNoteTransformHandlers().addNotes;
        const inverses = actions.map((action, actionIndex) =>
            action.type === 'addNotes' ? addNotes.describe(action, { actions, actionIndex }).inverseAction : undefined
        );

        expect(inverses.filter((inverse) => inverse !== null && inverse !== undefined)).toHaveLength(3);
    });

    it('does not dispatch a write after incomplete hosted output', async () => {
        mocks.streamCloudChatCompletion.mockImplementation((_messages, onToken) => {
            onToken(variationsJson);
            return Promise.resolve({ status: 'incomplete', reason: 'max_tokens' });
        });

        await expect(generateMidiVariations('clip-1')).rejects.toThrow(
            'Hosted AI MIDI variations were incomplete (max_tokens).'
        );
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('uses WebLLM output through the same validation and write boundary', async () => {
        mocks.resolveBackend.mockReturnValue('webllm');
        mocks.generateWebLlmCompletion.mockResolvedValue(variationsJson);

        await expect(generateMidiVariations('clip-1')).resolves.toBe(3);
        expect(mocks.generateWebLlmCompletion).toHaveBeenCalledOnce();
        expect(mocks.executeAppActionBatch).toHaveBeenCalledOnce();
    });
});
