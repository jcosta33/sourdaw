import { beforeEach, describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type CompRegion } from '../../../models/TakeLane';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { compRegionInterval } from '../compRegionInterval';

const takes = ['a', 'b', 'c', 'd'].map((id) => ({
    id,
    clipId: `clip-${id}`,
    name: id.toUpperCase(),
    startBeat: 0,
    endBeat: 12,
    selected: id === 'a',
}));

function seed(regions: CompRegion[]): void {
    takeLaneStore.set({
        lanes: [{ id: 'lane-1', trackId: 'track-1', takes, activeCompRegions: regions }],
    });
}

function replace(startBeat: number, endBeat: number, takeId = 'b'): 'written' | 'no-write' | 'conflict' {
    const patch = compRegionInterval.capturePatch({ trackId: 'track-1', startBeat, endBeat, takeId });
    if (!patch) {
        throw new Error('expected a valid comp interval patch');
    }
    return compRegionInterval.applyPatch(patch);
}

function restoreTrackAction(
    takeLaneSnapshots: readonly { readonly id: string; readonly trackId: string }[]
): AppAction {
    const track = TrackDummy.create({ id: 'track-1' });
    return {
        type: 'restoreTrack',
        payload: {
            trackId: track.id,
            trackSnapshot: track,
            trackName: track.name,
            trackKind: track.kind,
            trackGain: track.gain,
            trackParentId: track.parentId,
            trackIndex: 0,
            wasSelected: true,
            routingPatches: [],
            automationLaneSnapshots: [],
            clipSatellites: [],
            midiNotesByClipId: {},
            midiCcByClipId: {},
            midiPitchBendByClipId: {},
            takeLaneSnapshots,
            sidechainRouteSnapshots: [],
            ownedModulatorSnapshots: [],
            incomingModulationMappingSnapshots: [],
        },
    };
}

describe('compRegionInterval', () => {
    beforeEach(() => {
        takeLaneStore.set({ lanes: [] });
    });

    it.each([
        {
            name: 'contained interval',
            initial: [{ startBeat: 2, endBeat: 6, takeId: 'a' }],
            startBeat: 3,
            endBeat: 5,
            expected: [
                { startBeat: 2, endBeat: 3, takeId: 'a' },
                { startBeat: 3, endBeat: 5, takeId: 'b' },
                { startBeat: 5, endBeat: 6, takeId: 'a' },
            ],
        },
        {
            name: 'left partial overlap',
            initial: [{ startBeat: 2, endBeat: 6, takeId: 'a' }],
            startBeat: 0,
            endBeat: 4,
            expected: [
                { startBeat: 0, endBeat: 4, takeId: 'b' },
                { startBeat: 4, endBeat: 6, takeId: 'a' },
            ],
        },
        {
            name: 'right partial overlap',
            initial: [{ startBeat: 2, endBeat: 6, takeId: 'a' }],
            startBeat: 4,
            endBeat: 8,
            expected: [
                { startBeat: 2, endBeat: 4, takeId: 'a' },
                { startBeat: 4, endBeat: 8, takeId: 'b' },
            ],
        },
        {
            name: 'multiple old intervals',
            initial: [
                { startBeat: 0, endBeat: 2, takeId: 'a' },
                { startBeat: 2, endBeat: 6, takeId: 'c' },
                { startBeat: 6, endBeat: 8, takeId: 'd' },
            ],
            startBeat: 1,
            endBeat: 7,
            expected: [
                { startBeat: 0, endBeat: 1, takeId: 'a' },
                { startBeat: 1, endBeat: 7, takeId: 'b' },
                { startBeat: 7, endBeat: 8, takeId: 'd' },
            ],
        },
        {
            name: 'gapped selection',
            initial: [
                { startBeat: 0, endBeat: 1, takeId: 'a' },
                { startBeat: 3, endBeat: 4, takeId: 'a' },
            ],
            startBeat: 1,
            endBeat: 2,
            expected: [
                { startBeat: 0, endBeat: 1, takeId: 'a' },
                { startBeat: 1, endBeat: 2, takeId: 'b' },
                { startBeat: 3, endBeat: 4, takeId: 'a' },
            ],
        },
        {
            name: 'same-take adjacency at both requested boundaries',
            initial: [
                { startBeat: 0, endBeat: 2, takeId: 'b' },
                { startBeat: 2, endBeat: 4, takeId: 'a' },
                { startBeat: 4, endBeat: 6, takeId: 'b' },
            ],
            startBeat: 2,
            endBeat: 4,
            expected: [{ startBeat: 0, endBeat: 6, takeId: 'b' }],
        },
    ] satisfies Array<{
        name: string;
        initial: CompRegion[];
        startBeat: number;
        endBeat: number;
        expected: CompRegion[];
    }>)('$name', ({ initial, startBeat, endBeat, expected }) => {
        seed(initial);

        expect(replace(startBeat, endBeat)).toBe('written');

        expect(takeLaneStore.value?.lanes[0]?.activeCompRegions).toEqual(expected);
        expect(
            takeLaneStore.value?.lanes[0]?.activeCompRegions.every((region) => region.startBeat < region.endBeat)
        ).toBe(true);
    });

    it('treats an exact current selection as a no-op', () => {
        seed([{ startBeat: 2, endBeat: 4, takeId: 'b' }]);

        expect(replace(2, 4)).toBe('no-write');
    });

    it('strictly rejects malformed replay snapshots', () => {
        const valid = {
            laneId: 'lane-1',
            trackId: 'track-1',
            startBeat: 2,
            endBeat: 4,
            expected: [{ startBeat: 2, endBeat: 4, takeId: 'a' }],
            replacement: [{ startBeat: 2, endBeat: 4, takeId: 'b' }],
        };

        expect(compRegionInterval.isCompleteRestorePayload(valid)).toBe(true);
        expect(compRegionInterval.isCompleteRestorePayload({ ...valid, extra: true })).toBe(false);
        expect(
            compRegionInterval.isCompleteRestorePayload({
                ...valid,
                replacement: [{ startBeat: 1, endBeat: 4, takeId: 'b' }],
            })
        ).toBe(false);
        expect(
            compRegionInterval.isCompleteRestorePayload({
                ...valid,
                replacement: [{ startBeat: 2, endBeat: 4, takeId: 'b', extra: true }],
            })
        ).toBe(false);
    });

    it('validates a comp inverse through an exact restored take lane and refuses inexact snapshots', () => {
        const restoredTakes = takes.map((take, index) => (index === 0 ? { ...take, sourceOffsetBeats: 0.5 } : take));
        const restoredLane = {
            id: 'lane-restored',
            trackId: 'track-1',
            automationLaneId: 'automation-restored',
            takes: restoredTakes,
            activeCompRegions: [
                { startBeat: 0, endBeat: 2, takeId: 'a' },
                { startBeat: 2, endBeat: 4, takeId: 'b' },
                { startBeat: 4, endBeat: 8, takeId: 'a' },
            ],
        };
        const inverse = {
            type: 'restoreCompRegionInterval',
            payload: {
                laneId: restoredLane.id,
                trackId: restoredLane.trackId,
                startBeat: 2,
                endBeat: 4,
                expected: [{ startBeat: 2, endBeat: 4, takeId: 'b' }],
                replacement: [{ startBeat: 2, endBeat: 4, takeId: 'a' }],
            },
        } satisfies AppAction;
        takeLaneStore.set({ lanes: [] });
        const context = {
            actions: [restoreTrackAction([restoredLane]), inverse],
            actionIndex: 1,
        };

        expect(compRegionInterval.patchApplies(inverse.payload, context)).toBe(true);
        const projected = compRegionInterval.projectTakeLaneStateThroughMaterializedCompPrefix({ lanes: [] }, context);
        expect(projected).toEqual({ lanes: [restoredLane] });
        expect(projected?.lanes[0]).not.toBe(restoredLane);
        expect(projected?.lanes[0]?.takes[0]).not.toBe(restoredLane.takes[0]);

        const missingLaneField = {
            id: restoredLane.id,
            trackId: restoredLane.trackId,
            automationLaneId: restoredLane.automationLaneId,
            takes: restoredLane.takes,
        };
        const invalidLanes = [
            missingLaneField,
            { ...restoredLane, unexpected: true },
            {
                ...restoredLane,
                takes: [{ ...restoredLane.takes[0], sourceOffsetBeats: -1 }, ...restoredLane.takes.slice(1)],
            },
        ];
        for (const invalidLane of invalidLanes) {
            expect(
                compRegionInterval.patchApplies(inverse.payload, {
                    actions: [restoreTrackAction([invalidLane]), inverse],
                    actionIndex: 1,
                })
            ).toBe(false);
            expect(
                compRegionInterval.projectTakeLaneStateThroughMaterializedCompPrefix(
                    { lanes: [] },
                    {
                        actions: [restoreTrackAction([invalidLane]), inverse],
                        actionIndex: 1,
                    }
                )
            ).toBeNull();
        }
    });
});
