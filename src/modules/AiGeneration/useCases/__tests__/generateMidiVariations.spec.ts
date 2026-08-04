import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateMidiVariations } from '../generateMidiVariations';

type CloudChatOutcome = { status: 'complete' } | { status: 'incomplete'; reason: string };
type InitializedBackend = Awaited<ReturnType<typeof import('#/modules/AiRuntime/useCases').initEngine>>;

const mocks = vi.hoisted(() => ({
    captureProjectRevision: vi.fn(() => 'revision-1'),
    executeAppActionBatch: vi.fn(),
    getNotesForClip: vi.fn(),
    getTrackStoreState: vi.fn(),
    generateNativeCompletion: vi.fn(),
    initEngine: vi.fn<() => Promise<InitializedBackend>>(),
    isNativeEngineReady: vi.fn(() => false),
    resolveBackend: vi.fn(() => 'cloud'),
    streamCloudChatCompletion:
        vi.fn<(messages: unknown, onToken: (token: string) => void) => Promise<CloudChatOutcome>>(),
}));

vi.mock('#/modules/AiRuntime/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiRuntime/useCases')>()),
    generateNativeCompletion: mocks.generateNativeCompletion,
    initEngine: mocks.initEngine,
    isNativeEngineReady: mocks.isNativeEngineReady,
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
            clips: [
                {
                    id: 'clip-1',
                    name: 'Verse',
                    type: 'midi',
                    startBeat: 8,
                    endBeat: 12,
                    midiOffsetBeats: 0.5,
                    fadeInBeats: 0.25,
                    fadeOutBeats: 0.5,
                    gain: 0.8,
                    color: '#123456',
                    locked: true,
                    stretchMode: 'repitch',
                    stretchRatio: 1.25,
                    loopEnabled: true,
                    loopLength: 2,
                    followAction: 'play_next',
                    isGhost: true,
                },
            ],
        },
    ],
};
const sourceNotes = [{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }];
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
        mocks.getNotesForClip.mockReturnValue(sourceNotes);
        mocks.initEngine.mockResolvedValue('native');
        mocks.isNativeEngineReady.mockReturnValue(false);
        mocks.resolveBackend.mockReturnValue('cloud');
        mocks.streamCloudChatCompletion.mockImplementation((_messages, onToken) => {
            onToken(variationsJson);
            return Promise.resolve({ status: 'complete' });
        });
        mocks.executeAppActionBatch.mockResolvedValue({ status: 'committed', actions: [] });
    });

    it('applies validated variations as one compensable AppAction batch', async () => {
        const count = await generateMidiVariations('clip-1');

        expect(count).toBe(3);
        const [actions, options] = mocks.executeAppActionBatch.mock.calls[0] as [
            Array<{ type: string; payload: Record<string, unknown> }>,
            { source: string; requireCompensation: boolean; shouldExecute: () => boolean },
        ];
        expect(actions.map((action) => action.type)).toEqual([
            'addClip',
            'addNotes',
            'addClip',
            'addNotes',
            'addClip',
            'addNotes',
        ]);
        expect(actions[0]?.payload).toMatchObject({
            trackId: 'track-1',
            startBeat: 12,
            endBeat: 16,
            name: 'Verse (Var 1)',
            midiOffsetBeats: 0.5,
            fadeInBeats: 0.25,
            fadeOutBeats: 0.5,
            gain: 0.8,
            color: '#123456',
            locked: true,
            muted: true,
            stretchMode: 'repitch',
            stretchRatio: 1.25,
            loopEnabled: true,
            loopLength: 2,
            followAction: 'play_next',
            isGhost: true,
        });
        expect(actions[1]?.payload.notes).toEqual([{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }]);
        expect(actions[2]?.payload).toMatchObject({ startBeat: 16, endBeat: 20, name: 'Verse (Var 2)' });
        expect(actions[3]?.payload.notes).toEqual([{ pitch: 62, startBeat: 1, duration: 0.5, velocity: 90 }]);
        expect(actions[4]?.payload).toMatchObject({ startBeat: 20, endBeat: 24, name: 'Verse (Var 3)' });
        expect(actions[5]?.payload.notes).toEqual([{ pitch: 64, startBeat: 2, duration: 1, velocity: 80 }]);
        expect(options).toMatchObject({ source: 'ai', requireCompensation: true, skipMacroRecording: true });
        expect(options.shouldExecute()).toBe(true);
        const messages = mocks.streamCloudChatCompletion.mock.calls[0]?.[0] as Array<{ content: string }>;
        expect(messages[1]?.content).toContain('start=0.00');
        expect(messages[1]?.content).not.toContain('start=-8.00');
    });

    it('fails truthfully when project revision changes before execution', async () => {
        mocks.executeAppActionBatch.mockImplementation((_actions, options: { shouldExecute?: () => boolean }) => {
            mocks.captureProjectRevision.mockReturnValue('revision-2');
            return Promise.resolve(
                options.shouldExecute?.()
                    ? { status: 'committed' as const, actions: [] }
                    : { status: 'cancelled' as const, reason: 'revoked', actions: [] }
            );
        });

        await expect(generateMidiVariations('clip-1')).rejects.toThrow(/project changed/);
    });

    it('does not report success when the action batch rejects the write', async () => {
        mocks.executeAppActionBatch.mockResolvedValue({ status: 'rejected', reason: 'ineligible track', actions: [] });

        await expect(generateMidiVariations('clip-1')).rejects.toThrow(
            'Failed to apply MIDI variations: ineligible track'
        );
    });

    it('rejects incomplete hosted output before dispatch', async () => {
        mocks.streamCloudChatCompletion.mockImplementation((_messages, onToken) => {
            onToken(variationsJson);
            return Promise.resolve({ status: 'incomplete', reason: 'max_tokens' });
        });

        await expect(generateMidiVariations('clip-1')).rejects.toThrow(
            'Hosted AI MIDI variations were incomplete (max_tokens).'
        );
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('initializes the native backend before requesting variations', async () => {
        mocks.resolveBackend.mockReturnValue('native');
        mocks.isNativeEngineReady.mockReturnValueOnce(false).mockReturnValue(true);
        mocks.generateNativeCompletion.mockResolvedValue(variationsJson);

        await expect(generateMidiVariations('clip-1')).resolves.toBe(3);

        expect(mocks.initEngine).toHaveBeenCalledOnce();
        expect(mocks.generateNativeCompletion).toHaveBeenCalledOnce();
    });

    it('uses cloud when automatic native initialization selects the configured hosted fallback', async () => {
        mocks.resolveBackend.mockReturnValue('native');
        mocks.isNativeEngineReady.mockReturnValue(false);
        mocks.initEngine.mockResolvedValue('cloud');

        await expect(generateMidiVariations('clip-1')).resolves.toBe(3);

        expect(mocks.initEngine).toHaveBeenCalledOnce();
        expect(mocks.generateNativeCompletion).not.toHaveBeenCalled();
        expect(mocks.streamCloudChatCompletion).toHaveBeenCalledOnce();
    });

    it('rejects malformed provider notes before dispatch', async () => {
        mocks.streamCloudChatCompletion.mockImplementation((_messages, onToken) => {
            onToken(JSON.stringify({ variations: [[{ pitch: 999, startBeat: 0, duration: 1, velocity: 100 }]] }));
            return Promise.resolve({ status: 'complete' });
        });

        await expect(generateMidiVariations('clip-1')).rejects.toThrow(/invalid "variations" array/);
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('rejects notes that extend past the source clip duration', async () => {
        mocks.streamCloudChatCompletion.mockImplementation((_messages, onToken) => {
            onToken(
                JSON.stringify({
                    variations: [
                        [{ pitch: 60, startBeat: 3.75, duration: 0.5, velocity: 100 }],
                        [{ pitch: 62, startBeat: 0, duration: 1, velocity: 90 }],
                        [{ pitch: 64, startBeat: 0, duration: 1, velocity: 80 }],
                    ],
                })
            );
            return Promise.resolve({ status: 'complete' });
        });

        await expect(generateMidiVariations('clip-1')).rejects.toThrow(/invalid "variations" array/);
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('rejects extra provider fields instead of accepting a second command protocol', async () => {
        mocks.streamCloudChatCompletion.mockImplementation((_messages, onToken) => {
            onToken(
                JSON.stringify({
                    variations: [[{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }]],
                    action: { type: 'removeAllTracks' },
                })
            );
            return Promise.resolve({ status: 'complete' });
        });

        await expect(generateMidiVariations('clip-1')).rejects.toThrow(/invalid "variations" array/);
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('rejects missing and empty source clips before inference', async () => {
        mocks.getTrackStoreState.mockReturnValue(null);
        await expect(generateMidiVariations('clip-1')).rejects.toThrow(/Track state unavailable/);

        mocks.getTrackStoreState.mockReturnValue(sourceState);
        mocks.getNotesForClip.mockReturnValue([]);
        await expect(generateMidiVariations('clip-1')).rejects.toThrow(/no notes to vary/);
        expect(mocks.streamCloudChatCompletion).not.toHaveBeenCalled();
    });
});
