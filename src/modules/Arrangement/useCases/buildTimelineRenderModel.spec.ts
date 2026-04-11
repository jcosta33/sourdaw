import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { TRACK_HEIGHT_VALUES } from '#/modules/Workspace/useCases/workspaceQueries/helpers';
import { buildTimelineRenderModel } from './buildTimelineRenderModel';

describe('buildTimelineRenderModel', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns a model with tracks from the injected track store', () => {
        injectDependencies(buildTimelineRenderModel, {
            trackStore: {
                value: {
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
                },
                set: vi.fn(),
            } as never,
            transportStore: {
                value: {
                    tempo: 120,
                    timeSignatureNumerator: 4,
                    timeSignatureDenominator: 4,
                },
                set: vi.fn(),
            } as never,
            playheadPositionRef: { current: 0 },
            timelineViewStore: {
                value: { pixelsPerBeat: 12, scrollX: 0, scrollY: 0 },
                set: vi.fn(),
            } as never,
            midiStore: {
                value: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
                set: vi.fn(),
            } as never,
            workspaceStore: {
                value: { selectedClipId: null, selectedClipIds: [] },
                set: vi.fn(),
            } as never,
            preferencesStore: {
                value: { trackHeight: 'normal' },
                set: vi.fn(),
            } as never,
            clipDragPreviewRef: { current: null },
            activeRecordingRef: { current: [] },
            TRACK_HEIGHT_VALUES,
            getViewportWidth: () => 800,
        });

        const model = buildTimelineRenderModel();
        expect(model.tracks).toHaveLength(1);
        expect(model.tracks[0]!.id).toBe('t1');
        expect(model.viewportEndBeat).toBeGreaterThan(0);
    });
});
