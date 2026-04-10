import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type TimelineRenderModel } from '../../models/TimelineRenderModel';
import { hitTestAutomationSubLane } from './hitTestAutomationSubLane';

describe('hitTestAutomationSubLane', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns a hit when coordinate is in an automation sub-lane with a matching lane', () => {
        const model: TimelineRenderModel = {
            dataDirty: false,
            tracks: [
                {
                    id: 't1',
                    name: 'One',
                    index: 0,
                    kind: 'midi',
                    color: '#000',
                    muted: false,
                    soloed: false,
                    height: 100,
                    clips: [],
                    automationMode: 'read',
                },
            ],
            selectedTrackId: null,
            selectedClipId: null,
            selectedClipIds: [],
            playheadPosition: 0,
            viewportStartBeat: 0,
            viewportEndBeat: 32,
            beatsPerPixel: 0.1,
            pixelsPerBeat: 10,
            trackHeight: 48,
            scrollY: 0,
            tempo: 120,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
        };

        injectDependencies(hitTestAutomationSubLane, {
            timelineViewStore: {
                value: { pixelsPerBeat: 10, scrollX: 0, scrollY: 0 },
                set: vi.fn(),
            } as never,
            trackStore: {
                value: { tracks: [], selectedTrackId: null },
                set: vi.fn(),
            } as never,
            workspaceStore: {
                value: {
                    automationVisibility: 'overlay',
                    automationSubLanes: { t1: ['gain'] },
                },
                set: vi.fn(),
            } as never,
            automationStore: {
                value: {
                    lanes: [
                        {
                            id: 'lane-1',
                            trackId: 't1',
                            parameterId: 'gain',
                            parameterName: 'Gain',
                            points: [],
                            objects: [],
                            visible: true,
                            enabled: true,
                            collapsed: false,
                            virginTerritory: false,
                            minValue: 0,
                            maxValue: 1,
                        },
                    ],
                },
                set: vi.fn(),
            } as never,
            buildTimelineRenderModel: () => model,
        });

        const hit = hitTestAutomationSubLane(50, 70);
        expect(hit).not.toBeNull();
        expect(hit!.laneId).toBe('lane-1');
        expect(hit!.trackId).toBe('t1');
        expect(hit!.subLaneIndex).toBe(0);
        expect(hit!.beat).toBe(5);
    });

    it('returns null when automation is hidden', () => {
        injectDependencies(hitTestAutomationSubLane, {
            timelineViewStore: {
                value: { pixelsPerBeat: 10, scrollX: 0, scrollY: 0 },
                set: vi.fn(),
            } as never,
            trackStore: {
                value: { tracks: [], selectedTrackId: null },
                set: vi.fn(),
            } as never,
            workspaceStore: {
                value: {
                    automationVisibility: 'hidden',
                    automationSubLanes: {},
                },
                set: vi.fn(),
            } as never,
            automationStore: {
                value: { lanes: [] },
                set: vi.fn(),
            } as never,
            buildTimelineRenderModel: () => null,
        });

        expect(hitTestAutomationSubLane(0, 0)).toBeNull();
    });
});
