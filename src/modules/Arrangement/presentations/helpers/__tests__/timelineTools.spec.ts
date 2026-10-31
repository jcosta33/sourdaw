import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getAutomationLanes } from '#/modules/Automation/useCases';

import { type AutomationPoint } from '../../../models/AutomationViewTypes';
import { splitClipWithUndo } from '../../../useCases/clipEditing/splitClipWithUndo';
import { commitInlineMidiNoteCreate } from '../../../useCases/timelineInteractions/commitInlineMidiNoteCreate';
import { commitInlineMidiNoteDelete } from '../../../useCases/timelineInteractions/commitInlineMidiNoteDelete';
import { getGridSnap } from '../../../useCases/timelineInteractions/getGridSnap';
import { hitTestAutomationSubLane } from '../../../useCases/timelineInteractions/hitTestAutomationSubLane';
import { type ClipHitResult, hitTestClip } from '../../../useCases/timelineInteractions/hitTestClip/hitTestClip';
import { hitTestTrack } from '../../../useCases/timelineInteractions/hitTestClip/hitTestTrack';
import { selectTrack } from '../../../useCases/toggleTrackState/selectTrack';
import { getContentY, resolveTrackAtY, valueAtTrackY } from '../timelineMouse';
import {
    handleCutTool,
    handleDrawTool,
    handleAutomationTool,
    tryPaintSubLane,
    paintAutoDragPoint,
} from '../timelineTools';

vi.mock('../../../useCases/timelineInteractions/hitTestClip/hitTestClip', () => ({ hitTestClip: vi.fn() }));
vi.mock('../../../useCases/timelineInteractions/hitTestClip/hitTestTrack', () => ({ hitTestTrack: vi.fn() }));
vi.mock('../../../useCases/timelineInteractions/hitTestAutomationSubLane', () => ({
    hitTestAutomationSubLane: vi.fn(),
}));
vi.mock('../../../useCases/clipEditing/splitClipWithUndo', () => ({ splitClipWithUndo: vi.fn() }));
vi.mock('../../../useCases/toggleTrackState/selectTrack', () => ({ selectTrack: vi.fn() }));
vi.mock('../../../useCases/timelineInteractions/getGridSnap', () => ({ getGridSnap: vi.fn() }));
vi.mock('../timelineMouse', () => ({
    getContentY: vi.fn(),
    resolveTrackAtY: vi.fn(),
    valueAtTrackY: vi.fn(),
}));
vi.mock('#/modules/Automation/useCases', () => ({
    getAutomationLanes: vi.fn().mockReturnValue([]),
    invertAutomation: vi.fn(),
    reverseAutomation: vi.fn(),
    scaleAutomationValues: vi.fn(),
    shiftClipAutomation: vi.fn(),
    stretchAutomationTime: vi.fn(),
    thinAutomationPoints: vi.fn(),
}));
vi.mock('../../../useCases/timelineInteractions/commitInlineMidiNoteCreate', () => ({
    commitInlineMidiNoteCreate: vi.fn(),
}));
vi.mock('../../../useCases/timelineInteractions/commitInlineMidiNoteDelete', () => ({
    commitInlineMidiNoteDelete: vi.fn(),
}));
type MockTrack = {
    id: string;
    kind: string;
    clips: Array<{ id: string; startBeat: number; endBeat: number; isInlineEditing?: boolean; type?: string }>;
};
const trackStoreMock = vi.hoisted((): { state: { tracks: MockTrack[] } | null } => ({
    state: { tracks: [] },
}));
vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        get value() {
            return trackStoreMock.state;
        },
    },
}));
const timelineViewMock = vi.hoisted((): { value: { pixelsPerBeat: number; scrollX: number } | null } => ({
    value: { pixelsPerBeat: 100, scrollX: 0 },
}));
vi.mock('../../../stores/timelineViewStore', () => ({
    timelineViewStore: {
        get value() {
            return timelineViewMock.value;
        },
    },
}));

type AutoDragState = {
    current: {
        laneId?: string;
        trackId: string;
        parameterId: string;
        parameterName: string;
        points: AutomationPoint[];
    } | null;
};
const autoDragPoint = (trackId: string, points: AutomationPoint[] = []): NonNullable<AutoDragState['current']> => ({
    laneId: undefined,
    trackId,
    parameterId: 'gain',
    parameterName: 'Gain',
    points,
});

describe('timelineTools', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('handleCutTool', () => {
        it('should return true and not split if no clip is hit', () => {
            vi.mocked(hitTestClip).mockReturnValue(null);
            const result = handleCutTool(10, 10, 4);
            expect(result).toBe(true);
            expect(splitClipWithUndo).not.toHaveBeenCalled();
        });

        it('should delegate the split to splitClipWithUndo if a clip is hit', () => {
            vi.mocked(hitTestClip).mockReturnValue({ clipId: 'c1' } as any);

            handleCutTool(10, 10, 4);
            expect(splitClipWithUndo).toHaveBeenCalledWith('c1', 4);
        });
    });

    describe('handleDrawTool', () => {
        it('should update drawDragRef and select track if track is hit', () => {
            vi.mocked(hitTestTrack).mockReturnValue('t1');
            const track = { id: 't1', kind: 'audio', clips: [] };
            trackStoreMock.state = { tracks: [track] };
            const ref = { current: null };

            handleDrawTool(0, 10, 4.5, ref);

            expect(ref.current).toEqual({ trackId: 't1', startBeat: 4, clipType: 'audio' });
            expect(selectTrack).toHaveBeenCalledWith('t1');
        });
    });

    describe('handleAutomationTool', () => {
        it('should stage an automation point if sub-lane is hit', () => {
            const hit = { laneId: 'l1', trackId: 't1', beat: 4, value: 0.5 };
            vi.mocked(hitTestAutomationSubLane).mockReturnValue(hit as any);
            const ref = { current: null };

            const result = handleAutomationTool(10, 10, 4, 0, ref);

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

            const result = tryPaintSubLane(10, 10, ref);

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

    describe('handleDrawTool — note interactions', () => {
        it('deletes a note when the draw tool hits one', () => {
            const hit: ClipHitResult = { clipId: 'c1', trackId: 't1', noteId: 'n1', pitch: 60 };
            vi.mocked(hitTestClip).mockReturnValue(hit);

            const result = handleDrawTool(0, 10, 4, { current: null });

            expect(commitInlineMidiNoteDelete).toHaveBeenCalledWith({ clipId: 'c1', noteId: 'n1' });
            expect(result).toBe(true);
        });

        const inlineMidiTrack = (clipStartBeat: number): MockTrack => ({
            id: 't1',
            kind: 'midi',
            clips: [
                {
                    id: 'c1',
                    startBeat: clipStartBeat,
                    endBeat: clipStartBeat + 8,
                    isInlineEditing: true,
                    type: 'midi',
                },
            ],
        });

        it('creates a new note at the pointer pitch when drawing inside an inline-editing midi clip', () => {
            vi.mocked(hitTestClip).mockReturnValue({ clipId: 'c1', trackId: 't1', pitch: 72, noteBeat: 4.25 });
            vi.mocked(getGridSnap).mockReturnValue(0.25);
            trackStoreMock.state = { tracks: [inlineMidiTrack(0)] };

            const result = handleDrawTool(0, 10, 4.25, { current: null });

            expect(commitInlineMidiNoteCreate).toHaveBeenCalledWith({
                clipId: 'c1',
                pitch: 72,
                startBeat: 4.25,
                duration: 0.25,
                velocity: 100,
            });
            expect(result).toBe(true);
        });

        it('stamps in the grid cell containing the pointer, not at the nearest grid line', () => {
            vi.mocked(getGridSnap).mockReturnValue(0.5);
            trackStoreMock.state = { tracks: [inlineMidiTrack(0)] };

            // 4.4 is in the cell 4..4.5 but nearer its end; rounding would stamp at 4.5.
            vi.mocked(hitTestClip).mockReturnValue({ clipId: 'c1', trackId: 't1', pitch: 60, noteBeat: 4.4 });
            handleDrawTool(0, 10, 4.4, { current: null });
            expect(commitInlineMidiNoteCreate).toHaveBeenLastCalledWith(expect.objectContaining({ startBeat: 4 }));

            vi.mocked(hitTestClip).mockReturnValue({ clipId: 'c1', trackId: 't1', pitch: 60, noteBeat: 4.6 });
            handleDrawTool(0, 10, 4.6, { current: null });
            expect(commitInlineMidiNoteCreate).toHaveBeenLastCalledWith(expect.objectContaining({ startBeat: 4.5 }));
        });

        it('stamps the clip-relative beat for a clip that starts later on the timeline', () => {
            vi.mocked(getGridSnap).mockReturnValue(0.25);
            trackStoreMock.state = { tracks: [inlineMidiTrack(8)] };
            // The pointer is at absolute beat 9.3, which is 1.3 beats into the clip.
            vi.mocked(hitTestClip).mockReturnValue({ clipId: 'c1', trackId: 't1', pitch: 60, noteBeat: 1.3 });

            handleDrawTool(0, 10, 9.3, { current: null });

            expect(commitInlineMidiNoteCreate).toHaveBeenCalledWith(expect.objectContaining({ startBeat: 1.25 }));
        });

        it('stamps at the pitch the hit test reports for the pointer row, never a fixed pitch', () => {
            vi.mocked(getGridSnap).mockReturnValue(0.25);
            trackStoreMock.state = { tracks: [inlineMidiTrack(0)] };

            for (const pitch of [48, 67, 96]) {
                vi.mocked(hitTestClip).mockReturnValue({ clipId: 'c1', trackId: 't1', pitch, noteBeat: 1 });
                handleDrawTool(0, 10, 1, { current: null });
                expect(commitInlineMidiNoteCreate).toHaveBeenLastCalledWith(expect.objectContaining({ pitch }));
            }
        });

        it('stamps nothing when the pointer is inside the clip but on no pitch row', () => {
            vi.mocked(hitTestClip).mockReturnValue({ clipId: 'c1', trackId: 't1' });
            vi.mocked(getGridSnap).mockReturnValue(0.25);
            trackStoreMock.state = { tracks: [inlineMidiTrack(0)] };
            const ref = { current: null };

            const result = handleDrawTool(0, 1, 4, ref);

            expect(result).toBe(true);
            expect(commitInlineMidiNoteCreate).not.toHaveBeenCalled();
            expect(ref.current).toBeNull();
        });

        it('stamps at the unsnapped pointer beat when the grid is off', () => {
            vi.mocked(getGridSnap).mockReturnValue(0);
            vi.mocked(hitTestClip).mockReturnValue({ clipId: 'c1', trackId: 't1', pitch: 60, noteBeat: 4.37 });
            trackStoreMock.state = { tracks: [inlineMidiTrack(0)] };

            handleDrawTool(0, 10, 4.37, { current: null });

            expect(commitInlineMidiNoteCreate).toHaveBeenCalledWith(expect.objectContaining({ startBeat: 4.37 }));
        });

        it('keeps a pointer on a grid line in the cell that starts there despite division error', () => {
            vi.mocked(getGridSnap).mockReturnValue(0.1);
            vi.mocked(hitTestClip).mockReturnValue({ clipId: 'c1', trackId: 't1', pitch: 60, noteBeat: 0.3 });
            trackStoreMock.state = { tracks: [inlineMidiTrack(0)] };

            handleDrawTool(0, 10, 0.3, { current: null });

            const stamped = vi.mocked(commitInlineMidiNoteCreate).mock.calls[0]![0].startBeat;
            expect(stamped).toBeCloseTo(0.3, 9);
        });

        it('falls through to track selection when the clip is not inline-editing', () => {
            const hit: ClipHitResult = { clipId: 'c1', trackId: 't1' };
            vi.mocked(hitTestClip).mockReturnValue(hit);
            vi.mocked(hitTestTrack).mockReturnValue('t1');
            trackStoreMock.state = {
                tracks: [{ id: 't1', kind: 'audio', clips: [{ id: 'c1', startBeat: 0, endBeat: 4 }] }],
            };
            const ref = { current: null };

            handleDrawTool(0, 10, 4, ref);

            expect(commitInlineMidiNoteCreate).not.toHaveBeenCalled();
            expect(ref.current).toEqual({ trackId: 't1', startBeat: 4, clipType: 'audio' });
        });

        it('records a midi clipType for midi tracks on the draw-drag fallback', () => {
            vi.mocked(hitTestClip).mockReturnValue(null);
            vi.mocked(hitTestTrack).mockReturnValue('t1');
            trackStoreMock.state = { tracks: [{ id: 't1', kind: 'midi', clips: [] }] };
            const ref = { current: null };

            handleDrawTool(0, 10, 4, ref);

            expect(ref.current).toEqual({ trackId: 't1', startBeat: 4, clipType: 'midi' });
        });

        it('leaves the drag ref null and skips selection when neither clip nor track is hit', () => {
            vi.mocked(hitTestClip).mockReturnValue(null);
            vi.mocked(hitTestTrack).mockReturnValue(null);
            trackStoreMock.state = null;
            const ref = { current: null };

            const result = handleDrawTool(0, 10, 4, ref);

            expect(result).toBe(true);
            expect(ref.current).toBeNull();
            expect(selectTrack).not.toHaveBeenCalled();
        });
    });

    describe('handleAutomationTool — fallback gain lane', () => {
        it('returns early when no track is found at the coordinate', () => {
            vi.mocked(hitTestAutomationSubLane).mockReturnValue(null);
            vi.mocked(hitTestTrack).mockReturnValue(null);
            const ref = { current: null };

            const result = handleAutomationTool(10, 10, 4, 0, ref);

            expect(result).toBe(true);
            expect(ref.current).toBeNull();
        });

        it('stages a gain point on the resolved track using the lane id when a lane exists', () => {
            vi.mocked(hitTestAutomationSubLane).mockReturnValue(null);
            vi.mocked(hitTestTrack).mockReturnValue('t1');
            vi.mocked(getContentY).mockReturnValue(50);
            vi.mocked(resolveTrackAtY).mockReturnValue({ id: 't1', offset: 0, height: 80 } as any);
            vi.mocked(valueAtTrackY).mockReturnValue(0.3);
            vi.mocked(getAutomationLanes).mockReturnValue([
                { id: 'lane-1', trackId: 't1', parameterId: 'gain' },
            ] as any);
            const ref: AutoDragState = { current: null };

            handleAutomationTool(10, 50, 4, 0, ref);

            expect(ref.current).toMatchObject({ laneId: 'lane-1', trackId: 't1', parameterId: 'gain' });
            expect(ref.current?.points[0]).toMatchObject({ beat: 4, value: 0.3 });
        });

        it('stages with a null laneId when no gain lane exists on the track', () => {
            vi.mocked(hitTestAutomationSubLane).mockReturnValue(null);
            vi.mocked(hitTestTrack).mockReturnValue('t1');
            vi.mocked(getContentY).mockReturnValue(50);
            vi.mocked(resolveTrackAtY).mockReturnValue(null);
            vi.mocked(getAutomationLanes).mockReturnValue([]);
            const ref: AutoDragState = { current: null };

            handleAutomationTool(10, 50, 4, 0, ref);

            // no trackHit → value defaults to 0.5; no lane → laneId undefined
            expect(ref.current?.laneId).toBeUndefined();
            expect(ref.current?.points[0]?.value).toBe(0.5);
        });
    });

    describe('paintAutoDragPoint', () => {
        it('is a no-op when the drag ref is empty', () => {
            expect(() => paintAutoDragPoint(10, 10, 0, { current: null })).not.toThrow();
        });

        it('is a no-op when the view state has not loaded', () => {
            const ref: AutoDragState = { current: autoDragPoint('t1') };
            timelineViewMock.value = null;

            expect(() => paintAutoDragPoint(10, 10, 0, ref)).not.toThrow();
            expect(ref.current?.points).toEqual([]);
        });

        it('pushes a new point when the cursor moved past the 0.1-beat threshold', () => {
            timelineViewMock.value = { pixelsPerBeat: 100, scrollX: 0 };
            vi.mocked(getContentY).mockReturnValue(50);
            vi.mocked(resolveTrackAtY).mockReturnValue({ id: 't1', offset: 0, height: 80 } as any);
            vi.mocked(valueAtTrackY).mockReturnValue(0.4);
            const ref: AutoDragState = {
                current: autoDragPoint('t1', [{ beat: 1, value: 0.5, curve: 'linear', tension: 0 }]),
            };

            // x=1000 → beat 10, well past the last point's beat (1)
            paintAutoDragPoint(1000, 50, 0, ref);

            expect(ref.current?.points).toHaveLength(2);
            expect(ref.current?.points[1]).toMatchObject({ beat: 10, value: 0.4 });
        });

        it('skips pushing when the cursor is within the 0.1-beat threshold of the last point', () => {
            timelineViewMock.value = { pixelsPerBeat: 100, scrollX: 0 };
            vi.mocked(getContentY).mockReturnValue(50);
            vi.mocked(resolveTrackAtY).mockReturnValue({ id: 't1', offset: 0, height: 80 } as any);
            vi.mocked(valueAtTrackY).mockReturnValue(0.5);
            const ref: AutoDragState = {
                current: autoDragPoint('t1', [{ beat: 10, value: 0.5, curve: 'linear', tension: 0 }]),
            };

            // x=1005 → beat 10.05, within 0.1 of last point (10) → no push
            paintAutoDragPoint(1005, 50, 0, ref);

            expect(ref.current?.points).toHaveLength(1);
        });

        it('pushes a point when the ref has no existing points', () => {
            timelineViewMock.value = { pixelsPerBeat: 100, scrollX: 0 };
            vi.mocked(getContentY).mockReturnValue(50);
            vi.mocked(resolveTrackAtY).mockReturnValue(null);
            const ref: AutoDragState = { current: autoDragPoint('t1') };

            paintAutoDragPoint(500, 50, 0, ref);

            // lastPoint is undefined → push; no trackHit → value 0.5
            expect(ref.current?.points).toHaveLength(1);
            expect(ref.current?.points[0]?.value).toBe(0.5);
        });
    });
});
