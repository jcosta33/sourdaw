import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    getAutomationLanes: vi.fn().mockReturnValue([]),
    invertAutomation: vi.fn(),
    reverseAutomation: vi.fn(),
    scaleAutomationValues: vi.fn(),
    shiftClipAutomation: vi.fn(),
    stretchAutomationTime: vi.fn(),
    thinAutomationPoints: vi.fn(),
}));
vi.mock('#/modules/Command/useCases', () => ({ pushUndoEntry: vi.fn() }));
vi.mock('../../../useCases/timelineInteractions/commitInlineMidiNoteCreate', () => ({
    commitInlineMidiNoteCreate: vi.fn(),
}));
vi.mock('../../../useCases/timelineInteractions/commitInlineMidiNoteDelete', () => ({
    commitInlineMidiNoteDelete: vi.fn(),
}));
type MockTrack = { id: string; kind: string; clips: Array<{ id: string; startBeat: number; endBeat: number }> };
const trackStoreMock = vi.hoisted((): { state: { tracks: MockTrack[] } } => ({
    state: { tracks: [] },
}));
vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        get value() {
            return trackStoreMock.state;
        },
    },
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
            trackStoreMock.state = { tracks: [track] };

            handleCutTool(10, 10, 4);
            expect(splitClip).toHaveBeenCalledWith('c1', 4);
        });
    });

    describe('handleDrawTool', () => {
        it('should update drawDragRef and select track if track is hit', () => {
            vi.mocked(hitTestTrack).mockReturnValue('t1');
            const track = { id: 't1', kind: 'audio', clips: [] };
            trackStoreMock.state = { tracks: [track] };
            const ref = { current: null };

            handleDrawTool(0, 10, 4.5, ref as any);

            expect(ref.current).toEqual({ trackId: 't1', startBeat: 4, clipType: 'audio' });
            expect(selectTrack).toHaveBeenCalledWith('t1');
        });
    });

    describe('handleAutomationTool', () => {
        it('should stage an automation point if sub-lane is hit', () => {
            const hit = { laneId: 'l1', trackId: 't1', beat: 4, value: 0.5 };
            vi.mocked(hitTestAutomationSubLane).mockReturnValue(hit as any);
            const ref = { current: null };

            const result = handleAutomationTool(10, 10, 4, 0, ref as any);

            expect(result).toBe(true);
            expect(ref.current).toEqual({
                laneId: 'l1',
                trackId: 't1',
                parameterId: 'gain',
                parameterName: 'Gain',
                points: [{ beat: 4, value: 0.5, curve: 'linear', tension: 0 }],
            });
            expect(selectTrack).toHaveBeenCalledWith('t1');
        });
    });

    describe('tryPaintSubLane', () => {
        it('should return false if no sub-lane hit', () => {
            vi.mocked(hitTestAutomationSubLane).mockReturnValue(null);
            const result = tryPaintSubLane(10, 10, { current: null });
            expect(result).toBe(false);
        });

        it('should stage and return true if sub-lane hit', () => {
            const hit = { laneId: 'l1', trackId: 't1', beat: 2, value: 0.8 };
            vi.mocked(hitTestAutomationSubLane).mockReturnValue(hit as any);
            const ref = { current: null };

            const result = tryPaintSubLane(10, 10, ref as any);

            expect(result).toBe(true);
            expect(ref.current).toEqual({
                laneId: 'l1',
                trackId: 't1',
                parameterId: 'gain',
                parameterName: 'Gain',
                points: [{ beat: 2, value: 0.8, curve: 'linear', tension: 0 }],
            });
        });
    });
});
