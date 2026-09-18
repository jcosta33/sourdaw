import { change, from, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, takeLaneStore } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { setActiveYeastDevice, yeastStore } from '#/modules/Yeast/stores';
import { type AppAction } from '#/utils/handlerContract';

import { clearHandlerRegistry, getHandlerMap, registerHandlerMap } from '../../stores/handlerRegistry';
import { getCommandHandler } from '../getCommandHandler';

// #2881 — undo step-over advances onto a unit only when every member's inverse
// resolves to a handler flagged `canReportConflict`. The flag is a declared
// capability, so it owes proof. This spec seeds the FULL production handler set
// — every map bootstrap registers, so a flag added anywhere in the product is
// visible to the enumeration, not only in the modules a partial seeding names —
// and then demands two things. First, the flagged set is exactly the action
// types the fixtures below cover: the expectation is derived from the fixture
// array, so a flag without a diverged fixture is unrepresentable and reds. A
// handler routed through `toHandlerExecutionResult` (`no-write | written`) can
// never refuse and must never carry the flag. Second, each fixture's `execute`
// genuinely refuses — returns `{ status: 'conflict' }` — against the diverged
// live state it constructs. Mechanical adoption over the remaining
// conflict-capable handlers is owned by a follow-up issue; extending the set
// means extending the fixtures, not weakening them.

/** One refusal proof: the action whose `expected*` guard diverges from the
 *  seeded live state. `title` names the row; `actionType` is the handler whose
 *  flag this row proves — several rows may prove one handler (per-field
 *  guards). */
type DivergedFixture = {
    readonly title: string;
    readonly actionType: string;
    readonly divergedAction: AppAction;
};

const CONFLICT_CAPABLE_FIXTURES: readonly DivergedFixture[] = [
    {
        title: 'restoreLoopRegion refuses to write against a collaborator loop edit',
        actionType: 'restoreLoopRegion',
        divergedAction: {
            type: 'restoreLoopRegion',
            payload: {
                expected: { loopStart: 0, loopEnd: 4, isLooping: true },
                replacement: { loopStart: 0, loopEnd: 0, isLooping: false },
            },
        },
    },
    {
        // Live selection is take-a in [2,4); the captured forward guard expects take-b.
        title: 'setCompRegion refuses to write against a diverged interval',
        actionType: 'setCompRegion',
        divergedAction: {
            type: 'setCompRegion',
            payload: {
                laneId: 'lane-live',
                trackId: 'track-comp',
                startBeat: 2,
                endBeat: 4,
                takeId: 'take-b',
                expected: [{ startBeat: 2, endBeat: 4, takeId: 'take-b' }],
                replacement: [{ startBeat: 2, endBeat: 4, takeId: 'take-b' }],
            },
        },
    },
    {
        // Live selection is take-a in [2,4); the captured replay guard expects take-b.
        title: 'restoreCompRegionInterval refuses to write against a diverged interval',
        actionType: 'restoreCompRegionInterval',
        divergedAction: {
            type: 'restoreCompRegionInterval',
            payload: {
                laneId: 'lane-live',
                trackId: 'track-comp',
                startBeat: 2,
                endBeat: 4,
                expected: [{ startBeat: 2, endBeat: 4, takeId: 'take-b' }],
                replacement: [{ startBeat: 2, endBeat: 4, takeId: 'take-a' }],
            },
        },
    },
    {
        // Live track muted=false; the guard expects muted=true.
        title: 'muteTrack refuses to write against a diverged document',
        actionType: 'muteTrack',
        divergedAction: { type: 'muteTrack', payload: { trackId: 'track-live', muted: true, expectedMuted: true } },
    },
    {
        // Live clip color '#ff0000'; the guard expects '#0000ff'.
        title: 'setClipColor refuses to write against a diverged document',
        actionType: 'setClipColor',
        divergedAction: {
            type: 'setClipColor',
            payload: { clipId: 'clip-live', color: '#00ff00', expectedColor: '#0000ff' },
        },
    },
    {
        // fadeIn guard alone: live fadeInBeats=0, the guard expects 4, and the
        // fadeOut guard is left out so only the fadeIn disjunct can refuse.
        title: 'setClipFade refuses to write when only the fadeIn guard diverges',
        actionType: 'setClipFade',
        divergedAction: {
            type: 'setClipFade',
            payload: { clipId: 'clip-live', fadeInBeats: 1, fadeOutBeats: 0, expectedFadeInBeats: 4 },
        },
    },
    {
        // fadeOut guard alone: live fadeOutBeats=0, the guard expects 4, and
        // the fadeIn guard is left out so only the fadeOut disjunct can refuse.
        title: 'setClipFade refuses to write when only the fadeOut guard diverges',
        actionType: 'setClipFade',
        divergedAction: {
            type: 'setClipFade',
            payload: { clipId: 'clip-live', fadeInBeats: 0, fadeOutBeats: 1, expectedFadeOutBeats: 4 },
        },
    },
    {
        // Live lane selects 'take-live'; the guard expects 'take-elsewhere'.
        title: 'selectTake refuses to write against a diverged document',
        actionType: 'selectTake',
        divergedAction: {
            type: 'selectTake',
            payload: { trackId: 'track-live', takeId: 'take-live', expectedSelectedTakeId: 'take-elsewhere' },
        },
    },
    {
        // Live track gain is the model default (0.8, `models/Track.ts`); the
        // guard expects 0.5. If that default ever moved to 0.5 the divergence
        // would vanish and this row would red — the reliance is pinned.
        title: 'setTrackGain refuses to write against a diverged document',
        actionType: 'setTrackGain',
        divergedAction: { type: 'setTrackGain', payload: { trackId: 'track-live', gain: 0.5, expectedGain: 0.5 } },
    },
    {
        // Live Yeast processor 'yeast-live' carries gate 0.8; the guard expects 0.5.
        title: 'setYeastProcessorParam refuses to write against a diverged document',
        actionType: 'setYeastProcessorParam',
        divergedAction: {
            type: 'setYeastProcessorParam',
            payload: { processorId: 'yeast-live', paramId: 'gate', value: 0.4, expectedValue: 0.5 },
        },
    },
    {
        // Live Yeast arpeggiator decodes to the default 8-step pattern; the
        // guard expects an edited single-step pattern.
        title: 'setYeastArpPattern refuses to write against a diverged document',
        actionType: 'setYeastArpPattern',
        divergedAction: {
            type: 'setYeastArpPattern',
            payload: {
                processorId: 'yeast-arp',
                steps: [
                    {
                        active: true,
                        stepType: 'note',
                        noteSelector: { type: 'next' },
                        velocity: 64,
                        velocityOverride: true,
                        gateMul: 1,
                        octaveOffset: 0,
                        semitoneOffset: 0,
                        probability: 1,
                        ratchet: 1,
                    },
                ],
                expectedSteps: [
                    {
                        active: true,
                        stepType: 'note',
                        noteSelector: { type: 'next' },
                        velocity: 99,
                        velocityOverride: true,
                        gateMul: 1,
                        octaveOffset: 0,
                        semitoneOffset: 0,
                        probability: 1,
                        ratchet: 1,
                    },
                ],
            },
        },
    },
    {
        // Live Yeast processor 'yeast-live' is bypassed=false; the guard expects true.
        title: 'setYeastProcessorBypass refuses to write against a diverged document',
        actionType: 'setYeastProcessorBypass',
        divergedAction: {
            type: 'setYeastProcessorBypass',
            payload: { processorId: 'yeast-live', bypassed: false, expectedBypassed: true },
        },
    },
    {
        // The restore leg refuses when the processor is no longer absent.
        title: 'addYeastProcessor refuses a restore over a present processor',
        actionType: 'addYeastProcessor',
        divergedAction: {
            type: 'addYeastProcessor',
            payload: {
                processorId: 'yeast-live',
                type: 'filter',
                name: 'Filter',
                restore: {
                    processor: {
                        id: 'yeast-live',
                        type: 'filter',
                        name: 'Filter',
                        bypassed: false,
                        params: { gate: 0.8 },
                    },
                    atIndex: 0,
                },
            },
        },
    },
    {
        // Live processor 'yeast-live' was edited since the snapshot (name differs).
        title: 'removeYeastProcessor refuses to write against a diverged processor',
        actionType: 'removeYeastProcessor',
        divergedAction: {
            type: 'removeYeastProcessor',
            payload: {
                processorId: 'yeast-live',
                expectedProcessor: {
                    id: 'yeast-live',
                    type: 'filter',
                    name: 'Renamed elsewhere',
                    bypassed: false,
                    params: { gate: 0.8 },
                },
                expectedIndex: 0,
            },
        },
    },
    {
        // Live rack order is ['yeast-live', 'yeast-arp']; the guard expects a
        // sequence that no longer matches.
        title: 'reorderYeastProcessor refuses to write against a diverged rack order',
        actionType: 'reorderYeastProcessor',
        divergedAction: {
            type: 'reorderYeastProcessor',
            payload: { processorId: 'yeast-live', toIndex: 1, expectedOrder: ['yeast-arp', 'yeast-live'] },
        },
    },
];

/** Every action type a fixture proves — the one legal flagged set. */
const FIXTURE_PROVEN_ACTION_TYPES = [...new Set(CONFLICT_CAPABLE_FIXTURES.map((fixture) => fixture.actionType))].sort();

/** The live project state every divergence guard above is checked against. */
function seedLiveProjectState(): void {
    transportStore.set({ ...defaultTransportState, loopStart: 0, loopEnd: 8, isLooping: true });
    setTrackStoreState({
        ...defaultTrackState,
        // No `gain` here: `CreateTrackInput` does not take one, so the track is
        // seeded with the model's default gain (0.8) that the setTrackGain
        // fixture's `expectedGain` deliberately mismatches.
        tracks: [createTrack({ id: 'track-live', name: 'Live', kind: 'audio' })],
    });
    const clip = addClip({
        id: 'clip-live',
        trackId: 'track-live',
        startBeat: 0,
        endBeat: 8,
        name: 'Live clip',
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ff0000',
    });
    if (clip === null) {
        throw new Error('Expected live clip fixture');
    }
    takeLaneStore.set({
        lanes: [
            {
                id: 'lane-live',
                trackId: 'track-comp',
                takes: [
                    { id: 'take-a', clipId: 'clip-a', name: 'A', startBeat: 0, endBeat: 8, selected: true },
                    { id: 'take-b', clipId: 'clip-b', name: 'B', startBeat: 0, endBeat: 8, selected: false },
                ],
                activeCompRegions: [{ startBeat: 0, endBeat: 8, takeId: 'take-a' }],
            },
            {
                id: 'take-lane-live',
                trackId: 'track-live',
                takes: [
                    {
                        id: 'take-live',
                        clipId: 'clip-live',
                        name: 'Live take',
                        startBeat: 0,
                        endBeat: 8,
                        selected: true,
                    },
                ],
                activeCompRegions: [],
            },
        ],
    });
}

/** The live Yeast rack the divergence guards above are checked against. */
type YeastRootDocument = { yeast?: unknown };

function seedLiveYeastRack(): void {
    let document: Doc<YeastRootDocument> = from({});
    configureAutomergeStoragePort({
        getDoc: () => document,
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            document = change(document, (draft) => changeFn(draft as unknown as Record<string, unknown>));
        },
    });
    yeastStore.hydrate();
    setActiveYeastDevice('device-registry');
    yeastStore.set({
        processors: [
            { id: 'yeast-live', type: 'filter', name: 'Filter', bypassed: false, params: { gate: 0.8 } },
            { id: 'yeast-arp', type: 'arpeggiator', name: 'Arp', bypassed: false, params: {} },
        ],
        uiLevel: 3,
    });
}

function resetLiveYeastRack(): void {
    flushAutomergeStorageWrites();
    configureAutomergeStoragePort(null);
    setActiveYeastDevice(null);
}

describe('canReportConflict handler registry honesty (#2881)', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        for (const handlerMap of getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true })) {
            registerHandlerMap(handlerMap);
        }
        seedLiveProjectState();
        seedLiveYeastRack();
    });

    afterEach(() => {
        resetLiveYeastRack();
        clearHandlerRegistry();
    });

    it('flags exactly the fixture-proven set of conflict-capable handlers across the whole production registry', () => {
        const flagged = Object.entries(getHandlerMap())
            .filter(([, handler]) => handler?.canReportConflict === true)
            .map(([actionType]) => actionType)
            .sort();

        // The expectation is the fixture array itself: adding a flag anywhere
        // in the production registry reds here until a diverged fixture proves
        // it can refuse (#2881). Shrinking the fixtures means the gate wedges
        // more than the set they name.
        expect(flagged).toEqual(FIXTURE_PROVEN_ACTION_TYPES);
    });

    it.each(CONFLICT_CAPABLE_FIXTURES)('$title', async ({ divergedAction }) => {
        const handler = getCommandHandler(divergedAction);

        expect(handler?.canReportConflict).toBe(true);
        expect(await handler?.execute(divergedAction)).toEqual({ status: 'conflict' });
    });
});
