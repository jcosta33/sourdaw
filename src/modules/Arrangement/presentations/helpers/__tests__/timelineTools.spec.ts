import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addAutomationPoint } from '#/modules/Automation/useCases';

import { trackStore } from '../../../stores/trackStore';
import { splitClip } from '../../../useCases/clipEditing/splitClip';
import { hitTestAutomationSubLane } from '../../../useCases/timelineInteractions/hitTestAutomationSubLane';
import { hitTestClip } from '../../../useCases/timelineInteractions/hitTestClip/hitTestClip';
import { hitTestTrack } from '../../../useCases/timelineInteractions/hitTestClip/hitTestTrack';
import { selectTrack } from '../../../useCases/toggleTrackState/selectTrack';
import { handleCutTool, handleDrawTool, handleAutomationTool, tryPaintSubLane } from '../timelineTools';

vi.mock('../../../useCases/timelineInteractions/hitTestClip/hitTestClip', () => ({ hitTestClip: vi.fn() }));
vi.mock('../../../useCases/timelineInteractions/hitTestClip/hitTestTrack', () => ({ hitTestTrack: vi.fn() }));
vi.mock('../../../useCases/timelineInteractions/hitTestAutomationSubLane', () => ({
    hitTestAutomationSubLane: vi.fn(),
}));
vi.mock('../../../useCases/clipEditing/splitClip', () => ({ splitClip: vi.fn() }));
vi.mock('../../../useCases/clip/addClip', () => ({ addClip: vi.fn() }));
vi.mock('../../../useCases/clip/removeClip', () => ({ removeClip: vi.fn() }));
vi.mock('../../../useCases/toggleTrackState/selectTrack', () => ({ selectTrack: vi.fn() }));
vi.mock('#/modules/Automation/useCases', () => ({
    automationStore: { value: { lanes: [] } },
    addAutomationPoint: vi.fn(),
    addAutomationLane: vi.fn(),
    getAutomationLanes: vi.fn().mockReturnValue([]),
    invertAutomation: vi.fn(),
    reverseAutomation: vi.fn(),
    scaleAutomationValues: vi.fn(),
    shiftClipAutomation: vi.fn(),
    stretchAutomationTime: vi.fn(),
    thinAutomationPoints: vi.fn(),
}));
vi.mock('#/modules/Command/useCases', () => ({ pushUndoEntry: vi.fn() }));
vi.mock('../../../stores/trackStore', () => ({
    trackStore: { value: { tracks: [] } },
}));
vi.mock('../../../stores/timelineViewStore', () => ({
    timelineViewStore: { value: { pixelsPerBeat: 100, scrollX: 0 } },
}));

describe('timelineTools', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('handleCutTool', () => {
        it('should return true and not call splitClip if no clip is hit', () => {
            vi.mocked(hitTestClip).mockReturnValue(null);
            const result = handleCutTool(10, 10, 4);
            expect(result).toBe(true);
            expect(splitClip).not.toHaveBeenCalled();
        });

        it('should call splitClip if a clip is hit', () => {
            vi.mocked(hitTestClip).mockReturnValue({ clipId: 'c1' } as any);
            const track = { id: 't1', clips: [{ id: 'c1', startBeat: 0, endBeat: 8 }], kind: 'audio' };
            vi.mocked(trackStore).value = { tracks: [track as any] };

            handleCutTool(10, 10, 4);
            expect(splitClip).toHaveBeenCalledWith('c1', 4);
        });
    });

    describe('handleDrawTool', () => {
        it('should update drawDragRef and select track if track is hit', () => {
            vi.mocked(hitTestTrack).mockReturnValue('t1');
            const track = { id: 't1', kind: 'audio', clips: [] };
            vi.mocked(trackStore).value = { tracks: [track as any] };
            const ref = { current: null };

            handleDrawTool(0, 10, 4.5, ref as any);

            expect(ref.current).toEqual({ trackId: 't1', startBeat: 4, clipType: 'audio' });
            expect(selectTrack).toHaveBeenCalledWith('t1');
        });
    });

    describe('handleAutomationTool', () => {
        it('should add automation point if sub-lane is hit', () => {
            const hit = { laneId: 'l1', trackId: 't1', beat: 4, value: 0.5 };
            vi.mocked(hitTestAutomationSubLane).mockReturnValue(hit as any);
            const ref = { current: null };

            const result = handleAutomationTool(10, 10, 4, 0, ref as any);

            expect(result).toBe(true);
            expect(addAutomationPoint).toHaveBeenCalledWith('l1', expect.objectContaining({ beat: 4, value: 0.5 }));
            expect(ref.current).toBeDefined();
            expect(selectTrack).toHaveBeenCalledWith('t1');
        });
    });

    describe('tryPaintSubLane', () => {
        it('should return false if no sub-lane hit', () => {
            vi.mocked(hitTestAutomationSubLane).mockReturnValue(null);
            const result = tryPaintSubLane(10, 10, { current: null });
            expect(result).toBe(false);
        });

        it('should paint and return true if sub-lane hit', () => {
            const hit = { laneId: 'l1', trackId: 't1', beat: 2, value: 0.8 };
            vi.mocked(hitTestAutomationSubLane).mockReturnValue(hit as any);
            const ref = { current: null };

            const result = tryPaintSubLane(10, 10, ref as any);

            expect(result).toBe(true);
            expect(addAutomationPoint).toHaveBeenCalledWith('l1', expect.objectContaining({ beat: 2, value: 0.8 }));
        });
    });
});
