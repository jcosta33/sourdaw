import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { defaultTrackState } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';
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
        // Live track gain 0.8; the guard expects 0.5.
        title: 'setTrackGain refuses to write against a diverged document',
        actionType: 'setTrackGain',
        divergedAction: { type: 'setTrackGain', payload: { trackId: 'track-live', gain: 0.5, expectedGain: 0.5 } },
    },
];

/** Every action type a fixture proves — the one legal flagged set. */
const FIXTURE_PROVEN_ACTION_TYPES = [...new Set(CONFLICT_CAPABLE_FIXTURES.map((fixture) => fixture.actionType))].sort();

/** The live project state every divergence guard above is checked against. */
function seedLiveProjectState(): void {
    setTrackStoreState({
        ...defaultTrackState,
        tracks: [createTrack({ id: 'track-live', name: 'Live', kind: 'audio', gain: 0.8 })],
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
}

describe('canReportConflict handler registry honesty (#2881)', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        for (const handlerMap of getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true })) {
            registerHandlerMap(handlerMap);
        }
        seedLiveProjectState();
    });

    afterEach(() => {
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

    it.each(CONFLICT_CAPABLE_FIXTURES)('$title', ({ divergedAction }) => {
        const handler = getCommandHandler(divergedAction);

        expect(handler?.canReportConflict).toBe(true);
        expect(handler?.execute(divergedAction)).toEqual({ status: 'conflict' });
    });
});
