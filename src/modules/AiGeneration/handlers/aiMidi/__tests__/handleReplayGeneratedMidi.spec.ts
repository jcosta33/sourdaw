import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiClipNoteSnapshot } from '#/utils/handlerContract';

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
const invalidCurves: Array<{ name: string; note: MidiClipNoteSnapshot }> = [
    {
        name: 'duration endpoint',
        note: { ...generatedNotes[0]!, expression: { pressure: [{ offsetBeats: 1, value: 90 }] } },
    },
    { name: 'zero offset', note: { ...generatedNotes[0]!, expression: { pressure: [{ offsetBeats: 0, value: 90 }] } } },
    {
        name: 'past duration',
        note: { ...generatedNotes[0]!, expression: { pressure: [{ offsetBeats: 2, value: 90 }] } },
    },
    {
        name: 'duplicate offsets',
        note: {
            ...generatedNotes[0]!,
            expression: {
                slide: [
                    { offsetBeats: 0.25, value: 90 },
                    { offsetBeats: 0.25, value: 80 },
                ],
            },
        },
    },
    {
        name: 'out of order',
        note: {
            ...generatedNotes[0]!,
            expression: {
                slide: [
                    { offsetBeats: 0.75, value: 90 },
                    { offsetBeats: 0.25, value: 80 },
                ],
            },
        },
    },
    { name: 'empty curve', note: { ...generatedNotes[0]!, expression: { slide: [] } } },
    {
        name: 'pressure above range',
        note: { ...generatedNotes[0]!, expression: { pressure: [{ offsetBeats: 0.5, value: 128 }] } },
    },
    {
        name: 'slide above range',
        note: { ...generatedNotes[0]!, expression: { slide: [{ offsetBeats: 0.5, value: 128 }] } },
    },
    {
        name: 'bend above range',
        note: { ...generatedNotes[0]!, expression: { pitchBend: [{ offsetBeats: 0.5, value: 8192 }] } },
    },
];

describe('handleReplayGeneratedMidi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'source-track', kind: 'midi', clips: [sourceClip] }],
        });
    });

    it('refuses a generated expression endpoint before creating a clip', async () => {
        mocks.hasDurableMidiGenerationResult.mockReturnValue(true);
        const result = await handleReplayGeneratedMidi.execute({
            type: 'replayGeneratedMidi',
            payload: {
                operation: {
                    kind: 'create-clip',
                    source: { trackId: 'source-track', clip: sourceClip, notes: sourceNotes },
                    targetTrackId: 'source-track',
                    clip: { ...sourceClip, id: 'generated-clip' },
                    notes: [{ ...generatedNotes[0]!, expression: { pressure: [{ offsetBeats: 1, value: 90 }] } }],
                },
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    });

    it.each(invalidCurves)('refuses $name before any create-track side effect', async ({ note }) => {
        mocks.hasDurableMidiGenerationResult.mockReturnValue(true);
        const track = {
            id: 'generated-track',
            kind: 'midi',
            clips: [
                {
                    id: 'generated-clip',
                    trackId: 'generated-track',
                    name: 'Generated',
                    startBeat: 0,
                    endBeat: 4,
                    type: 'midi',
                },
            ],
        };
        const result = await handleReplayGeneratedMidi.execute({
            type: 'replayGeneratedMidi',
            payload: {
                operation: {
                    kind: 'create-track',
                    source: { trackId: 'source-track', clip: sourceClip, notes: sourceNotes },
                    trackJson: JSON.stringify(track),
                    trackIndex: 1,
                    clip: { ...sourceClip, id: 'generated-clip', trackId: 'generated-track', name: 'Generated' },
                    notes: [note],
                },
            },
        });
        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.restoreTrack).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    });

    it('validates replace-notes expected and replacement arrays before idempotency or mutation', async () => {
        mocks.hasDurableMidiGenerationResult.mockReturnValue(true);
        const cases: Array<{ expectedNotes: MidiClipNoteSnapshot[]; replacementNotes: MidiClipNoteSnapshot[] }> = [
            { expectedNotes: [invalidCurves[0]!.note], replacementNotes: generatedNotes },
            { expectedNotes: sourceNotes, replacementNotes: [invalidCurves[1]!.note] },
        ];
        for (const { expectedNotes, replacementNotes } of cases) {
            const result = await handleReplayGeneratedMidi.execute({
                type: 'replayGeneratedMidi',
                payload: {
                    operation: {
                        kind: 'replace-notes',
                        trackId: 'source-track',
                        clip: sourceClip,
                        expectedNotes,
                        replacementNotes,
                    },
                },
            });
            expect(result).toEqual({ status: 'conflict' });
        }
        expect(mocks.hasDurableMidiGenerationResult).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    });

    it('keeps an already durable valid expression replay idempotent', async () => {
        mocks.hasDurableMidiGenerationResult.mockReturnValue(true);
        const result = await handleReplayGeneratedMidi.execute({
            type: 'replayGeneratedMidi',
            payload: {
                operation: {
                    kind: 'replace-notes',
                    trackId: 'source-track',
                    clip: sourceClip,
                    expectedNotes: sourceNotes,
                    replacementNotes: [
                        { ...generatedNotes[0]!, expression: { pressure: [{ offsetBeats: 0.5, value: 90 }] } },
                    ],
                },
            },
        });
        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    });

    it('validates a create-clip source array before source lookup or addClip', async () => {
        const result = await handleReplayGeneratedMidi.execute({
            type: 'replayGeneratedMidi',
            payload: {
                operation: {
                    kind: 'create-clip',
                    source: { trackId: 'source-track', clip: sourceClip, notes: [invalidCurves[0]!.note] },
                    targetTrackId: 'source-track',
                    clip: { ...sourceClip, id: 'generated-clip' },
                    notes: generatedNotes,
                },
            },
        });
        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.hasDurableMidiGenerationResult).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
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
