import { describe, it, expect, beforeEach, vi } from 'vitest';

import { type TimelineRenderModel } from '../../../models/TimelineRenderModel';
import { hitTestAutomationSubLane } from '../hitTestAutomationSubLane';

const { mockTimelineViewValue, mockTrackValue, mockWorkspaceValue, mockAutomationValue, mockBuildTimelineRenderModel } =
    vi.hoisted(() => ({
        mockTimelineViewValue: { value: null } as any,
        mockTrackValue: { value: null } as any,
        mockWorkspaceValue: { value: null } as any,
        mockAutomationValue: { value: null } as any,
        mockBuildTimelineRenderModel: vi.fn(),
    }));

vi.mock('../../../stores/timelineViewStore', () => ({
    timelineViewStore: {
        get value() {
            return mockTimelineViewValue.value;
        },
    },
}));

vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        get value() {
            return mockTrackValue.value;
        },
    },
}));

vi.mock('#/modules/WorkspaceShell/stores', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        workspaceStore: {
            get value() {
                return mockWorkspaceValue.value;
            },
        },
    };
});

vi.mock('#/modules/Automation/stores', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        automationStore: {
            get value() {
                return mockAutomationValue.value;
            },
        },
    };
});

vi.mock('../../buildTimelineRenderModel', () => ({
    buildTimelineRenderModel: () => mockBuildTimelineRenderModel(),
}));

describe('hitTestAutomationSubLane', () => {
    beforeEach(() => {
        mockTimelineViewValue.value = null;
        mockTrackValue.value = null;
        mockWorkspaceValue.value = null;
        mockAutomationValue.value = null;
        mockBuildTimelineRenderModel.mockReset();
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

        mockTimelineViewValue.value = { pixelsPerBeat: 10, scrollX: 0, scrollY: 0 };
        mockTrackValue.value = { tracks: [], selectedTrackId: null };
        mockWorkspaceValue.value = {
            automationVisibility: 'overlay',
            automationSubLanes: { t1: ['gain'] },
        };
        mockAutomationValue.value = {
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
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        };
        mockBuildTimelineRenderModel.mockReturnValue(model);

        const hit = hitTestAutomationSubLane(50, 70);
        expect(hit).not.toBeNull();
        expect(hit!.laneId).toBe('lane-1');
        expect(hit!.trackId).toBe('t1');
        expect(hit!.subLaneIndex).toBe(0);
        expect(hit!.beat).toBe(5);
    });

    it('returns null when automation is hidden', () => {
        mockTimelineViewValue.value = { pixelsPerBeat: 10, scrollX: 0, scrollY: 0 };
        mockTrackValue.value = { tracks: [], selectedTrackId: null };
        mockWorkspaceValue.value = {
            automationVisibility: 'hidden',
            automationSubLanes: {},
        };
        mockAutomationValue.value = { lanes: [] };
        mockBuildTimelineRenderModel.mockReturnValue(null);

        expect(hitTestAutomationSubLane(0, 0)).toBeNull();
    });

    it('returns null when the render model cannot be built even though automation is visible', () => {
        mockTimelineViewValue.value = { pixelsPerBeat: 10, scrollX: 0, scrollY: 0 };
        mockTrackValue.value = { tracks: [], selectedTrackId: null };
        mockWorkspaceValue.value = {
            automationVisibility: 'overlay',
            automationSubLanes: { t1: ['gain'] },
        };
        mockAutomationValue.value = { lanes: [] };
        mockBuildTimelineRenderModel.mockReturnValue(null);

        expect(hitTestAutomationSubLane(0, 0)).toBeNull();
    });

    it('returns null when the hit falls inside a track that has no automation sub-lanes', () => {
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
        mockTimelineViewValue.value = { pixelsPerBeat: 10, scrollX: 0, scrollY: 0 };
        mockTrackValue.value = { tracks: [], selectedTrackId: null };
        // Track t1 has no entry in the sub-lane map -> falls back to an empty list.
        mockWorkspaceValue.value = {
            automationVisibility: 'overlay',
            automationSubLanes: {},
        };
        mockAutomationValue.value = { lanes: [] };
        mockBuildTimelineRenderModel.mockReturnValue(model);

        // Y inside the track body (100px tall) but no sub-lanes are defined.
        expect(hitTestAutomationSubLane(50, 50)).toBeNull();
    });

    it('returns null when the sub-lane has no matching automation lane registered', () => {
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
        mockTimelineViewValue.value = { pixelsPerBeat: 10, scrollX: 0, scrollY: 0 };
        mockTrackValue.value = { tracks: [], selectedTrackId: null };
        mockWorkspaceValue.value = {
            automationVisibility: 'overlay',
            automationSubLanes: { t1: ['gain'] },
        };
        // No lane for t1/gain in the automation store -> hit is rejected.
        mockAutomationValue.value = { lanes: [] };
        mockBuildTimelineRenderModel.mockReturnValue(model);

        expect(hitTestAutomationSubLane(50, 70)).toBeNull();
    });

    it('returns null when the y coordinate is below every track lane', () => {
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
        mockTimelineViewValue.value = { pixelsPerBeat: 10, scrollX: 0, scrollY: 0 };
        mockTrackValue.value = { tracks: [], selectedTrackId: null };
        mockWorkspaceValue.value = {
            automationVisibility: 'overlay',
            automationSubLanes: { t1: ['gain'] },
        };
        mockAutomationValue.value = { lanes: [] };
        mockBuildTimelineRenderModel.mockReturnValue(model);

        // Y far below the 100px-tall track -> no track lane contains it.
        expect(hitTestAutomationSubLane(50, 500)).toBeNull();
    });
});
