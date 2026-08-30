import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutomationLane } from '../../../models/Automation';
import type { AutomationStoreState } from '../../../stores/automationStore';

const mocks = vi.hoisted(() => {
    const state: { value: AutomationStoreState | null } = { value: null };

    return {
        state,
        getValue: vi.fn((): AutomationStoreState | null => state.value),
        set: vi.fn((nextState: AutomationStoreState): void => {
            state.value = nextState;
        }),
    };
});

vi.mock('../../../stores/automationStore', () => ({
    automationStore: {
        get value(): AutomationStoreState | null {
            return mocks.getValue();
        },
        set: mocks.set,
    },
}));

const { duplicateClipAutomationBatch } = await import('../duplicateClipAutomationBatch');

type Copies = Parameters<typeof duplicateClipAutomationBatch>[0]['copies'];

function createLane(id: string, clipId: string): AutomationLane {
    return {
        id,
        trackId: 'track-source',
        clipId,
        parameterId: `parameter-${id}`,
        parameterName: `Parameter ${id}`,
        points: [
            {
                beat: 1,
                value: 0.5,
                curve: 'bezier',
                tension: 0,
                cp1: { x: 0.25, y: 0.4 },
                cp2: { x: 0.75, y: 0.6 },
            },
        ],
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}

function duplicate(copies: Copies): ReturnType<typeof duplicateClipAutomationBatch> {
    return duplicateClipAutomationBatch({ copies });
}

describe('duplicateClipAutomationBatch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.value = { lanes: [] };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns no-op rollbacks for empty, missing, and unmatched owner state', () => {
        const rollbackEmpty = duplicate([]);

        expect(() => rollbackEmpty()).not.toThrow();
        expect(mocks.getValue).not.toHaveBeenCalled();
        expect(mocks.set).not.toHaveBeenCalled();

        mocks.state.value = null;
        const rollbackMissing = duplicate([
            { sourceClipId: 'source', targetClipId: 'target', targetTrackId: 'track-target' },
        ]);

        expect(() => rollbackMissing()).not.toThrow();
        expect(mocks.set).not.toHaveBeenCalled();

        const previousState: AutomationStoreState = { lanes: [createLane('lane-keep', 'clip-keep')] };
        mocks.state.value = previousState;
        const rollbackUnmatched = duplicate([
            { sourceClipId: 'source', targetClipId: 'target', targetTrackId: 'track-target' },
        ]);

        expect(() => rollbackUnmatched()).not.toThrow();
        expect(mocks.set).not.toHaveBeenCalled();
        expect(mocks.state.value).toBe(previousState);
    });

    it('commits one ordered batch and rolls back to the exact captured snapshot idempotently', () => {
        const sourceOne = createLane('lane-one', 'clip-one');
        const unrelated = createLane('lane-keep', 'clip-keep');
        const sourceTwo = createLane('lane-two', 'clip-two');
        const previousState: AutomationStoreState = { lanes: [sourceOne, unrelated, sourceTwo] };
        mocks.state.value = previousState;
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('11111111-0000-4000-8000-000000000000')
            .mockReturnValueOnce('22222222-0000-4000-8000-000000000000');

        const rollback = duplicate([
            { sourceClipId: 'clip-two', targetClipId: 'target-two', targetTrackId: 'track-target' },
            { sourceClipId: 'clip-one', targetClipId: 'target-one', targetTrackId: 'track-target' },
        ]);

        const committedState = mocks.state.value;
        const firstCopy = committedState.lanes[3];
        const secondCopy = committedState.lanes[4];
        if (!firstCopy || !secondCopy) {
            throw new Error('Expected ordered automation copies');
        }

        expect(mocks.set).toHaveBeenCalledTimes(1);
        expect(committedState).not.toBe(previousState);
        expect(committedState.lanes.slice(0, 3)).toEqual(previousState.lanes);
        expect(firstCopy).toMatchObject({
            id: 'auto-11111111-0000-4000-8000-000000000000',
            trackId: 'track-target',
            clipId: 'target-two',
            parameterId: sourceTwo.parameterId,
        });
        expect(secondCopy).toMatchObject({
            id: 'auto-22222222-0000-4000-8000-000000000000',
            trackId: 'track-target',
            clipId: 'target-one',
            parameterId: sourceOne.parameterId,
        });
        expect(firstCopy.points).not.toBe(sourceTwo.points);
        expect(firstCopy.points[0]?.cp1).not.toBe(sourceTwo.points[0]?.cp1);

        const replacement = { ...firstCopy };
        const intervening = createLane('lane-intervening', 'clip-intervening');
        mocks.state.value = {
            lanes: [...committedState.lanes.slice(0, 3), replacement, secondCopy, intervening],
        };

        expect(() => rollback()).not.toThrow();
        expect(mocks.state.value.lanes).toEqual([...previousState.lanes, intervening]);
        expect(mocks.state.value.lanes[3]).toBe(intervening);
        expect(mocks.set).toHaveBeenCalledTimes(2);
        expect(() => rollback()).not.toThrow();
        expect(mocks.set).toHaveBeenCalledTimes(2);
    });

    it('rolls back lanes matched by lane id after a CRDT hydrate reseats them', () => {
        const source = createLane('lane-source', 'clip-source');
        const previousState: AutomationStoreState = { lanes: [source] };
        mocks.state.value = previousState;
        vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('11111111-0000-4000-8000-000000000000');

        const rollback = duplicate([
            { sourceClipId: 'clip-source', targetClipId: 'clip-target', targetTrackId: 'track-target' },
        ]);

        const committed = mocks.state.value.lanes[1]!;
        // A CRDT hydrate reseats store objects onto fresh instances — same lane
        // ids, new identities — so an identity-keyed rollback would no-op here.
        const reseat = (lane: AutomationLane): AutomationLane => ({
            ...lane,
            points: lane.points.map((p) => ({ ...p })),
        });
        const reseatedCopy = reseat(committed);
        const reseatedSource = reseat(source);
        const intervening = createLane('lane-intervening', 'clip-intervening');
        mocks.state.value = { lanes: [reseatedSource, reseatedCopy, intervening] };

        expect(() => rollback()).not.toThrow();
        expect(mocks.state.value.lanes).toEqual([reseatedSource, intervening]);
    });

    it('carries the source lane persisted fields onto each copy', () => {
        const source = createLane('lane-source', 'clip-source');
        const fullSource: AutomationLane = {
            ...source,
            clipAutomationMode: 'multiplicative',
            enabled: false,
            collapsed: true,
            linkedLaneId: 'lane-leader',
            linkScale: -1,
            viewMinValue: -0.5,
            viewMaxValue: 1.5,
            color: '#ff8800',
            trimPoints: [{ beat: 0.5, value: 0.2, curve: 'linear', tension: 0 }],
            ghostPoints: [{ beat: 1.5, value: 0.4, curve: 'stairs', tension: 0, stairSteps: 8 }],
            objects: [
                {
                    id: 'obj-1',
                    laneId: 'lane-source',
                    startBeat: 0,
                    endBeat: 2,
                    points: [],
                    name: 'Container',
                },
            ],
        };
        mocks.state.value = { lanes: [fullSource] };
        vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('11111111-0000-4000-8000-000000000000');

        duplicate([{ sourceClipId: 'clip-source', targetClipId: 'clip-target', targetTrackId: 'track-target' }]);

        const copy = mocks.state.value.lanes[1]!;
        expect(copy.trackId).toBe('track-target');
        expect(copy.clipId).toBe('clip-target');
        expect(copy.parameterId).toBe(fullSource.parameterId);
        expect(copy.points).toEqual(fullSource.points);
        expect(copy.points[0]?.cp1).not.toBe(fullSource.points[0]?.cp1);
        expect(copy.clipAutomationMode).toBe('multiplicative');
        // Non-default source values, so each assertion fails when its field
        // stops being carried onto the copy.
        expect(copy.enabled).toBe(false);
        expect(copy.collapsed).toBe(true);
        expect(copy.linkedLaneId).toBe('lane-leader');
        expect(copy.linkScale).toBe(-1);
        expect(copy.viewMinValue).toBe(-0.5);
        expect(copy.viewMaxValue).toBe(1.5);
        expect(copy.color).toBe('#ff8800');
        expect(copy.trimPoints).toEqual(fullSource.trimPoints);
        expect(copy.ghostPoints).toEqual(fullSource.ghostPoints);
        expect(copy.objects).toHaveLength(1);
        expect(copy.objects[0]!.laneId).toBe(copy.id);
    });

    it('does not write a partial batch when preparation fails after an earlier pair', () => {
        const previousState: AutomationStoreState = {
            lanes: [createLane('lane-one', 'clip-one'), createLane('lane-two', 'clip-two')],
        };
        const previousStateValue = structuredClone(previousState);
        const preparationFailure = new Error('automation UUID failed');
        mocks.state.value = previousState;
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('11111111-0000-4000-8000-000000000000')
            .mockImplementationOnce(() => {
                throw preparationFailure;
            });

        expect(() =>
            duplicate([
                { sourceClipId: 'clip-one', targetClipId: 'target-one', targetTrackId: 'track-target' },
                { sourceClipId: 'clip-two', targetClipId: 'target-two', targetTrackId: 'track-target' },
            ])
        ).toThrow(preparationFailure);

        expect(mocks.set).not.toHaveBeenCalled();
        expect(mocks.state.value).toBe(previousState);
        expect(mocks.state.value).toEqual(previousStateValue);
    });

    it('scopes write-then-throw compensation without erasing newer owner state', () => {
        const previousState: AutomationStoreState = { lanes: [createLane('lane-source', 'clip-source')] };
        const mutationFailure = new Error('automation owner mutation failed');
        const intervening = createLane('lane-intervening', 'clip-intervening');
        let replacement: AutomationLane | undefined;
        mocks.state.value = previousState;
        mocks.set
            .mockImplementationOnce((nextState) => {
                const generated = nextState.lanes.at(-1);
                if (!generated) {
                    throw new Error('Expected generated automation lane');
                }
                replacement = { ...generated };
                mocks.state.value = { lanes: [...nextState.lanes, replacement, intervening] };
                throw mutationFailure;
            })
            .mockImplementationOnce((nextState) => {
                mocks.state.value = nextState;
            });

        expect(() =>
            duplicate([{ sourceClipId: 'clip-source', targetClipId: 'clip-target', targetTrackId: 'track-target' }])
        ).toThrow(mutationFailure);

        expect(mocks.set).toHaveBeenCalledTimes(2);
        expect(replacement).toBeDefined();
        // The replacement carries a committed lane's id, so the id-matched
        // rollback removes it together with the batch; only the newer owner
        // state the batch never created survives.
        expect(mocks.state.value.lanes).toEqual([...previousState.lanes, intervening]);
        expect(mocks.state.value.lanes[1]).toBe(intervening);
    });
});
