import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AutomationSubLaneRenderModel, type TrackRenderModel } from '../../../models/TimelineRenderModel';
import { hitTestAutomationSubLane } from '../hitTestAutomationSubLane';

const { view, buildTimelineRenderModel } = vi.hoisted(() => ({
    view: { pixelsPerBeat: 10, scrollX: 20, scrollY: 10 },
    buildTimelineRenderModel: vi.fn(),
}));

vi.mock('../../../stores/timelineViewStore', () => ({ timelineViewStore: { value: view } }));
vi.mock('../../buildTimelineRenderModel', () => ({ buildTimelineRenderModel }));

function row(id: string, index: number, lanes: AutomationSubLaneRenderModel[] = []): TrackRenderModel {
    return {
        id,
        name: id,
        index,
        kind: 'midi',
        color: '#000',
        muted: false,
        soloed: false,
        height: 44,
        clips: [],
        variationLanes: index === 0 ? [{ id: 'alt', name: 'Alt', clips: [] }] : [],
        automationLanes: lanes,
        automationMode: 'read',
    };
}

function lane(trackId: string, parameterId: string, minValue: number, maxValue: number): AutomationSubLaneRenderModel {
    return {
        id: `${trackId}-${parameterId}`,
        trackId,
        parameterId,
        parameterName: parameterId,
        minValue,
        maxValue,
        valueAtBeat: () => null,
    };
}

describe('hitTestAutomationSubLane', () => {
    beforeEach(() => {
        buildTimelineRenderModel.mockReset();
    });

    it('places 40px automation rows after the clip and variation rows under nonzero scroll', () => {
        const pan = lane('t0', 'pan', -1, 1);
        const gain = lane('t0', 'gain', 0, 2);
        const secondPan = lane('t1', 'pan', -1, 1);
        buildTimelineRenderModel.mockReturnValue({ tracks: [row('t0', 0, [pan, gain]), row('t1', 1, [secondPan])] });

        // Screen rows: clip -10..34, variation 34..58, pan 58..98, gain 98..138.
        expect(hitTestAutomationSubLane(50, 78)).toEqual({ lane: pan, beat: 7, value: 0 });
        expect(hitTestAutomationSubLane(50, 98)).toEqual({ lane: gain, beat: 7, value: 2 });
        expect(hitTestAutomationSubLane(50, 33)).toBeNull();
        expect(hitTestAutomationSubLane(50, 57)).toBeNull();
        expect(hitTestAutomationSubLane(50, 138)).toBeNull();
        expect(hitTestAutomationSubLane(50, 181)).toBeNull();
        expect(hitTestAutomationSubLane(50, 202)).toEqual({ lane: secondPan, beat: 7, value: 0 });
        expect(hitTestAutomationSubLane(50, 222)).toBeNull();
    });

    it('cannot hit a lane excluded from the rendered model', () => {
        buildTimelineRenderModel.mockReturnValue({ tracks: [row('t0', 0), row('t1', 1)] });
        expect(hitTestAutomationSubLane(50, 78)).toBeNull();
    });
});
