import { describe, it, expect, vi, beforeEach } from 'vitest';

const { streamCloudChatCompletionMock, resolveBackendMock } = vi.hoisted(() => ({
    streamCloudChatCompletionMock: vi.fn<(...args: unknown[]) => unknown>(),
    resolveBackendMock: vi.fn<(...args: unknown[]) => unknown>(),
}));

const { getTrackStoreStateMock, createAlternativeClipsMock, setTrackStoreStateMock } = vi.hoisted(() => ({
    getTrackStoreStateMock: vi.fn<(...args: unknown[]) => unknown>().mockReturnValue(null),
    createAlternativeClipsMock: vi.fn<(...args: unknown[]) => unknown>(),
    setTrackStoreStateMock: vi.fn<(value: unknown) => void>(),
}));

const { getNotesForClipMock, setMidiStoreStateMock } = vi.hoisted(() => ({
    getNotesForClipMock: vi.fn<(...args: unknown[]) => unknown>(),
    setMidiStoreStateMock: vi.fn<(value: unknown) => void>(),
}));

const { pushUndoEntryMock } = vi.hoisted(() => ({
    pushUndoEntryMock: vi.fn<(...args: unknown[]) => unknown>(),
}));

const { trackStoreMock, midiStoreMock } = vi.hoisted(() => ({
    trackStoreMock: { value: null as unknown, set: vi.fn<(value: unknown) => void>() },
    midiStoreMock: { value: null as unknown, set: vi.fn<(value: unknown) => void>() },
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    getTrackStoreState: getTrackStoreStateMock,
    createAlternativeClips: createAlternativeClipsMock,
    setTrackStoreState: setTrackStoreStateMock,
}));

vi.mock('#/modules/AiRuntime/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiRuntime/useCases')>()),
    streamCloudChatCompletion: streamCloudChatCompletionMock,
    resolveBackend: resolveBackendMock,
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    getNotesForClip: getNotesForClipMock,
    setMidiStoreState: setMidiStoreStateMock,
}));

vi.mock('#/modules/Command/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/stores')>()),
    pushUndoEntry: pushUndoEntryMock,
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: trackStoreMock,
}));

vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
    midiStore: midiStoreMock,
}));

import { generateMidiVariations } from '../generateMidiVariations';

const midiClipState = {
    tracks: [
        {
            clips: [{ id: 'clip-1', type: 'midi', startBeat: 0, endBeat: 4 }],
        },
    ],
};

const validNotes = [{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }];

const validVariationsJson = JSON.stringify({
    variations: [
        [{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
        [{ pitch: 62, startBeat: 1, duration: 0.5, velocity: 90 }],
    ],
});

describe('generateMidiVariations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getTrackStoreStateMock.mockReturnValue(null);
        resolveBackendMock.mockReturnValue('cloud');
        getNotesForClipMock.mockReturnValue(validNotes);
        trackStoreMock.value = null;
        midiStoreMock.value = null;
    });

    it('throws when track state is unavailable', async () => {
        await expect(generateMidiVariations('clip-1')).rejects.toThrow(/Track state unavailable/);
        expect(streamCloudChatCompletionMock).not.toHaveBeenCalled();
    });

    it('parses variations, creates alternative clips, and pushes a restorable undo entry', async () => {
        getTrackStoreStateMock.mockReturnValue(midiClipState);
        streamCloudChatCompletionMock.mockImplementation((_messages: unknown, onToken: (token: string) => void) => {
            onToken(validVariationsJson);
            return Promise.resolve();
        });

        // Distinct before/after snapshots so we can prove the right one is restored on each side.
        trackStoreMock.value = { snapshot: 'track-before' };
        midiStoreMock.value = { snapshot: 'midi-before' };
        createAlternativeClipsMock.mockImplementation(() => {
            trackStoreMock.value = { snapshot: 'track-after' };
            midiStoreMock.value = { snapshot: 'midi-after' };
        });

        const count = await generateMidiVariations('clip-1');

        expect(count).toBe(2);
        expect(createAlternativeClipsMock).toHaveBeenCalledWith('clip-1', [
            [{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            [{ pitch: 62, startBeat: 1, duration: 0.5, velocity: 90 }],
        ]);
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);

        const [label, undoFn, redoFn, undoOptions] = pushUndoEntryMock.mock.calls[0] as [
            string,
            () => void,
            () => void,
            { source: string },
        ];
        expect(label).toBe('AI Variations: clip-1');
        expect(undoOptions).toEqual({ source: 'ai' });

        // Undo restores the pre-mutation snapshots captured before createAlternativeClips
        // ran, routed through the owning modules' write-path use-cases (not a direct
        // foreign-store.set).
        undoFn();
        expect(setTrackStoreStateMock).toHaveBeenLastCalledWith({ snapshot: 'track-before' });
        expect(setMidiStoreStateMock).toHaveBeenLastCalledWith({ snapshot: 'midi-before' });

        // Redo restores the post-mutation snapshots, also through the owning use-cases.
        redoFn();
        expect(setTrackStoreStateMock).toHaveBeenLastCalledWith({ snapshot: 'track-after' });
        expect(setMidiStoreStateMock).toHaveBeenLastCalledWith({ snapshot: 'midi-after' });
    });

    it('drops out-of-range and non-finite variation notes before creating clips', async () => {
        getTrackStoreStateMock.mockReturnValue(midiClipState);
        // First variation is valid; second carries an out-of-range pitch and must be rejected.
        const mixedJson = JSON.stringify({
            variations: [
                [{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
                [{ pitch: 999, startBeat: 0, duration: 1, velocity: 100 }],
                [{ pitch: 64, startBeat: 0, duration: Number.NaN, velocity: 100 }],
            ],
        });
        streamCloudChatCompletionMock.mockImplementation((_messages: unknown, onToken: (token: string) => void) => {
            onToken(mixedJson);
            return Promise.resolve();
        });

        const count = await generateMidiVariations('clip-1');

        expect(count).toBe(1);
        expect(createAlternativeClipsMock).toHaveBeenCalledWith('clip-1', [
            [{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
        ]);
    });

    it('extracts the variations object from a multi-object response, skipping a preamble', async () => {
        getTrackStoreStateMock.mockReturnValue(midiClipState);
        // A leading "thinking" object (with brace-containing string), then the real
        // variations object, then trailing junk. A greedy /\{[\s\S]*\}/ would span
        // from the first { to the last } and merge all three into one unparseable blob.
        const multiObject = `{"thinking":"about {nested} braces"}\n${validVariationsJson}\n{"trailing":"junk"}`;
        streamCloudChatCompletionMock.mockImplementation((_messages: unknown, onToken: (token: string) => void) => {
            onToken(multiObject);
            return Promise.resolve();
        });

        const count = await generateMidiVariations('clip-1');

        expect(count).toBe(2);
        expect(createAlternativeClipsMock).toHaveBeenCalledWith('clip-1', [
            [{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            [{ pitch: 62, startBeat: 1, duration: 0.5, velocity: 90 }],
        ]);
    });

    it('rejects a clip whose duration computes to NaN before prompting the model', async () => {
        getTrackStoreStateMock.mockReturnValue({
            tracks: [
                {
                    clips: [{ id: 'clip-1', type: 'midi', startBeat: Number.NaN, endBeat: 4 }],
                },
            ],
        });

        await expect(generateMidiVariations('clip-1')).rejects.toThrow(/zero or negative duration/);
        expect(streamCloudChatCompletionMock).not.toHaveBeenCalled();
    });
});
