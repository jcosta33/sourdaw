import { restoreMidiClipSplitState } from '#/modules/MIDI/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { writeClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { applyClipAutomationLaneTransition } from '../clip/applyClipAutomationLaneTransition';
import { captureRetiredTakeLanes } from '../comping/captureRetiredTakeLanes';
import { prepareClipSplitTakeReplay } from '../comping/prepareClipSplitTakeReplay';
import { removeTakesForClips } from '../comping/removeTakesForClips';
import { restoreTakesForClip } from '../comping/restoreTakesForClip';
import { writeTakeReKeyTransitions } from '../comping/writeTakeReKeyTransitions';

import { clipSplitStateMatches } from './clipSplitStateMatches';
import { replaceClipSplitTrackState } from './replaceClipSplitTrackState';

type Input = Extract<AppAction, { type: 'restoreClipSplitState' }>['payload'];

/** Replay one prepared split atomically through each owning facet after a complete preflight. */
export function restoreClipSplitState(input: Input): boolean {
    if (!clipSplitStateMatches({ type: 'restoreClipSplitState', payload: input })) {
        return false;
    }
    const takeReplay = prepareClipSplitTakeReplay(input);
    if (!takeReplay) {
        return false;
    }
    const retiredBefore = input.replacement.rightClip ? [] : captureRetiredTakeLanes([input.rightClipId]);
    const trackRestored = replaceClipSplitTrackState(input);
    if (!trackRestored) {
        return false;
    }
    const midiRestored = restoreMidiClipSplitState({
        sourceClipId: input.clipId,
        rightClipId: input.rightClipId,
        expectedSource: input.expected.sourceMidi,
        expectedRight: input.expected.rightMidi,
        replacementSource: input.replacement.sourceMidi,
        replacementRight: input.replacement.rightMidi,
    });
    if (!midiRestored) {
        return false;
    }
    if (input.expected.clipAutomationLanes !== undefined) {
        const lanesRestored = applyClipAutomationLaneTransition(
            [input.rightClipId],
            input.expected.clipAutomationLanes,
            input.replacement.clipAutomationLanes ?? []
        );
        if (!lanesRestored) {
            return false;
        }
    }
    if (input.replacement.clipSatellites) {
        for (const entry of input.replacement.clipSatellites) {
            writeClipSatelliteEntry(entry);
        }
    }
    // Undo leg: the replacement carries no right clip, so the track restore
    // just filtered it out — retire its take lanes too, capturing them into
    // the shared payload array so the paired redo can put back a take that
    // landed on the right half after the split. Runs only after every
    // conflict-prone step passed, so a conflict retires nothing. The type is
    // `ClipStateSnapshot | null` and `prepareClipSplit` writes `null`, so the
    // discriminator is falsiness — `=== undefined` never fires on a real
    // payload, which is how the first cut of this leg silently never ran.
    if (!input.replacement.rightClip) {
        writeTakeReKeyTransitions(takeReplay, 'apply');
        const retired = removeTakesForClips([input.rightClipId]);
        const capture = input.expected.takeLanes === undefined ? retired : retiredBefore;
        input.retiredTakeLanes?.splice(0, input.retiredTakeLanes.length, ...capture);
    } else if (input.retiredTakeLanes !== undefined) {
        // Redo leg: re-splice put the right clip back; reinstate the takes
        // the undo retired from it.
        restoreTakesForClip(input.retiredTakeLanes);
        writeTakeReKeyTransitions(takeReplay, 'apply');
    } else {
        writeTakeReKeyTransitions(takeReplay, 'apply');
    }
    return true;
}
