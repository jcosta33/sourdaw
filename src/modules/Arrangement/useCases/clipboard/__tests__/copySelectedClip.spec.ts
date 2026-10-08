import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';

import { type Clip } from '../../../models/Track';
import { type ClipSatelliteEntry } from '../../../stores/clipSatelliteState';
import { audioSourceAtBeat } from '../../clipEditing/audioSourceAtBeat';
import { copySelectedClip } from '../copySelectedClip';

const mocks = vi.hoisted(() => ({
    clipSelectionStore: {
        value: null as {
            selectedClipId: string | null;
            selectedClipIds: string[];
        } | null,
    },
    midiStore: {
        value: null as {
            notesByClipId: Record<string, unknown[]>;
            ccByClipId: Record<string, unknown[]>;
            pitchBendByClipId: Record<string, unknown[]>;
        } | null,
    },
    getTrackStoreState: vi.fn(),
    resolveEligibleClipWriteTarget: vi.fn(),
    setClipClipboard: vi.fn(),
    readClipSatelliteEntry: vi.fn((clipId: string): ClipSatelliteEntry => ({
        clipId,
        gainEnvelope: null,
        warpState: null,
    })),
    readClipScopedAutomationLanes: vi.fn((_clipIds: readonly string[]) => [] as unknown[]),
}));

vi.mock('../../../stores/clipSelectionStore', () => ({
    clipSelectionStore: mocks.clipSelectionStore,
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: mocks.midiStore,
}));

vi.mock('../../getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../stores/clipboardStore', () => ({
    setClipClipboard: mocks.setClipClipboard,
}));

vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

vi.mock('../../../stores/clipSatelliteState', () => ({
    readClipSatelliteEntry: mocks.readClipSatelliteEntry,
}));

vi.mock('../../clip/readClipScopedAutomationLanes', () => ({
    readClipScopedAutomationLanes: mocks.readClipScopedAutomationLanes,
}));

describe('copySelectedClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        tempoMapStore.set({ changes: [] });
        transportStore.set(defaultTransportState);
        mocks.clipSelectionStore.value = null;
        mocks.midiStore.value = null;
        mocks.getTrackStoreState.mockReturnValue(null);
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { clipId: string }) => ({
            status: 'eligible',
            clipId: input.clipId,
            trackId: 'track-1',
        }));
    });

    afterEach(() => {
        tempoMapStore.set({ changes: [] });
        transportStore.set(defaultTransportState);
    });

    it.each([
        { name: 'canonical zero over a stale alias', seconds: 0, beats: 9, expectedSeconds: 0 },
        { name: 'signed pre-roll', seconds: -0.5, beats: 9, expectedSeconds: -0.5 },
        { name: 'positive canonical depth', seconds: 1.25, beats: 9, expectedSeconds: 1.25 },
        { name: 'legacy beat depth', seconds: undefined, beats: 2, expectedSeconds: 1 },
    ])('freezes $name at copy time before a tempo edit', ({ seconds, beats, expectedSeconds }) => {
        const source: Clip = {
            id: 'clip-1',
            trackId: 'track-1',
            name: 'Trimmed take',
            startBeat: 4,
            endBeat: 8,
            type: 'audio',
            audioOffsetBeats: beats,
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '',
            locked: false,
            muted: false,
        };
        if (seconds !== undefined) {
            source.audioOffsetSeconds = seconds;
        }
        const original = structuredClone(source);
        mocks.clipSelectionStore.value = { selectedClipId: 'clip-1', selectedClipIds: ['clip-1'] };
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'track-1', clips: [source] }] });

        expect(copySelectedClip()).toBe(true);

        const captured: Clip | undefined = mocks.setClipClipboard.mock.calls[0]?.[0]?.[0]?.clip;
        expect(captured?.audioOffsetSeconds).toBe(expectedSeconds);
        tempoMapStore.set({ changes: [{ id: 'slower', beat: 0, tempo: 60, curve: 'instant' }] });
        expect(captured && audioSourceAtBeat(captured, captured.startBeat).audioOffsetSeconds).toBe(expectedSeconds);
        expect(source).toEqual(original);
    });

    it('returns early when workspace is unavailable', () => {
        expect(copySelectedClip()).toBe(false);
        expect(mocks.setClipClipboard).not.toHaveBeenCalled();
    });

    it('copies every selected clip from one track snapshot', () => {
        mocks.clipSelectionStore.value = {
            selectedClipId: 'clip-1',
            selectedClipIds: ['clip-1', 'clip-2'],
        };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 'track-1',
                    clips: [
                        { id: 'clip-1', type: 'audio' },
                        { id: 'clip-2', type: 'audio' },
                    ],
                },
            ],
        });

        expect(copySelectedClip()).toBe(true);

        expect(mocks.getTrackStoreState).toHaveBeenCalledOnce();
        expect(mocks.readClipSatelliteEntry.mock.calls).toStrictEqual([['clip-1'], ['clip-2']]);
        expect(mocks.readClipScopedAutomationLanes.mock.calls).toStrictEqual([[['clip-1']], [['clip-2']]]);
        expect(mocks.setClipClipboard).toHaveBeenCalledWith([
            {
                clip: { id: 'clip-1', type: 'audio' },
                midiNotes: undefined,
                satellites: { clipId: 'clip-1', gainEnvelope: null, warpState: null },
                automationLanes: [],
                sourceTrackId: 'track-1',
            },
            {
                clip: { id: 'clip-2', type: 'audio' },
                midiNotes: undefined,
                satellites: { clipId: 'clip-2', gainEnvelope: null, warpState: null },
                automationLanes: [],
                sourceTrackId: 'track-1',
            },
        ]);
    });

    it('captures the satellite record the satellite stores hold for each copied clip', () => {
        // The snapshot is what paste rebuilds from, so whatever the satellite
        // stores hold at copy time must ride the entry verbatim.
        mocks.readClipSatelliteEntry.mockImplementation((clipId: string) => {
            if (clipId !== 'comped-clip') {
                return { clipId, gainEnvelope: null, warpState: null };
            }
            return {
                clipId,
                gainEnvelope: {
                    clipId,
                    enabled: true,
                    points: [{ id: 'env-1', beatOffset: 0, gainDb: -3 }],
                },
                warpState: {
                    enabled: true,
                    markers: [{ id: 'warp-1', originalBeat: 0, warpedBeat: 0.5 }],
                    stretchMode: 'repitch' as const,
                    originalTempo: 120,
                },
            };
        });
        mocks.clipSelectionStore.value = { selectedClipId: 'comped-clip', selectedClipIds: ['comped-clip'] };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [{ id: 'comped-clip', type: 'audio' }] }],
        });

        expect(copySelectedClip()).toBe(true);

        const entry = mocks.setClipClipboard.mock.calls[0]?.[0]?.[0];
        expect(entry?.satellites).toEqual({
            clipId: 'comped-clip',
            gainEnvelope: {
                clipId: 'comped-clip',
                enabled: true,
                points: [{ id: 'env-1', beatOffset: 0, gainDb: -3 }],
            },
            warpState: {
                enabled: true,
                markers: [{ id: 'warp-1', originalBeat: 0, warpedBeat: 0.5 }],
                stretchMode: 'repitch',
                originalTempo: 120,
            },
        });
    });

    it('captures the clip-scoped automation lanes the automation store holds for each copied clip', () => {
        // Lanes are clip-id-keyed records like the satellites: whatever the
        // automation store holds at copy time must ride the entry verbatim,
        // because the source clip may be deleted before the paste.
        const capturedLane = {
            id: 'lane-1',
            trackId: 'track-1',
            clipId: 'comped-clip',
            parameterId: 'volume',
            parameterName: 'Volume',
            points: [],
            objects: [],
            visible: true,
            enabled: true,
            collapsed: false,
            minValue: 0,
            maxValue: 1,
        };
        mocks.readClipScopedAutomationLanes.mockImplementation((clipIds: readonly string[]) =>
            clipIds.includes('comped-clip') ? [capturedLane] : []
        );
        mocks.clipSelectionStore.value = { selectedClipId: 'comped-clip', selectedClipIds: ['comped-clip'] };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [{ id: 'comped-clip', type: 'audio' }] }],
        });

        expect(copySelectedClip()).toBe(true);

        const entry = mocks.setClipClipboard.mock.calls[0]?.[0]?.[0];
        expect(entry?.automationLanes).toEqual([capturedLane]);
    });

    it('rejects a mixed valid and ineligible selection before writing the clipboard', () => {
        mocks.clipSelectionStore.value = {
            selectedClipId: 'clip-1',
            selectedClipIds: ['clip-1', 'vca-clip'],
        };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [{ id: 'clip-1', type: 'audio' }] }],
        });
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { clipId: string }) => {
            if (input.clipId === 'vca-clip') {
                return { status: 'ineligible' };
            }
            return { status: 'eligible', clipId: input.clipId, trackId: 'track-1' };
        });

        expect(copySelectedClip()).toBe(false);

        expect(mocks.setClipClipboard).not.toHaveBeenCalled();
    });

    it('rejects duplicate selected ids as one malformed operation', () => {
        mocks.clipSelectionStore.value = {
            selectedClipId: 'clip-1',
            selectedClipIds: ['clip-1', 'clip-1'],
        };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [{ id: 'clip-1', type: 'audio' }] }],
        });

        expect(copySelectedClip()).toBe(false);

        expect(mocks.setClipClipboard).not.toHaveBeenCalled();
    });

    it('falls back to the single legacy selectedClipId when the multi-id list is empty', () => {
        mocks.clipSelectionStore.value = { selectedClipId: 'clip-1', selectedClipIds: [] };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [{ id: 'clip-1', type: 'audio' }] }],
        });

        expect(copySelectedClip()).toBe(true);

        expect(mocks.setClipClipboard).toHaveBeenCalledWith([
            {
                clip: { id: 'clip-1', type: 'audio' },
                midiNotes: undefined,
                satellites: { clipId: 'clip-1', gainEnvelope: null, warpState: null },
                automationLanes: [],
                sourceTrackId: 'track-1',
            },
        ]);
    });

    it('aborts when nothing is selected (no list and no single id)', () => {
        mocks.clipSelectionStore.value = { selectedClipId: null, selectedClipIds: [] };

        expect(copySelectedClip()).toBe(false);
        expect(mocks.setClipClipboard).not.toHaveBeenCalled();
    });

    it('aborts when the track store has not loaded', () => {
        mocks.clipSelectionStore.value = { selectedClipId: 'clip-1', selectedClipIds: ['clip-1'] };
        mocks.getTrackStoreState.mockReturnValue(null);

        expect(copySelectedClip()).toBe(false);
        expect(mocks.setClipClipboard).not.toHaveBeenCalled();
    });

    it('aborts when a selected clip cannot be located in any track', () => {
        mocks.clipSelectionStore.value = { selectedClipId: 'ghost', selectedClipIds: ['ghost'] };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [{ id: 'clip-1', type: 'audio' }] }],
        });

        expect(copySelectedClip()).toBe(false);
        expect(mocks.setClipClipboard).not.toHaveBeenCalled();
    });

    it('deep-copies midi notes for a selected midi clip that carries them', () => {
        // The midi ternary (L51) and the notes-clone ternary (L54) both fire:
        // the clip is midi AND its notes entry exists in the midi store.
        const sourceNote = { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 90 };
        mocks.clipSelectionStore.value = { selectedClipId: 'midi-1', selectedClipIds: ['midi-1'] };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [{ id: 'midi-1', type: 'midi' }] }],
        });
        mocks.midiStore.value = { notesByClipId: { 'midi-1': [sourceNote] }, ccByClipId: {}, pitchBendByClipId: {} };

        expect(copySelectedClip()).toBe(true);

        const entry = mocks.setClipClipboard.mock.calls[0]?.[0]?.[0];
        expect(entry.midiNotes).toEqual([sourceNote]);
        // The notes must be a deep copy, not the same reference.
        expect(entry.midiNotes[0]).not.toBe(sourceNote);
    });
});
