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
        expect(mocks.state.value.lanes).toEqual([...previousState.lanes, replacement, intervening]);
        expect(mocks.state.value.lanes[3]).toBe(replacement);
        expect(mocks.state.value.lanes[4]).toBe(intervening);
        expect(mocks.set).toHaveBeenCalledTimes(2);
        expect(() => rollback()).not.toThrow();
        expect(mocks.set).toHaveBeenCalledTimes(2);
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
        expect(mocks.state.value.lanes).toEqual([...previousState.lanes, replacement, intervening]);
        expect(mocks.state.value.lanes[1]).toBe(replacement);
        expect(mocks.state.value.lanes[2]).toBe(intervening);
    });
});
