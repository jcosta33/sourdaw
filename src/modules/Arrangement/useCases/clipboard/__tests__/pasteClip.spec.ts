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
            name: 'Source clip',
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

        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    });

    it('pastes copied MIDI notes through the owner with regenerated ids and preserved properties', () => {
        const sourceNotes: MidiNote[] = [
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
            .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
        mocks.transportState.value = {};
        mocks.playheadPositionRef.current = 12;
        mocks.getTrackState.mockReturnValue({
            selectedTrackId: null,
            tracks: [{ id: 'source-track' }],
        });
        mocks.addClip.mockReturnValue({ id: 'pasted-clip' });
        mocks.setNotesForClip.mockImplementation(() => {
            expect(randomUuid).toHaveBeenCalledTimes(2);
        });
        setClipClipboard([
            createClipboardEntry({
                endBeat: 7,
                midiNotes: sourceNotes,
            }),
        ]);

        pasteClip();

        expect(mocks.addClip).toHaveBeenCalledWith({
            trackId: 'source-track',
            startBeat: 12,
            endBeat: 15,
            name: 'Source clip (paste)',
            type: 'midi',
            audioBufferId: undefined,
        });
        expect(mocks.setNotesForClip).toHaveBeenCalledTimes(1);
        const call = mocks.setNotesForClip.mock.calls[0];
        if (!call) {
            throw new Error('Expected MIDI owner call');
        }
        const [clipId, copiedNotes] = call;

        expect(clipId).toBe('pasted-clip');
        expect(copiedNotes).toStrictEqual([
            {
                ...sourceNotes[0],
                id: 'note-11111111',
            },
            {
                ...sourceNotes[1],
                id: 'note-22222222',
            },
        ]);
        expect(Object.keys(copiedNotes[0])).toEqual(Object.keys(sourceNotes[0]));
        expect(Object.keys(copiedNotes[1])).toEqual(Object.keys(sourceNotes[1]));
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
            tracks: [{ id: 'source-track' }],
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
        expect(randomUuid).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();

        mocks.addClip.mockReturnValue({ id: 'pasted-clip' });
        setClipClipboard([createClipboardEntry(), createClipboardEntry({ midiNotes: [] })]);

        pasteClip();

        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    });
});
