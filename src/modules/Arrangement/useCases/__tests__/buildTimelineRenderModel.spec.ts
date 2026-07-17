import { describe, it, expect, vi } from 'vitest';

import { playheadPositionRef } from '#/modules/Transport/stores';

import { createTrack } from '../../models/Track';
import { activeRecordingRef } from '../../stores/activeRecordingRef';
import { clipDragPreviewRef } from '../../stores/clipDragPreviewRef';
import { buildTimelineRenderModel } from '../buildTimelineRenderModel';

import type { MidiStoreState } from '#/modules/MIDI/stores';
import type { Preferences } from '#/modules/Preferences/stores';
import type { TransportState } from '#/modules/Transport/stores';
import type { WorkspaceState } from '#/modules/Workspace/stores';
import type { TimelineViewState } from '../../stores/timelineViewStore';
import type { TrackStoreState } from '../../stores/trackStore';

const {
    trackStoreMock,
    transportStoreMock,
    timelineViewStoreMock,
    midiStoreMock,
    workspaceStoreMock,
    preferencesStoreMock,
} = vi.hoisted(() => ({
    trackStoreMock: { value: null as TrackStoreState | null, set: vi.fn() },
    transportStoreMock: { value: null as Partial<TransportState> | null, set: vi.fn() },
    timelineViewStoreMock: { value: null as Partial<TimelineViewState> | null, set: vi.fn() },
    midiStoreMock: { value: null as MidiStoreState | null, set: vi.fn() },
    workspaceStoreMock: { value: null as Partial<WorkspaceState> | null, set: vi.fn() },
    preferencesStoreMock: { value: null as Partial<Preferences> | null, set: vi.fn() },
}));

vi.mock('../../stores/trackStore', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, trackStore: trackStoreMock };
});
vi.mock('#/modules/Transport/stores', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, transportStore: transportStoreMock, playheadPositionRef: { current: 0 } };
});
vi.mock('../../stores/timelineViewStore', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, timelineViewStore: timelineViewStoreMock };
});
vi.mock('#/modules/MIDI/stores', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, midiStore: midiStoreMock };
});
vi.mock('#/modules/Workspace/stores', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        workspaceStore: workspaceStoreMock,
    };
});
vi.mock('#/modules/Preferences/stores', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, preferencesStore: preferencesStoreMock };
});
vi.mock('../../stores/clipDragPreviewRef', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, clipDragPreviewRef: { current: null } };
});
vi.mock('../../stores/activeRecordingRef', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, activeRecordingRef: { current: [] } };
});

describe('buildTimelineRenderModel', () => {
    it('returns a model with tracks from the injected track store', () => {
        trackStoreMock.value = {
            tracks: [
                {
                    ...createTrack({ id: 't1', name: 'One', kind: 'midi' }),
                    clips: [],
                    devices: [],
                    gain: 1,
                    pan: 0,
                    muted: false,
                    soloed: false,
                    armed: false,
                    disabled: false,
                    height: 48,
                    outputId: 'hw_out',
                    sends: [],
                    parentId: null,
                    color: '#000',
                    automationMode: 'read',
                },
            ],
            selectedTrackId: null,
        };
        transportStoreMock.value = {
            tempo: 120,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
        };
        playheadPositionRef.current = 0;
        timelineViewStoreMock.value = { pixelsPerBeat: 12, scrollX: 0, scrollY: 0 };
        midiStoreMock.value = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };
        workspaceStoreMock.value = { selectedClipId: null, selectedClipIds: [] };
        preferencesStoreMock.value = { trackHeight: 'normal' };
        clipDragPreviewRef.current = null;
        activeRecordingRef.current = [];

        Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 800 });

        const model = buildTimelineRenderModel();
        expect(model.tracks).toHaveLength(1);
        expect(model.tracks[0]!.id).toBe('t1');
        expect(model.viewportEndBeat).toBeGreaterThan(0);
    });

    // Regression: the transport store mints a new object every playhead tick
    // during playback. Keying cache invalidation on the whole object rebuilt
    // the entire track/clip tree every frame. Only render-affecting transport
    // fields (tempo) should bust the cache.
    it('does not rebuild the track tree when only playhead-only transport fields change', () => {
        trackStoreMock.value = {
            tracks: [
                {
                    ...createTrack({ id: 't1', name: 'One', kind: 'midi' }),
                    clips: [],
                    color: '#000',
                    muted: false,
                    soloed: false,
                    height: 48,
                    parentId: null,
                    automationMode: 'read',
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
            selectedTrackId: null,
        };
        timelineViewStoreMock.value = { pixelsPerBeat: 12, scrollX: 0, scrollY: 0 };
        midiStoreMock.value = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };
        workspaceStoreMock.value = { selectedClipId: null, selectedClipIds: [] };
        preferencesStoreMock.value = { trackHeight: 'normal' };
        clipDragPreviewRef.current = null;
        activeRecordingRef.current = [];
        playheadPositionRef.current = 0;

        // First build — tempo 120, playhead 0.
        transportStoreMock.value = { tempo: 120, isPlaying: true, playheadPosition: 0 };
        const first = buildTimelineRenderModel();
        const tracksRef = first.tracks;

        // Simulate a playhead tick: a NEW transport object, same tempo, advanced
        // playhead. The track tree must be reused (same array reference).
        transportStoreMock.value = { tempo: 120, isPlaying: true, playheadPosition: 4 };
        playheadPositionRef.current = 4;
        const second = buildTimelineRenderModel();
        expect(second.tracks).toBe(tracksRef);
        expect(second.playheadPosition).toBe(4);

        // Changing tempo IS render-affecting and must rebuild the tree.
        transportStoreMock.value = { tempo: 140, isPlaying: true, playheadPosition: 4 };
        const third = buildTimelineRenderModel();
        expect(third.tracks).not.toBe(tracksRef);
        expect(third.tempo).toBe(140);
    });
});
