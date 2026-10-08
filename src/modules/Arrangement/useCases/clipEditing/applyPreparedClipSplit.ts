import { restoreAutomationLanes } from '#/modules/Automation/useCases';
import { splitMidiNotesAtBeat } from '#/modules/MIDI/useCases';
import { type ClipStateSnapshot } from '#/utils/handlerContract';

import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { writeClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { type Clip } from '../../stores/trackStore';
import { prepareClipSplitTakeReplay } from '../comping/prepareClipSplitTakeReplay';
import { writeTakeReKeyTransitions } from '../comping/writeTakeReKeyTransitions';

import { clipSplitStateMatches } from './clipSplitStateMatches';
import { type prepareClipSplit } from './prepareClipSplit';

type Plan = NonNullable<ReturnType<typeof prepareClipSplit>>;

function cloneClip(snapshot: ClipStateSnapshot): Clip {
    const { overrides, kneadState, ...fields } = structuredClone(snapshot);
    const clip: Clip = fields;
    if (Object.hasOwn(snapshot, 'overrides')) {
        clip.overrides = structuredClone(overrides);
    }
    if (Object.hasOwn(snapshot, 'kneadState')) {
        clip.kneadState = undefined;
        if (kneadState) {
            clip.kneadState = {
                ...kneadState,
                blobs: kneadState.blobs.map((blob) => ({
                    ...blob,
                    pitchCurveCents: [...blob.pitchCurveCents],
                })),
            };
        }
    }
    return clip;
}

/** Apply the exact owner plan captured for this execution after every facet passes preflight. */
export function applyPreparedClipSplit(plan: Plan): boolean {
    const state = getTrackState();
    if (!state || !plan.next.rightClip) {
        return false;
    }
    const input = {
        clipId: plan.previous.leftClip.id,
        rightClipId: plan.rightClipId,
        expected: plan.previous,
        replacement: plan.next,
    };
    if (!clipSplitStateMatches({ type: 'restoreClipSplitState', payload: input })) {
        return false;
    }
    const takeReplay = prepareClipSplitTakeReplay(input);
    if (!takeReplay) {
        return false;
    }
    const leftClip = cloneClip(plan.next.leftClip);
    const rightClip = cloneClip(plan.next.rightClip);
    setTrackState({
        ...state,
        tracks: state.tracks.map((track) => {
            if (track.id !== plan.next.trackId) {
                return track;
            }
            return {
                ...track,
                clips: track.clips.map((clip) => (clip.id === input.clipId ? leftClip : clip)).concat(rightClip),
            };
        }),
    });
    if (plan.next.leftClip.type === 'midi') {
        splitMidiNotesAtBeat({
            sourceClipId: input.clipId,
            newClipId: plan.rightClipId,
            splitBeat: plan.adjustedMediaSplit,
            targetNoteIds: plan.targetNoteIds,
        });
    }
    for (const entry of plan.next.clipSatellites ?? []) {
        writeClipSatelliteEntry(entry);
    }
    if (plan.next.clipAutomationLanes?.length) {
        restoreAutomationLanes(plan.next.clipAutomationLanes);
    }
    writeTakeReKeyTransitions(takeReplay, 'apply');
    return true;
}
