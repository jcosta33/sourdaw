import { describe, it, expect, vi } from 'vitest';

import { midiStore } from '#/modules/MIDI/stores';
import { transportStore, playheadPositionRef } from '#/modules/Transport/stores';
import { workspaceStore, preferencesStore } from '#/modules/Workspace/stores';

import { activeRecordingRef } from '../../stores/activeRecordingRef';
import { clipDragPreviewRef } from '../../stores/clipDragPreviewRef';
import { timelineViewStore } from '../../stores/timelineViewStore';
import { trackStore } from '../../stores/trackStore';
import { buildTimelineRenderModel } from '../buildTimelineRenderModel';

vi.mock('../../stores/trackStore', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, trackStore: { value: null, set: vi.fn() } };
});
vi.mock('#/modules/Transport/stores', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, transportStore: { value: null, set: vi.fn() }, playheadPositionRef: { current: 0 } };
});
vi.mock('../../stores/timelineViewStore', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, timelineViewStore: { value: null, set: vi.fn() } };
});
vi.mock('#/modules/MIDI/stores', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, midiStore: { value: null, set: vi.fn() } };
});
vi.mock('#/modules/Workspace/stores', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        workspaceStore: { value: null, set: vi.fn() },
        preferencesStore: { value: null, set: vi.fn() },
    };
});
vi.mock('../../stores/clipDragPreviewRef', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, clipDragPreviewRef: { current: null } };
});
vi.mock('../../stores/activeRecordingRef', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, activeRecordingRef: { current: [] } };
});

describe('buildTimelineRenderModel', () => {
    it('returns a model with tracks from the injected track store', () => {
        trackStore.value = {
            tracks: [
                {
                    id: 't1',
                    name: 'One',
                    kind: 'midi',
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
                    automationMode: 'read' as const,
                },
            ],
            selectedTrackId: null,
        } as any;
        transportStore.value = {
            tempo: 120,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
        } as any;
        playheadPositionRef.current = 0;
        timelineViewStore.value = { pixelsPerBeat: 12, scrollX: 0, scrollY: 0 } as any;
        midiStore.value = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} } as any;
        workspaceStore.value = { selectedClipId: null, selectedClipIds: [] } as any;
        preferencesStore.value = { trackHeight: 'normal' } as any;
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
        trackStore.value = {
            tracks: [
                {
                    id: 't1',
                    name: 'One',
                    kind: 'midi',
                    clips: [],
                    color: '#000',
                    muted: false,
                    soloed: false,
                    height: 48,
                    parentId: null,
                    automationMode: 'read' as const,
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
            selectedTrackId: null,
        } as any;
        timelineViewStore.value = { pixelsPerBeat: 12, scrollX: 0, scrollY: 0 } as any;
        midiStore.value = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} } as any;
        workspaceStore.value = { selectedClipId: null, selectedClipIds: [] } as any;
        preferencesStore.value = { trackHeight: 'normal' } as any;
        clipDragPreviewRef.current = null;
        activeRecordingRef.current = [];
        playheadPositionRef.current = 0;

        // First build — tempo 120, playhead 0.
        transportStore.value = { tempo: 120, isPlaying: true, playheadPosition: 0 } as any;
        const first = buildTimelineRenderModel();
        const tracksRef = first.tracks;

        // Simulate a playhead tick: a NEW transport object, same tempo, advanced
        // playhead. The track tree must be reused (same array reference).
        transportStore.value = { tempo: 120, isPlaying: true, playheadPosition: 4 } as any;
        playheadPositionRef.current = 4;
        const second = buildTimelineRenderModel();
        expect(second.tracks).toBe(tracksRef);
        expect(second.playheadPosition).toBe(4);

        // Changing tempo IS render-affecting and must rebuild the tree.
        transportStore.value = { tempo: 140, isPlaying: true, playheadPosition: 4 } as any;
        const third = buildTimelineRenderModel();
        expect(third.tracks).not.toBe(tracksRef);
        expect(third.tempo).toBe(140);
    });
});
