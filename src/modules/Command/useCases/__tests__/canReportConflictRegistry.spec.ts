import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultTrackState } from '#/modules/Arrangement/stores';
import { addClip, createTrack, getArrangementHandlers, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { getDrumPreviewBranchHandlers } from '#/modules/CrdtDocument/useCases';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { clearHandlerRegistry, getHandlerMap, registerHandlerMap } from '../../stores/handlerRegistry';
import { getCommandHandler } from '../getCommandHandler';

// #2881 — undo step-over advances onto a unit only when every member's inverse
// resolves to a handler flagged `canReportConflict`. The flag is a declared
// capability, so it owes proof: this spec enumerates the flagged set out of the
// live registry and refuses to let it grow silently, and each flagged handler
// must genuinely refuse to write — `execute` returning `{ status: 'conflict' }`
// — against a diverged fixture constructed for it. A handler routed through
// `toHandlerExecutionResult` (`no-write | written`) can never refuse and must
// never carry the flag. Mechanical adoption over the remaining conflict-capable
// handlers is owned by a follow-up issue; extending this list means extending
// the fixtures below, not weakening them.

/** One flagged handler's proof: the action whose `expected*` guard diverges from the seeded live state. */
type DivergedFixture = {
    readonly actionType: string;
    readonly divergedAction: AppAction;
};

const CONFLICT_CAPABLE_FIXTURES: readonly DivergedFixture[] = [
    {
        // Live track muted=false; the guard expects muted=true.
        actionType: 'muteTrack',
        divergedAction: { type: 'muteTrack', payload: { trackId: 'track-live', muted: true, expectedMuted: true } },
    },
    {
        // Live clip color '#ff0000'; the guard expects '#0000ff'.
        actionType: 'setClipColor',
        divergedAction: {
            type: 'setClipColor',
            payload: { clipId: 'clip-live', color: '#00ff00', expectedColor: '#0000ff' },
        },
    },
    {
        // Live clip fadeInBeats=0; the guard expects 4.
        actionType: 'setClipFade',
        divergedAction: {
            type: 'setClipFade',
            payload: { clipId: 'clip-live', fadeInBeats: 1, fadeOutBeats: 1, expectedFadeInBeats: 4 },
        },
    },
    {
        // Live track gain 0.8; the guard expects 0.5.
        actionType: 'setTrackGain',
        divergedAction: { type: 'setTrackGain', payload: { trackId: 'track-live', gain: 0.5, expectedGain: 0.5 } },
    },
];

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
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getAudioRenderingHandlers());
        registerHandlerMap(getAutomationHandlers());
        registerHandlerMap(getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }));
        registerHandlerMap(getMidiNoteTransformHandlers());
        registerHandlerMap(getTransportHandlers());
        seedLiveProjectState();
    });

    afterEach(() => {
        clearHandlerRegistry();
    });

    it('flags exactly the verified first set of conflict-capable handlers', () => {
        const flagged = Object.entries(getHandlerMap())
            .filter(([, handler]) => handler?.canReportConflict === true)
            .map(([actionType]) => actionType)
            .sort();

        // Growing this list is a deliberate act: every addition must arrive
        // with a diverged fixture proving the new handler can refuse, and with
        // undo step-over in mind (#2881). Shrinkage means the gate wedges more
        // than the set above.
        expect(flagged).toEqual(['muteTrack', 'setClipColor', 'setClipFade', 'setTrackGain']);
    });

    it.each(CONFLICT_CAPABLE_FIXTURES)(
        '$actionType refuses to write against a diverged document',
        ({ divergedAction }) => {
            const handler = getCommandHandler(divergedAction);

            expect(handler?.canReportConflict).toBe(true);
            expect(handler?.execute(divergedAction)).toEqual({ status: 'conflict' });
        }
    );
});
