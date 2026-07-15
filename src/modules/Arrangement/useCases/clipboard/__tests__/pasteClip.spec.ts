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

function createClipboardEntry(
    input: {
        endBeat?: number;
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
            id: 'source-clip',
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
        mocks.setNotesForClip.mockReset();
        mocks.readTransportState.mockClear();
        mocks.transportState.value = {};
        mocks.playheadPositionRef.current = 0;
        setClipClipboard([]);
    });

    it('returns before transport or track work when the clip clipboard is empty', () => {
        pasteClip();

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

        pasteClip();

        expect(mocks.readTransportState).toHaveBeenCalledTimes(1);
        expect(mocks.getTrackState).toHaveBeenCalledTimes(1);
        expect(mocks.readTransportState.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.getTrackState.mock.invocationCallOrder[0]
        );
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
                startBeat: 9,
                endBeat: 11,
                name: 'Later clip',
                sourceTrackId: 'source-track-later',
                midiNotes: laterClipNotes,
            }),
            createClipboardEntry({
                startBeat: 4,
                endBeat: 7,
                name: 'Earlier clip',
                sourceTrackId: 'source-track-earlier',
                midiNotes: earlierClipNotes,
            }),
        ]);

        pasteClip();

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
        expect(mocks.addClip.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.setNotesForClip.mock.invocationCallOrder[0]
        );
        expect(mocks.setNotesForClip.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.addClip.mock.invocationCallOrder[1]
        );
        expect(mocks.addClip.mock.invocationCallOrder[1]).toBeLessThan(
            mocks.setNotesForClip.mock.invocationCallOrder[1]
        );
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

        pasteClip();

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

        pasteClip();

        expect(mocks.addClip).toHaveBeenCalledTimes(1);
        expect(mocks.addClip).toHaveBeenCalledWith(expect.objectContaining({ trackId: 'source-track' }));
        expect(randomUuid).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();

        mocks.addClip.mockReturnValue({ id: 'pasted-clip' });
        setClipClipboard([createClipboardEntry(), createClipboardEntry({ midiNotes: [] })]);

        pasteClip();

        expect(randomUuid).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    });
});
