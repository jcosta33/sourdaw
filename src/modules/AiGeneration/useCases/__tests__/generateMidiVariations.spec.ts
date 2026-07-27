import { describe, it, expect, vi, beforeEach } from 'vitest';

type CloudChatOutcome = { status: 'complete' } | { status: 'incomplete'; reason: string };

const { streamCloudChatCompletionMock, resolveBackendMock } = vi.hoisted(() => ({
    streamCloudChatCompletionMock:
        vi.fn<(messages: unknown, onToken: (token: string) => void) => Promise<CloudChatOutcome>>(),
    resolveBackendMock: vi.fn<(...args: unknown[]) => unknown>(),
}));

const { getTrackStoreStateMock, createAlternativeClipsMock, setTrackStoreStateMock, trackStateMock } = vi.hoisted(
    () => {
        const trackStateMock: { value: unknown } = { value: null };

        return {
            getTrackStoreStateMock: vi.fn<() => unknown>(() => trackStateMock.value),
            createAlternativeClipsMock: vi.fn<(...args: unknown[]) => unknown>(),
            setTrackStoreStateMock: vi.fn<(value: unknown) => void>(),
            trackStateMock,
        };
    }
);

const { getMidiStoreStateMock, getNotesForClipMock, setMidiStoreStateMock, midiStateMock } = vi.hoisted(() => {
    const midiStateMock: { value: unknown } = { value: null };

    return {
        getMidiStoreStateMock: vi.fn<() => unknown>(() => midiStateMock.value),
        getNotesForClipMock: vi.fn<(...args: unknown[]) => unknown>(),
        setMidiStoreStateMock: vi.fn<(value: unknown) => void>(),
        midiStateMock,
    };
});

const { pushUndoEntryMock } = vi.hoisted(() => ({
    pushUndoEntryMock: vi.fn<(...args: unknown[]) => unknown>(),
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
    getMidiStoreState: getMidiStoreStateMock,
    getNotesForClip: getNotesForClipMock,
    setMidiStoreState: setMidiStoreStateMock,
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    pushUndoEntry: pushUndoEntryMock,
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
        trackStateMock.value = null;
        midiStateMock.value = null;
        resolveBackendMock.mockReturnValue('cloud');
        getNotesForClipMock.mockReturnValue(validNotes);
        streamCloudChatCompletionMock.mockResolvedValue({ status: 'complete' });
    });

    it('throws when track state is unavailable', async () => {
        await expect(generateMidiVariations('clip-1')).rejects.toThrow(/Track state unavailable/);
        expect(streamCloudChatCompletionMock).not.toHaveBeenCalled();
    });

    it('parses variations, creates alternative clips, and pushes a restorable undo entry', async () => {
        const trackLookupState = midiClipState;
        const trackSnapshotBefore = {
            tracks: [
                {
                    clips: [{ id: 'clip-1', type: 'midi', startBeat: 0, endBeat: 4 }],
                    name: 'Edited while AI generated',
                },
            ],
        };
        const midiSnapshotBefore = { snapshot: 'midi-before' };
        const trackSnapshotAfter = { snapshot: 'track-after' };
        const midiSnapshotAfter = { snapshot: 'midi-after' };
        trackStateMock.value = trackLookupState;
        midiStateMock.value = midiSnapshotBefore;
        streamCloudChatCompletionMock.mockImplementation((_messages: unknown, onToken: (token: string) => void) => {
            onToken(validVariationsJson);
            trackStateMock.value = trackSnapshotBefore;
            return Promise.resolve({ status: 'complete' as const });
        });

        // Distinct lookup/before/after snapshots prove undo reads the owner getter
        // after the async model response, not the stale initial lookup state.
        createAlternativeClipsMock.mockImplementation(() => {
            trackStateMock.value = trackSnapshotAfter;
            midiStateMock.value = midiSnapshotAfter;
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
        expect(setTrackStoreStateMock).toHaveBeenLastCalledWith(trackSnapshotBefore);
        expect(setMidiStoreStateMock).toHaveBeenLastCalledWith(midiSnapshotBefore);

        // Redo restores the post-mutation snapshots, also through the owning use-cases.
        redoFn();
        expect(setTrackStoreStateMock).toHaveBeenLastCalledWith(trackSnapshotAfter);
        expect(setMidiStoreStateMock).toHaveBeenLastCalledWith(midiSnapshotAfter);
    });

    it('drops out-of-range and non-finite variation notes before creating clips', async () => {
        trackStateMock.value = midiClipState;
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
            return Promise.resolve({ status: 'complete' as const });
        });

        const count = await generateMidiVariations('clip-1');

        expect(count).toBe(1);
        expect(createAlternativeClipsMock).toHaveBeenCalledWith('clip-1', [
            [{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
        ]);
    });

    it('extracts the variations object from a multi-object response, skipping a preamble', async () => {
        trackStateMock.value = midiClipState;
        // A leading "thinking" object (with brace-containing string), then the real
        // variations object, then trailing junk. A greedy /\{[\s\S]*\}/ would span
        // from the first { to the last } and merge all three into one unparseable blob.
        const multiObject = `{"thinking":"about {nested} braces"}\n${validVariationsJson}\n{"trailing":"junk"}`;
        streamCloudChatCompletionMock.mockImplementation((_messages: unknown, onToken: (token: string) => void) => {
            onToken(multiObject);
            return Promise.resolve({ status: 'complete' as const });
        });

        const count = await generateMidiVariations('clip-1');

        expect(count).toBe(2);
        expect(createAlternativeClipsMock).toHaveBeenCalledWith('clip-1', [
            [{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            [{ pitch: 62, startBeat: 1, duration: 0.5, velocity: 90 }],
        ]);
    });

    it('rejects a clip whose duration computes to NaN before prompting the model', async () => {
        trackStateMock.value = {
            tracks: [
                {
                    clips: [{ id: 'clip-1', type: 'midi', startBeat: Number.NaN, endBeat: 4 }],
                },
            ],
        };

        await expect(generateMidiVariations('clip-1')).rejects.toThrow(/zero or negative duration/);
        expect(streamCloudChatCompletionMock).not.toHaveBeenCalled();
    });

    it('throws when the target clip is not a MIDI clip', async () => {
        trackStateMock.value = {
            tracks: [{ clips: [{ id: 'clip-1', type: 'audio', startBeat: 0, endBeat: 4 }] }],
        };

        await expect(generateMidiVariations('clip-1')).rejects.toThrow(/must be a MIDI clip/);
        expect(streamCloudChatCompletionMock).not.toHaveBeenCalled();
    });

    it('throws when the MIDI clip has no notes to vary', async () => {
        trackStateMock.value = midiClipState;
        getNotesForClipMock.mockReturnValue([]);

        await expect(generateMidiVariations('clip-1')).rejects.toThrow(/no notes to vary/);
        expect(streamCloudChatCompletionMock).not.toHaveBeenCalled();
    });

    it('throws when no AI backend is available', async () => {
        trackStateMock.value = midiClipState;
        resolveBackendMock.mockReturnValue('none');

        await expect(generateMidiVariations('clip-1')).rejects.toThrow(/No AI backend available/);
        expect(streamCloudChatCompletionMock).not.toHaveBeenCalled();
    });

    it('rejects incomplete hosted output before creating clips or undo history', async () => {
        trackStateMock.value = midiClipState;
        streamCloudChatCompletionMock.mockImplementation((_messages, onToken) => {
            onToken(validVariationsJson);
            return Promise.resolve({ status: 'incomplete', reason: 'max_tokens' });
        });

        await expect(generateMidiVariations('clip-1')).rejects.toThrow(
            'Hosted AI MIDI variations were incomplete (max_tokens).'
        );
        expect(createAlternativeClipsMock).not.toHaveBeenCalled();
        expect(pushUndoEntryMock).not.toHaveBeenCalled();
    });

    it('throws when the model response contains no JSON object', async () => {
        trackStateMock.value = midiClipState;
        streamCloudChatCompletionMock.mockImplementation((_messages: unknown, onToken: (token: string) => void) => {
            onToken('sorry, I cannot help with that.');
            return Promise.resolve({ status: 'complete' as const });
        });

        await expect(generateMidiVariations('clip-1')).rejects.toThrow(/No JSON object found/);
    });

    it('throws when every variation entry is malformed (non-array or non-object notes)', async () => {
        trackStateMock.value = midiClipState;
        // "not-an-array" fails the Array.isArray guard; [null] fails the object/null guard.
        // Both are rejected by isVariationNoteArray, leaving zero valid variations.
        const allInvalidJson = JSON.stringify({ variations: ['not-an-array', [null]] });
        streamCloudChatCompletionMock.mockImplementation((_messages: unknown, onToken: (token: string) => void) => {
            onToken(allInvalidJson);
            return Promise.resolve({ status: 'complete' as const });
        });

        await expect(generateMidiVariations('clip-1')).rejects.toThrow(/no valid variation note arrays/);
        expect(createAlternativeClipsMock).not.toHaveBeenCalled();
    });
});
