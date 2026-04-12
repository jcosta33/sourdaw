import { describe, it, expect, vi } from 'vitest';
import { buildTimelineRenderModel } from '../buildTimelineRenderModel';
import { trackStore } from '../../stores/trackStore';
import { transportStore, playheadPositionRef } from '#/modules/Transport/stores';
import { timelineViewStore } from '../../stores/timelineViewStore';
import { midiStore } from '#/modules/MIDI/stores';
import { workspaceStore, preferencesStore } from '#/modules/Workspace/stores';
import { clipDragPreviewRef } from '../../stores/clipDragPreviewRef';
import { activeRecordingRef } from '../../stores/activeRecordingRef';

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
    return { ...actual, workspaceStore: { value: null, set: vi.fn() }, preferencesStore: { value: null, set: vi.fn() } };
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
});
