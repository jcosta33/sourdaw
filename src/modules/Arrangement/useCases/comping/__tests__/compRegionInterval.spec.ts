import { beforeEach, describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type CompRegion } from '../../../models/TakeLane';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { compRegionInterval } from '../compRegionInterval';

const takes = ['a', 'b', 'c', 'd'].map((id) => ({
    id,
    clipId: `clip-${id}`,
    name: id.toUpperCase(),
    startBeat: 0,
    endBeat: 12,
    selected: id === 'a',
}));

function owningTrack() {
    return TrackDummy.create({
        id: 'track-1',
        kind: 'midi',
        clips: takes.map((take) =>
            ClipDummy.create({ id: take.clipId, trackId: 'track-1', type: 'midi', startBeat: 0, endBeat: 12 })
        ),
    });
}

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
    const track = owningTrack();
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
        trackStore.set({ tracks: [owningTrack()], selectedTrackId: null });
    });

    it('refuses a source relink prefix before capturing an audio comp interval', () => {
        const track = owningTrack();
        track.kind = 'audio';
        track.clips = track.clips.map((clip) => ({ ...clip, type: 'audio', audioBufferId: 'source' }));
        trackStore.set({ tracks: [track], selectedTrackId: null });
        seed([]);
        const input = { trackId: track.id, startBeat: 2, endBeat: 4, takeId: 'b' };
        expect(
            compRegionInterval.capturePatchAfterPrefix(input, {
                actions: [{ type: 'setClipGain', payload: { clipId: 'clip-a', gain: 0.5 } }],
                actionIndex: 1,
            })
        ).not.toBeNull();
        const relink: AppAction = {
            type: 'relinkClipAudioSources',
            payload: {
                targets: [
                    {
                        trackId: track.id,
                        trackKind: track.kind,
                        activeAlternativeId: track.activeAlternativeId,
                        alternativeId: null,
                        clipId: 'clip-a',
                        before: { audioBufferId: 'source' },
                        after: { audioBufferId: 'replacement' },
                    },
                ],
            },
        };
        expect(compRegionInterval.capturePatchAfterPrefix(input, { actions: [relink], actionIndex: 1 })).toBeNull();
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
        trackStore.set({ tracks: [], selectedTrackId: null });
        const context = {
            actions: [restoreTrackAction([restoredLane]), inverse],
            actionIndex: 1,
        };

        expect(compRegionInterval.patchApplies(inverse.payload, context)).toBe(true);
        const projected = compRegionInterval.projectTakeLaneStateThroughMaterializedActionPrefix(
            { lanes: [] },
            context
        );
        expect(projected).toEqual({ lanes: [restoredLane] });
        expect(projected?.lanes[0]).not.toBe(restoredLane);
        expect(projected?.lanes[0]?.takes[0]).not.toBe(restoredLane.takes[0]);

        const duplicateLaneId = { ...restoredLane, trackId: 'track-2' };
        const duplicateSnapshotContext = {
            actions: [restoreTrackAction([restoredLane, duplicateLaneId]), inverse],
            actionIndex: 1,
        };
        expect(compRegionInterval.patchApplies(inverse.payload, duplicateSnapshotContext)).toBe(false);
        expect(
            compRegionInterval.projectTakeLaneStateThroughMaterializedActionPrefix(
                { lanes: [] },
                duplicateSnapshotContext
            )
        ).toBeNull();

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
            {
                ...restoredLane,
                activeCompRegions: [
                    { ...restoredLane.activeCompRegions[0], takeId: 'missing-take' },
                    ...restoredLane.activeCompRegions.slice(1),
                ],
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
                compRegionInterval.projectTakeLaneStateThroughMaterializedActionPrefix(
                    { lanes: [] },
                    {
                        actions: [restoreTrackAction([invalidLane]), inverse],
                        actionIndex: 1,
                    }
                )
            ).toBeNull();
        }
    });

    it('projects selection, removal, and a replacement owner in exact action order', () => {
        const initialLane = { id: 'lane-old', trackId: 'track-1', takes, activeCompRegions: [] };
        const restoredLane = {
            ...initialLane,
            id: 'lane-new',
            takes: takes.map((take) => ({ ...take, selected: take.id === 'c' })),
        };
        const actions = [
            { type: 'selectTake', payload: { trackId: 'track-1', takeId: 'b' } },
            { type: 'removeTrack', payload: { trackId: 'track-1' } },
            restoreTrackAction([restoredLane]),
        ] satisfies AppAction[];

        expect(
            compRegionInterval.projectTakeLaneStateThroughMaterializedActionPrefix(
                { lanes: [initialLane] },
                { actions, actionIndex: actions.length }
            )
        ).toEqual({ lanes: [restoredLane] });

        const staleOwnerSelection = {
            type: 'selectTake',
            payload: {
                trackId: 'track-1',
                takeId: 'a',
                expectedLaneId: initialLane.id,
                expectedSelectedTakeId: 'c',
            },
        } satisfies AppAction;
        expect(
            compRegionInterval.projectTakeLaneStateThroughMaterializedActionPrefix(
                { lanes: [initialLane] },
                { actions: [...actions, staleOwnerSelection], actionIndex: actions.length + 1 }
            )
        ).toBeNull();
    });

    it('projects a guarded null selection and refuses ambiguous restored owners', () => {
        const unselectedLane = {
            id: 'lane-1',
            trackId: 'track-1',
            takes: takes.map((take) => ({ ...take, selected: false })),
            activeCompRegions: [],
        };
        const select = { type: 'selectTake', payload: { trackId: 'track-1', takeId: 'b' } } satisfies AppAction;
        const clear = {
            type: 'selectTake',
            payload: {
                trackId: 'track-1',
                takeId: null,
                expectedLaneId: unselectedLane.id,
                expectedSelectedTakeId: 'b',
            },
        } satisfies AppAction;
        const cleared = compRegionInterval.projectTakeLaneStateThroughMaterializedActionPrefix(
            { lanes: [unselectedLane] },
            { actions: [select, clear], actionIndex: 2 }
        );

        expect(cleared?.lanes[0]?.takes.every((take) => !take.selected)).toBe(true);

        const duplicateOwner = { ...unselectedLane, id: 'lane-2' };
        expect(
            compRegionInterval.projectTakeLaneStateThroughMaterializedActionPrefix(
                { lanes: [] },
                { actions: [restoreTrackAction([unselectedLane, duplicateOwner])], actionIndex: 1 }
            )
        ).toBeNull();
    });

    it('projects a comp removal and its restoration through the validation prefix', () => {
        const region = { startBeat: 0, endBeat: 4, takeId: 'b' };
        const lane = { id: 'lane-1', trackId: 'track-1', takes, activeCompRegions: [region] };
        const patch = { laneId: lane.id, trackId: 'track-1', startBeat: 0, endBeat: 4 };
        const remove = {
            type: 'removeCompRegion',
            payload: { ...patch, expected: [region], replacement: [] },
        } satisfies AppAction;
        const restore = {
            type: 'restoreCompRegionInterval',
            payload: { ...patch, expected: [], replacement: [region] },
        } satisfies AppAction;
        const project = (actions: AppAction[], initial: typeof lane) =>
            compRegionInterval.projectTakeLaneStateThroughMaterializedActionPrefix(
                { lanes: [initial] },
                { actions, actionIndex: actions.length }
            );

        expect(project([remove], lane)?.lanes[0]?.activeCompRegions).toEqual([]);
        expect(project([remove, restore], lane)?.lanes[0]?.activeCompRegions).toEqual([region]);
        expect(project([restore], { ...lane, activeCompRegions: [] })?.lanes[0]?.activeCompRegions).toEqual([region]);
        expect(project([restore], lane)).toBeNull();
    });

    describe('refusals and fallbacks of the take-lane prefix', () => {
        const regionB = { startBeat: 0, endBeat: 4, takeId: 'b' };
        const regionC = { startBeat: 4, endBeat: 8, takeId: 'c' };
        const lane = { id: 'lane-1', trackId: 'track-1', takes, activeCompRegions: [regionB, regionC] };
        const patch = { laneId: lane.id, trackId: 'track-1', startBeat: 0, endBeat: 4 };
        const restore = {
            type: 'restoreCompRegionInterval',
            payload: { ...patch, expected: [regionB], replacement: [] },
        } satisfies AppAction;
        const note = { id: 'note-1', pitch: 60, startBeat: 0.5, duration: 1, velocity: 90 };
        const midiTake = {
            ...takes[0]!,
            midiSource: {
                sourceClipId: 'original-clip',
                sourceEntryBeat: 0,
                sourceEndBeat: 4,
                phaseHeadBeat: 0,
                passLengthBeats: 4,
                rows: {
                    notes: { present: true as const, value: [note] },
                    controlChanges: { present: true as const, value: [] },
                    pitchBends: { present: true as const, value: [] },
                },
            },
        };
        const replaceRow = (laneId: string) =>
            ({
                type: 'replaceOriginalMidiTakeRow',
                payload: {
                    copyScope: 'capture',
                    laneId,
                    takeId: 'a',
                    sourceClipId: 'original-clip',
                    rowId: note.id,
                    expectedSlotPresent: true,
                    replacementSlotPresent: true,
                    rowKind: 'note',
                    expected: note,
                    replacement: { ...note, velocity: 40 },
                },
            }) satisfies AppAction;
        const project = (initial: typeof lane, actions: AppAction[]) =>
            compRegionInterval.projectTakeLaneStateThroughMaterializedActionPrefix(
                { lanes: [initial] },
                { actions, actionIndex: actions.length }
            );

        it('leaves the lanes alone for an action name that is only inherited, read from untrusted JSON', () => {
            const parsed: AppAction = JSON.parse('{"type":"constructor","payload":{}}');

            expect(project(lane, [parsed])).toEqual({ lanes: [lane] });
        });

        it('captures the frozen row copies of a replaced original MIDI row and refuses a missing owner', () => {
            const owner = { ...lane, takes: [midiTake, ...takes.slice(1)] };
            const replaced = project(owner, [replaceRow(lane.id)]);

            expect(replaced).not.toBeNull();
            expect(project(owner, [replaceRow('missing-lane')])).toBeNull();
        });

        it('refuses a comp action whose payload is incomplete', () => {
            const incomplete = {
                type: 'setCompRegion',
                payload: { trackId: 'track-1', startBeat: 0, endBeat: 4, takeId: 'b' },
            } satisfies AppAction;

            expect(project(lane, [restore])?.lanes[0]?.activeCompRegions).toEqual([regionC]);
            expect(project(lane, [incomplete])).toBeNull();
        });

        it('refuses a comp action for a lane the state does not hold', () => {
            const foreign = { ...restore, payload: { ...restore.payload, laneId: 'foreign-lane' } };

            expect(project(lane, [foreign])).toBeNull();
        });

        it('refuses a comp action after a restored track whose snapshot is unusable', () => {
            const validRestore = restoreTrackAction([]);
            if (validRestore.type !== 'restoreTrack') {
                throw new Error('Expected a restoreTrack fixture');
            }
            const spare = TrackDummy.create({ id: 'spare', kind: 'midi' });
            validRestore.payload = { ...validRestore.payload, trackId: spare.id, trackSnapshot: spare };
            const unusable = structuredClone(validRestore);
            unusable.payload.trackSnapshot = JSON.parse('null');

            expect(project(lane, [validRestore, restore])?.lanes[0]?.activeCompRegions).toEqual([regionC]);
            expect(project(lane, [unusable, restore])).toBeNull();
        });

        it('captures a removal against the lanes an earlier prefix removal left', () => {
            seed([regionB, regionC]);
            const earlierRemoval = {
                type: 'removeCompRegion',
                payload: { trackId: 'track-1', startBeat: 0 },
            } satisfies AppAction;
            const context = { actions: [earlierRemoval], actionIndex: 1 };

            expect(
                compRegionInterval.captureRemovePatchAfterPrefix({ trackId: 'track-1', startBeat: 4 }, context)
            ).toMatchObject({ laneId: 'lane-1', startBeat: 4, endBeat: 8, expected: [regionC], replacement: [] });
            expect(
                compRegionInterval.captureRemovePatchAfterPrefix({ trackId: 'track-1', startBeat: 0 }, context)
            ).toBeNull();
        });

        it('refuses to capture a removal at a negative or non-finite start beat', () => {
            seed([regionB, regionC]);

            expect(compRegionInterval.captureRemovePatch({ trackId: 'track-1', startBeat: 0 })).not.toBeNull();
            expect(compRegionInterval.captureRemovePatch({ trackId: 'track-1', startBeat: -1 })).toBeNull();
            expect(compRegionInterval.captureRemovePatch({ trackId: 'track-1', startBeat: Number.NaN })).toBeNull();
        });

        it('judges a patch by no source clips when the track store holds no tracks', () => {
            seed([regionB, regionC]);
            const captured = compRegionInterval.captureRemovePatch({ trackId: 'track-1', startBeat: 0 });
            if (!captured) {
                throw new Error('expected a comp removal patch');
            }

            expect(compRegionInterval.patchApplies(captured)).toBe(true);
            trackStore.set(null);
            expect(compRegionInterval.patchApplies(captured)).toBe(false);
        });
    });

    describe('capturing an audio comp interval after a prefix', () => {
        const input = { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'b' };
        const setCompRegion: AppAction = { type: 'setCompRegion', payload: input };

        beforeEach(() => {
            trackStore.set({
                tracks: [
                    TrackDummy.create({
                        id: 'track-1',
                        kind: 'audio',
                        clips: takes.map((take) =>
                            ClipDummy.create({
                                id: take.clipId,
                                trackId: 'track-1',
                                type: 'audio',
                                startBeat: 0,
                                endBeat: 12,
                            })
                        ),
                    }),
                ],
                selectedTrackId: null,
            });
            seed([{ startBeat: 0, endBeat: 12, takeId: 'a' }]);
        });

        it('admits a capture with no prefix', () => {
            expect(compRegionInterval.capturePatchAfterPrefix(input, undefined)).not.toBeNull();
        });

        it.each([
            {
                name: 'editTempoMap',
                prefix: { type: 'editTempoMap', payload: { edit: { type: 'add', beat: 0, tempo: 240 } } },
            },
            {
                name: 'duplicateTimeRange',
                prefix: { type: 'duplicateTimeRange', payload: { startBeat: 0, endBeat: 4 } },
            },
            { name: 'setTempo', prefix: { type: 'setTempo', payload: { bpm: 60 } } },
        ] satisfies Array<{ name: string; prefix: AppAction }>)(
            'refuses a capture after $name rewrote the clock',
            ({ prefix }) => {
                const actions = [prefix, setCompRegion];

                expect(compRegionInterval.capturePatchAfterPrefix(input, { actions, actionIndex: 1 })).toBeNull();
            }
        );

        it('still captures after detectTempo, which only reads audio and writes no tempo', () => {
            const detectTempo: AppAction = { type: 'detectTempo', payload: { clipId: 'not-a-track-clip' } };
            const actions = [detectTempo, setCompRegion];

            expect(compRegionInterval.capturePatchAfterPrefix(input, { actions, actionIndex: 1 })).not.toBeNull();
        });
    });
});
