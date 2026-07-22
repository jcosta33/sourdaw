import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiNote } from '../../../models/MidiNoteViewTypes';
import { setClipClipboard, type ClipboardEntry } from '../../../stores/clipboardStore';
import { pasteClip } from '../pasteClip';

type AddClipInput = {
    audioBufferId?: string;
    endBeat: number;
    name: string;
    startBeat: number;
    trackId: string;
    type?: 'audio' | 'midi';
};

type MockTrackState = {
    selectedTrackId: string | null;
    tracks: Array<{ id: string }>;
};

const mocks = vi.hoisted(() => {
    const transportState = { value: null as object | null };
    const readTransportState = vi.fn(() => transportState.value);

    return {
        addClip: vi.fn<(input: AddClipInput) => { id: string } | null>(),
        getTrackState: vi.fn<() => MockTrackState | null>(),
        removeClip: vi.fn<(clipId: string) => void>(),
        resolveEligibleClipWriteTarget: vi.fn(),
        setNotesForClip: vi.fn<(clipId: string, notes: MidiNote[]) => void>(),
        readTransportState,
        transportState,
        transportStore: {
            get value() {
                return readTransportState();
            },
        },
        playheadPositionRef: { current: 0 },
    };
});

vi.mock('#/modules/MIDI/useCases', () => ({
    setNotesForClip: mocks.setNotesForClip,
}));
vi.mock('#/modules/Transport/stores', () => ({
    playheadPositionRef: mocks.playheadPositionRef,
    transportStore: mocks.transportStore,
}));
vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));
vi.mock('../../clip/addClip', () => ({
    addClip: mocks.addClip,
}));
vi.mock('../../clip/removeClip', () => ({
    removeClip: mocks.removeClip,
}));
vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

function createClipboardEntry(
    input: {
        endBeat?: number;
        clipId?: string;
        midiNotes?: MidiNote[];
        name?: string;
        sourceTrackId?: string;
        startBeat?: number;
    } = {}
): ClipboardEntry {
    const sourceTrackId = input.sourceTrackId ?? 'source-track';

    return {
        sourceTrackId,
        clip: {
            id: input.clipId ?? 'source-clip',
            trackId: sourceTrackId,
            name: input.name ?? 'Source clip',
            startBeat: input.startBeat ?? 4,
            endBeat: input.endBeat ?? 8,
            type: 'midi',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '',
            locked: false,
            muted: false,
        },
        midiNotes: input.midiNotes,
    };
}

describe('pasteClip', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.addClip.mockReset();
        mocks.getTrackState.mockReset();
        mocks.removeClip.mockReset();
        mocks.setNotesForClip.mockReset();
        mocks.readTransportState.mockClear();
        mocks.resolveEligibleClipWriteTarget.mockReset();
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { trackId: string }) => ({
            status: 'eligible',
            trackId: input.trackId,
        }));
        mocks.transportState.value = {};
        mocks.playheadPositionRef.current = 0;
        setClipClipboard([]);
    });

    it('returns before transport or track work when the clip clipboard is empty', () => {
        expect(pasteClip()).toBe(false);

        expect(mocks.getTrackState).not.toHaveBeenCalled();
        expect(mocks.readTransportState).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    });

    it.each([
        { name: 'transport is unavailable', transport: null, trackState: { selectedTrackId: null, tracks: [] } },
        { name: 'track state is unavailable', transport: {}, trackState: null },
    ])('does no clip or MIDI work when $name', ({ transport, trackState }) => {
        setClipClipboard([createClipboardEntry()]);
        mocks.transportState.value = transport;
        mocks.getTrackState.mockReturnValue(trackState);

        expect(pasteClip()).toBe(false);

        expect(mocks.readTransportState).toHaveBeenCalledTimes(1);
        expect(mocks.getTrackState).toHaveBeenCalledTimes(1);
        const getTrackStateOrder = mocks.getTrackState.mock.invocationCallOrder[0];
        if (getTrackStateOrder === undefined) {
            throw new Error('expected getTrackState to have been invoked');
        }
        expect(mocks.readTransportState.mock.invocationCallOrder[0]).toBeLessThan(getTrackStateOrder);
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    });

    it('pastes copied MIDI notes through the owner with regenerated ids and preserved properties', () => {
        const laterClipNotes: MidiNote[] = [
            {
                id: 'source-note-later',
                pitch: 67,
                startBeat: 0.5,
                duration: 2,
                velocity: 95,
                probability: 80,
                channel: 2,
            },
        ];
        const earlierClipNotes: MidiNote[] = [
            {
                id: 'source-note-one',
                pitch: 72,
                startBeat: 1.5,
                duration: 0.5,
                velocity: 110,
                probability: undefined,
                pressure: 0,
                slide: undefined,
                pitchBend: 2048,
                channel: undefined,
            },
            {
                id: 'source-note-two',
                pitch: 60,
                startBeat: 2,
                duration: 1,
                velocity: 90,
                probability: 75,
                pressure: undefined,
                slide: -0.5,
                pitchBend: undefined,
                channel: 9,
            },
        ];
        const randomUuid = vi
            .spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
            .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
            .mockReturnValueOnce('33333333-3333-4333-8333-333333333333');
        const uuidCallCountsAtOwner: number[] = [];
        mocks.playheadPositionRef.current = 12;
        mocks.getTrackState.mockReturnValue({
            selectedTrackId: 'selected-track',
            tracks: [{ id: 'selected-track' }],
        });
        mocks.addClip
            .mockReturnValueOnce({ id: 'pasted-later-clip' })
            .mockReturnValueOnce({ id: 'pasted-earlier-clip' });
        mocks.setNotesForClip.mockImplementation(() => {
            uuidCallCountsAtOwner.push(randomUuid.mock.calls.length);
        });
        setClipClipboard([
            createClipboardEntry({
                clipId: 'source-clip-later',
                startBeat: 9,
                endBeat: 11,
                name: 'Later clip',
                sourceTrackId: 'source-track-later',
                midiNotes: laterClipNotes,
            }),
            createClipboardEntry({
                clipId: 'source-clip-earlier',
                startBeat: 4,
                endBeat: 7,
                name: 'Earlier clip',
                sourceTrackId: 'source-track-earlier',
                midiNotes: earlierClipNotes,
            }),
        ]);

        expect(pasteClip()).toBe(true);

        expect(mocks.addClip).toHaveBeenCalledTimes(2);
        expect(mocks.addClip).toHaveBeenNthCalledWith(1, {
            trackId: 'selected-track',
            startBeat: 17,
            endBeat: 19,
            name: 'Later clip (paste)',
            type: 'midi',
            audioBufferId: undefined,
        });
        expect(mocks.addClip).toHaveBeenNthCalledWith(2, {
            trackId: 'selected-track',
            startBeat: 12,
            endBeat: 15,
            name: 'Earlier clip (paste)',
            type: 'midi',
            audioBufferId: undefined,
        });
        expect(mocks.setNotesForClip.mock.calls).toStrictEqual([
            [
                'pasted-later-clip',
                [
                    {
                        ...laterClipNotes[0],
                        id: 'note-11111111',
                    },
                ],
            ],
            [
                'pasted-earlier-clip',
                [
                    {
                        ...earlierClipNotes[0],
                        id: 'note-22222222',
                    },
                    {
                        ...earlierClipNotes[1],
                        id: 'note-33333333',
                    },
                ],
            ],
        ]);
        expect(uuidCallCountsAtOwner).toEqual([1, 3]);
        const [addClipOrderFirst, addClipOrderSecond] = mocks.addClip.mock.invocationCallOrder;
        const [setNotesOrderFirst, setNotesOrderSecond] = mocks.setNotesForClip.mock.invocationCallOrder;
        if (addClipOrderSecond === undefined || setNotesOrderFirst === undefined || setNotesOrderSecond === undefined) {
            throw new Error('expected two addClip and two setNotesForClip invocations');
        }
        expect(addClipOrderFirst).toBeLessThan(setNotesOrderFirst);
        expect(setNotesOrderFirst).toBeLessThan(addClipOrderSecond);
        expect(addClipOrderSecond).toBeLessThan(setNotesOrderSecond);
    });

    it('skips a clip when its target track is missing', () => {
        setClipClipboard([
            createClipboardEntry({
                midiNotes: [{ id: 'source-note', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
            }),
        ]);
        mocks.getTrackState.mockReturnValue({
            selectedTrackId: 'missing-track',
            tracks: [{ id: 'source-track' }],
        });

        expect(pasteClip()).toBe(false);

        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    });

    it('skips MIDI ownership work when addClip fails or copied notes are absent or empty', () => {
        mocks.getTrackState.mockReturnValue({
            selectedTrackId: null,
            tracks: [{ id: 'unrelated-track' }, { id: 'source-track' }],
        });
        mocks.addClip.mockReturnValue(null);
        const randomUuid = vi.spyOn(crypto, 'randomUUID');
        setClipClipboard([
            createClipboardEntry({
                midiNotes: [{ id: 'source-note', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
            }),
        ]);

        expect(pasteClip()).toBe(false);

        expect(mocks.addClip).toHaveBeenCalledTimes(1);
        expect(mocks.addClip).toHaveBeenCalledWith(expect.objectContaining({ trackId: 'source-track' }));
        expect(randomUuid).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();

        mocks.addClip.mockReturnValue({ id: 'pasted-clip' });
        setClipClipboard([
            createClipboardEntry({ clipId: 'source-clip-one' }),
            createClipboardEntry({ clipId: 'source-clip-two', midiNotes: [] }),
        ]);

        pasteClip();

        expect(randomUuid).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    });

    it('rejects all entries before allocation when one effective destination is ineligible', () => {
        const randomUuid = vi.spyOn(crypto, 'randomUUID');
        mocks.getTrackState.mockReturnValue({
            selectedTrackId: null,
            tracks: [{ id: 'track-1' }, { id: 'vca-1' }],
        });
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { trackId: string }) => {
            if (input.trackId === 'vca-1') {
                return { status: 'ineligible' };
            }
            return { status: 'eligible', trackId: input.trackId };
        });
        setClipClipboard([
            createClipboardEntry({ clipId: 'source-clip-one', sourceTrackId: 'track-1' }),
            createClipboardEntry({ clipId: 'source-clip-two', sourceTrackId: 'vca-1', midiNotes: [] }),
        ]);

        expect(pasteClip()).toBe(false);

        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(randomUuid).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    });

    it.each([
        {
            name: 'a non-string clip id',
            corrupt(entry: ClipboardEntry) {
                Reflect.set(entry.clip, 'id', 42);
            },
        },
        {
            name: 'non-string matching owner ids',
            corrupt(entry: ClipboardEntry) {
                Reflect.set(entry, 'sourceTrackId', 42);
                Reflect.set(entry.clip, 'trackId', 42);
            },
        },
        {
            name: 'empty matching owner ids',
            corrupt(entry: ClipboardEntry) {
                entry.sourceTrackId = '';
                entry.clip.trackId = '';
            },
        },
    ])('rejects $name before destination resolution or allocation', ({ corrupt }) => {
        const entry = createClipboardEntry();
        corrupt(entry);
        mocks.getTrackState.mockReturnValue({
            selectedTrackId: 'selected-track',
            tracks: [{ id: 'selected-track' }],
        });
        setClipClipboard([entry]);

        expect(pasteClip()).toBe(false);

        expect(mocks.resolveEligibleClipWriteTarget).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
        expect(mocks.removeClip).not.toHaveBeenCalled();
    });

    it('rejects duplicate source clip ids before destination resolution or allocation', () => {
        mocks.getTrackState.mockReturnValue({
            selectedTrackId: 'selected-track',
            tracks: [{ id: 'selected-track' }],
        });
        setClipClipboard([
            createClipboardEntry({ clipId: 'duplicate-source', sourceTrackId: 'source-track-one' }),
            createClipboardEntry({ clipId: 'duplicate-source', sourceTrackId: 'source-track-two' }),
        ]);

        expect(pasteClip()).toBe(false);

        expect(mocks.resolveEligibleClipWriteTarget).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
        expect(mocks.removeClip).not.toHaveBeenCalled();
    });

    it('rolls back Arrangement and MIDI state when the second add fails', () => {
        const arrangementClipIds = new Set(['existing-clip']);
        const midiState = new Map<string, MidiNote[]>([
            ['existing-clip', [{ id: 'existing-note', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }]],
        ]);
        const arrangementBefore = [...arrangementClipIds];
        const midiBefore = [...midiState];
        const pastedNotes: MidiNote[] = [{ id: 'source-note', pitch: 64, startBeat: 0, duration: 1, velocity: 100 }];
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');
        mocks.getTrackState.mockReturnValue({
            selectedTrackId: 'selected-track',
            tracks: [{ id: 'selected-track' }],
        });
        mocks.addClip
            .mockImplementationOnce(() => {
                arrangementClipIds.add('pasted-first');
                return { id: 'pasted-first' };
            })
            .mockReturnValueOnce(null);
        mocks.setNotesForClip.mockImplementation((clipId, notes) => {
            midiState.set(clipId, notes);
        });
        mocks.removeClip.mockImplementation((clipId) => {
            arrangementClipIds.delete(clipId);
            midiState.delete(clipId);
        });
        setClipClipboard([
            createClipboardEntry({ clipId: 'source-clip-one', midiNotes: pastedNotes }),
            createClipboardEntry({ clipId: 'source-clip-two', midiNotes: pastedNotes }),
        ]);

        expect(pasteClip()).toBe(false);

        expect(mocks.addClip).toHaveBeenCalledTimes(2);
        expect(mocks.setNotesForClip).toHaveBeenCalledTimes(1);
        expect(mocks.removeClip).toHaveBeenCalledOnce();
        expect(mocks.removeClip).toHaveBeenCalledWith('pasted-first');
        expect([...arrangementClipIds]).toEqual(arrangementBefore);
        expect([...midiState]).toEqual(midiBefore);
    });
});
