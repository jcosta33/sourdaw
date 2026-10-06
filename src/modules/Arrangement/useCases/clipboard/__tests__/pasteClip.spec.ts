import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiNote } from '../../../models/MidiNoteViewTypes';
import { type FollowAction, type StretchMode } from '../../../models/Track';
import { clipboardStore, setClipClipboard, type ClipboardEntry } from '../../../stores/clipboardStore';
import { type ClipSatelliteEntry } from '../../../stores/clipSatelliteState';
import { pasteClip } from '../pasteClip';

type AddClipInput = {
    audioBufferId?: string;
    assetHash?: string;
    audioOffsetBeats?: number;
    color?: string;
    endBeat: number;
    fadeInBeats?: number;
    fadeOutBeats?: number;
    followAction?: FollowAction;
    gain?: number;
    locked?: boolean;
    loopEnabled?: boolean;
    loopLength?: number;
    midiOffsetBeats?: number;
    muted?: boolean;
    name: string;
    startBeat: number;
    stretchMode?: StretchMode;
    stretchRatio?: number;
    trackId: string;
    type?: 'audio' | 'midi';
};

type MockTrackState = {
    selectedTrackId: string | null;
    tracks: Array<{ id: string; kind: 'audio' | 'midi' | 'bus' | 'master' | 'folder' | 'vca' }>;
};

const mocks = vi.hoisted(() => {
    const transportState = { value: null as object | null };
    const readTransportState = vi.fn(() => transportState.value);

    return {
        addClip: vi.fn<(input: AddClipInput) => { id: string } | null>(),
        cloneClipAutomationLanes: vi.fn<(lanes: readonly unknown[], targetClipId: string) => void>(),
        getTrackState: vi.fn<() => MockTrackState | null>(),
        removeClip: vi.fn<(clipId: string) => void>(),
        resolveEligibleClipWriteTarget: vi.fn(),
        setNotesForClip: vi.fn<(clipId: string, notes: MidiNote[]) => void>(),
        setEnvelope: vi.fn(),
        setWarpState: vi.fn(),
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

vi.mock('#/modules/Automation/useCases', () => ({
    cloneClipAutomationLanes: mocks.cloneClipAutomationLanes,
}));
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
vi.mock('../../../stores/gainEnvelopeStore', () => ({
    setEnvelope: mocks.setEnvelope,
}));
vi.mock('../../../stores/warpStates', () => ({
    setWarpState: mocks.setWarpState,
}));

function createClipboardEntry(
    input: {
        automationLanes?: ClipboardEntry['automationLanes'];
        endBeat?: number;
        clipId?: string;
        midiNotes?: MidiNote[];
        name?: string;
        satellites?: ClipSatelliteEntry;
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
        satellites: input.satellites,
        automationLanes: input.automationLanes ?? [],
    };
}

function capturedClipLane(): ClipboardEntry['automationLanes'][number] {
    return {
        id: 'captured-lane-1',
        trackId: 'source-track',
        clipId: 'source-clip',
        parameterId: 'volume',
        parameterName: 'Volume',
        points: [{ beat: 0, value: 0.75, curve: 'linear', tension: 0 }],
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}

describe('pasteClip', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.addClip.mockReset();
        mocks.cloneClipAutomationLanes.mockReset();
        mocks.getTrackState.mockReset();
        mocks.removeClip.mockReset();
        mocks.setNotesForClip.mockReset();
        mocks.setEnvelope.mockReset();
        mocks.setWarpState.mockReset();
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

    it('preserves midiOffsetBeats so offset-carrying sources paste aligned (regression: ledger M-024)', () => {
        // Notes are clip-relative; playback is startBeat + note.startBeat -
        // midiOffsetBeats. The clipboard stores notes verbatim, so the pasted
        // clip must inherit the source offset or its notes shift by it.
        const entry = createClipboardEntry({ startBeat: 4, endBeat: 8 });
        entry.clip.midiOffsetBeats = 2;
        setClipClipboard([entry]);
        mocks.addClip.mockReturnValue({ id: 'pasted-clip' });
        mocks.getTrackState.mockReturnValue({
            selectedTrackId: 'selected-track',
            tracks: [{ id: 'selected-track', kind: 'midi' }],
        });

        expect(pasteClip()).toBe(true);

        expect(mocks.addClip).toHaveBeenCalledWith(expect.objectContaining({ midiOffsetBeats: 2 }));
    });

    it('clones the captured satellites onto the pasted clip with re-keyed ids and fresh records', () => {
        // The paste-time mirror of `duplicateClipCore`'s clone calls: envelope
        // re-keyed onto the copy with fresh point objects, warp cloned with
        // fresh marker objects, so two pastes from one entry never alias.
        const satellites: ClipSatelliteEntry = {
            clipId: 'source-clip',
            gainEnvelope: {
                clipId: 'source-clip',
                enabled: true,
                points: [
                    { id: 'env-1', beatOffset: 0, gainDb: -3 },
                    { id: 'env-2', beatOffset: 2, gainDb: 1.5 },
                ],
            },
            warpState: {
                enabled: true,
                markers: [{ id: 'warp-1', originalBeat: 0, warpedBeat: 0.5, origin: 'user' }],
                stretchMode: 'repitch',
                originalTempo: 120,
            },
        };
        setClipClipboard([createClipboardEntry({ satellites })]);
        mocks.getTrackState.mockReturnValue({
            selectedTrackId: null,
            tracks: [{ id: 'source-track', kind: 'midi' }],
        });
        mocks.addClip.mockReturnValue({ id: 'pasted-clip' });

        expect(pasteClip()).toBe(true);

        expect(mocks.setEnvelope).toHaveBeenCalledTimes(1);
        const envelopeCall = mocks.setEnvelope.mock.calls[0];
        if (envelopeCall === undefined) {
            throw new Error('expected setEnvelope to have been invoked');
        }
        const [envelopeClipId, envelope] = envelopeCall;
        expect(envelopeClipId).toBe('pasted-clip');
        expect(envelope).toStrictEqual({
            clipId: 'pasted-clip',
            enabled: true,
            points: [
                { id: 'env-1', beatOffset: 0, gainDb: -3 },
                { id: 'env-2', beatOffset: 2, gainDb: 1.5 },
            ],
        });
        if (envelope.points[0] === undefined || satellites.gainEnvelope?.points[0] === undefined) {
            throw new Error('expected envelope points on both records');
        }
        expect(envelope.points[0]).not.toBe(satellites.gainEnvelope.points[0]);

        expect(mocks.setWarpState).toHaveBeenCalledTimes(1);
        const warpCall = mocks.setWarpState.mock.calls[0];
        if (warpCall === undefined) {
            throw new Error('expected setWarpState to have been invoked');
        }
        const [warpClipId, warpState] = warpCall;
        expect(warpClipId).toBe('pasted-clip');
        expect(warpState).toStrictEqual(satellites.warpState);
        if (warpState.markers[0] === undefined || satellites.warpState?.markers[0] === undefined) {
            throw new Error('expected warp markers on both records');
        }
        expect(warpState.markers[0]).not.toBe(satellites.warpState.markers[0]);
    });

    it.each([
        { name: 'the entry carries no satellite record', satellites: undefined },
        {
            name: 'the satellite record holds no envelope and no warp state',
            satellites: {
                clipId: 'source-clip',
                gainEnvelope: null,
                warpState: null,
            },
        },
    ])('writes no satellite records when $name', ({ satellites }) => {
        setClipClipboard([createClipboardEntry({ satellites })]);
        mocks.getTrackState.mockReturnValue({
            selectedTrackId: null,
            tracks: [{ id: 'source-track', kind: 'midi' }],
        });
        mocks.addClip.mockReturnValue({ id: 'pasted-clip' });

        expect(pasteClip()).toBe(true);

        expect(mocks.setEnvelope).not.toHaveBeenCalled();
        expect(mocks.setWarpState).not.toHaveBeenCalled();
    });

    it('hands the captured clip-scoped automation lanes to the Automation clone keyed to the pasted clip id', () => {
        // The paste-side mirror of `duplicateClipCore`'s
        // `duplicateClipAutomation` call: the captured lanes are re-keyed onto
        // the minted clip id by Automation's own use case, fed from the
        // copy-time snapshot rather than the live store.
        const lanes = [capturedClipLane()];
        setClipClipboard([createClipboardEntry({ clipId: 'source-clip', automationLanes: lanes })]);
        mocks.getTrackState.mockReturnValue({
            selectedTrackId: null,
            tracks: [{ id: 'source-track', kind: 'midi' }],
        });
        mocks.addClip.mockReturnValue({ id: 'pasted-clip' });

        expect(pasteClip()).toBe(true);

        expect(mocks.cloneClipAutomationLanes).toHaveBeenCalledTimes(1);
        expect(mocks.cloneClipAutomationLanes).toHaveBeenCalledWith(lanes, 'pasted-clip');
    });

    it('clones no automation lanes when the entry captured none', () => {
        setClipClipboard([createClipboardEntry()]);
        mocks.getTrackState.mockReturnValue({
            selectedTrackId: null,
            tracks: [{ id: 'source-track', kind: 'midi' }],
        });
        mocks.addClip.mockReturnValue({ id: 'pasted-clip' });

        expect(pasteClip()).toBe(true);

        expect(mocks.cloneClipAutomationLanes).not.toHaveBeenCalled();
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

    it('pastes eligible cut-source MIDI snapshots through an override with regenerated ids and preserved properties', () => {
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
            tracks: [
                { id: 'selected-track', kind: 'midi' },
                { id: 'source-track-later', kind: 'midi' },
                { id: 'source-track-earlier', kind: 'midi' },
            ],
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
            assetHash: undefined,
            audioOffsetBeats: undefined,
            midiOffsetBeats: undefined,
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '',
            locked: false,
            muted: false,
            stretchMode: undefined,
            stretchRatio: undefined,
            loopEnabled: undefined,
            loopLength: undefined,
            followAction: undefined,
        });
        expect(mocks.addClip).toHaveBeenNthCalledWith(2, {
            trackId: 'selected-track',
            startBeat: 12,
            endBeat: 15,
            name: 'Earlier clip (paste)',
            type: 'midi',
            audioBufferId: undefined,
            assetHash: undefined,
            audioOffsetBeats: undefined,
            midiOffsetBeats: undefined,
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '',
            locked: false,
            muted: false,
            stretchMode: undefined,
            stretchRatio: undefined,
            loopEnabled: undefined,
            loopLength: undefined,
            followAction: undefined,
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
        expect(mocks.resolveEligibleClipWriteTarget.mock.calls).toStrictEqual([
            [{ trackId: 'source-track-later' }],
            [{ trackId: 'source-track-earlier' }],
            [{ trackId: 'selected-track' }],
            [{ trackId: 'selected-track' }],
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
            tracks: [{ id: 'source-track', kind: 'midi' }],
        });

        expect(pasteClip()).toBe(false);

        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    });

    it('skips MIDI ownership work when addClip fails or copied notes are absent or empty', () => {
        mocks.getTrackState.mockReturnValue({
            selectedTrackId: null,
            tracks: [
                { id: 'unrelated-track', kind: 'midi' },
                { id: 'source-track', kind: 'midi' },
            ],
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
            selectedTrackId: 'vca-1',
            tracks: [
                { id: 'track-1', kind: 'midi' },
                { id: 'track-2', kind: 'midi' },
                { id: 'vca-1', kind: 'vca' },
            ],
        });
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { trackId: string }) => {
            if (input.trackId === 'vca-1') {
                return { status: 'ineligible' };
            }
            return { status: 'eligible', trackId: input.trackId };
        });
        setClipClipboard([
            createClipboardEntry({ clipId: 'source-clip-one', sourceTrackId: 'track-1' }),
            createClipboardEntry({ clipId: 'source-clip-two', sourceTrackId: 'track-2', midiNotes: [] }),
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
            tracks: [{ id: 'selected-track', kind: 'midi' }],
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
            tracks: [{ id: 'selected-track', kind: 'midi' }],
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

    it.each([
        {
            name: 'a runtime-VCA source owner',
            sourceStatus: 'ineligible',
            sourceTrackId: 'vca-source',
            tracks: [
                { id: 'selected-track', kind: 'midi' as const },
                { id: 'vca-source', kind: 'vca' as const },
            ],
        },
        {
            name: 'a missing source owner',
            sourceStatus: 'missing',
            sourceTrackId: 'missing-source',
            tracks: [{ id: 'selected-track', kind: 'midi' as const }],
        },
    ])('rejects $name before selected-target resolution or any effect', ({ sourceStatus, sourceTrackId, tracks }) => {
        const randomUuid = vi.spyOn(crypto, 'randomUUID');
        mocks.getTrackState.mockReturnValue({
            selectedTrackId: 'selected-track',
            tracks,
        });
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { trackId: string }) => {
            if (input.trackId === sourceTrackId) {
                return { status: sourceStatus };
            }
            return { status: 'eligible', trackId: input.trackId };
        });
        mocks.addClip.mockReturnValue({ id: 'pasted-clip' });
        setClipClipboard([
            createClipboardEntry({
                sourceTrackId,
                midiNotes: [{ id: 'source-note', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
            }),
        ]);

        expect(pasteClip()).toBe(false);

        expect(mocks.resolveEligibleClipWriteTarget.mock.calls).toStrictEqual([[{ trackId: sourceTrackId }]]);
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(randomUuid).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
        expect(mocks.removeClip).not.toHaveBeenCalled();
    });

    it('returns before transport or track work when the clipboard store has been cleared', () => {
        // After clear() the store value is null, so clipClipboard falls back to
        // [] via the ?? arm and the function bails before touching transport.
        clipboardStore.clear();

        expect(pasteClip()).toBe(false);

        expect(mocks.readTransportState).not.toHaveBeenCalled();
        expect(mocks.getTrackState).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
    });

    it('rejects the paste when the playhead is not a finite beat', () => {
        setClipClipboard([createClipboardEntry()]);
        mocks.transportState.value = {};
        mocks.getTrackState.mockReturnValue({ selectedTrackId: null, tracks: [{ id: 'source-track', kind: 'midi' }] });
        mocks.playheadPositionRef.current = Number.NaN;

        expect(pasteClip()).toBe(false);

        expect(mocks.addClip).not.toHaveBeenCalled();
    });

    it('rejects the paste when an entry source track id is empty but its clip owner is valid', () => {
        // clip.trackId is a valid string while sourceTrackId is empty: this
        // isolates the sourceTrackId guard (L49) from the clip-owner guard.
        const entry = createClipboardEntry();
        entry.clip.trackId = 'source-track';
        entry.sourceTrackId = '';
        mocks.getTrackState.mockReturnValue({
            selectedTrackId: 'selected-track',
            tracks: [{ id: 'selected-track', kind: 'midi' }],
        });
        setClipClipboard([entry]);

        expect(pasteClip()).toBe(false);

        expect(mocks.resolveEligibleClipWriteTarget).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
    });

    it('rejects the paste when the offset-adjusted span lands below zero', () => {
        // A negative playhead passes the finite check (L24) but the offset
        // pushes the pasted startBeat below zero, failing the post-offset
        // range guard (L99) before any clip is allocated.
        setClipClipboard([createClipboardEntry({ startBeat: 4, endBeat: 8 })]);
        mocks.transportState.value = {};
        mocks.getTrackState.mockReturnValue({
            selectedTrackId: 'selected-track',
            tracks: [{ id: 'selected-track', kind: 'midi' }],
        });
        // offset = -10 - 4 = -14 -> pasted startBeat = 4 + (-14) = -10 < 0.
        mocks.playheadPositionRef.current = -10;

        expect(pasteClip()).toBe(false);

        expect(mocks.addClip).not.toHaveBeenCalled();
    });

    it.each([
        {
            name: 'the entry itself is not an object',
            corrupt: () => {
                // Replace the entry with a primitive while keeping array shape.
                return 'not-an-object' as unknown as ClipboardEntry;
            },
        },
        {
            name: 'the entry clip is not an object',
            corrupt: (entry: ClipboardEntry) => {
                Reflect.set(entry, 'clip', 'not-a-clip');
                return entry;
            },
        },
        {
            name: 'the source clip geometry is invalid',
            corrupt: (entry: ClipboardEntry) => {
                entry.clip.startBeat = 8;
                entry.clip.endBeat = 4;
                return entry;
            },
        },
    ])('rejects the paste when $name before any allocation', ({ corrupt }) => {
        const entry = corrupt(createClipboardEntry());
        mocks.transportState.value = {};
        mocks.getTrackState.mockReturnValue({
            selectedTrackId: 'selected-track',
            tracks: [{ id: 'selected-track', kind: 'midi' }],
        });
        setClipClipboard([entry]);

        expect(pasteClip()).toBe(false);

        expect(mocks.resolveEligibleClipWriteTarget).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    });

    it('rejects the paste when the selected target is a bus', () => {
        // A bus passes the write-eligibility flags but never renders clip
        // content, so nothing may land on it — the guard refuses before any
        // clip is allocated.
        mocks.getTrackState.mockReturnValue({
            selectedTrackId: 'bus-1',
            tracks: [
                { id: 'bus-1', kind: 'bus' },
                { id: 'source-track', kind: 'midi' },
            ],
        });
        setClipClipboard([createClipboardEntry()]);

        expect(pasteClip()).toBe(false);

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
            tracks: [{ id: 'selected-track', kind: 'midi' }],
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
