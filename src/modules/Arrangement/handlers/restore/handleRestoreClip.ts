import { getMidiStoreState, restoreMidiClipData } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { collectClipSplitIdentityIds } from '../../services/collectClipSplitIdentityIds';
import { clipSatelliteEntriesMatchSnapshot } from '../../stores/clipSatelliteState';
import { clipAutomationLaneTransitionMatchesStore } from '../../useCases/clip/clipAutomationLaneTransitionMatchesStore';
import { projectClipReplayPrefix } from '../../useCases/clipEditing/projectClipReplayPrefix';
import { readClipSplitIdentityIds } from '../../useCases/clipEditing/readClipSplitIdentityIds';
import { restoreTakesForClip } from '../../useCases/comping/restoreTakesForClip';
import { retiredTakeLaneOwnersMatchStore } from '../../useCases/comping/retiredTakeLaneOwnersMatchStore';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { rippleDeleteShiftStateMatchesStore } from '../../useCases/rippleDelete/rippleDeleteShiftStateMatchesStore';
import { undoRippleDelete } from '../../useCases/rippleDelete/undoRippleDelete';
import { updateTrack } from '../../useCases/updateTrack';
import { isRestoreClipSessionPayload } from '../clip/validateClipEditSessionEntries';

/**
 * Inverse-action handler for `removeClip`. Replays snapshot data carried in the
 * action payload — does not compute state itself.
 *
 * `undoable: false` — invoked only by undo machinery; must not create new undo entries.
 */

type RestoreClipAction = Extract<AppAction, { type: 'restoreClip' }>;

function clipMidiBucketsAreAbsent(clipId: string): boolean {
    const midi = getMidiStoreState();
    return (
        !midi ||
        (!Object.hasOwn(midi.notesByClipId, clipId) &&
            !Object.hasOwn(midi.ccByClipId, clipId) &&
            !Object.hasOwn(midi.pitchBendByClipId, clipId))
    );
}

function capturedMidiIdentitiesAreAvailable(
    action: RestoreClipAction,
    priorActions: readonly AppAction[] = []
): boolean {
    const capturedIds = collectClipSplitIdentityIds([
        action.payload.midiNotesSnapshot,
        action.payload.midiCcSnapshot,
        action.payload.midiPitchBendSnapshot,
    ]);
    if (capturedIds.length === 0) {
        return true;
    }
    const prefix = projectClipReplayPrefix(priorActions);
    if (!prefix) {
        return false;
    }
    const occupied = readClipSplitIdentityIds(
        prefix.lanes,
        prefix.clips.map((owner) => owner.clip)
    );
    // The committed root can lag earlier writes in this open transaction.
    // The MIDI owner's read includes those writes, as well as peer rows.
    for (const id of collectClipSplitIdentityIds(getMidiStoreState())) {
        occupied.add(id);
    }
    for (const prior of priorActions) {
        if (prior.type !== 'restoreClip') {
            continue;
        }
        // Preflight must reserve earlier restored material before any member
        // writes. Only canonical gain points belong to a clip-local namespace.
        const localGainPoints = new WeakSet<object>();
        for (const entry of prior.payload.ripplePlan?.clipSatellites ?? []) {
            for (const point of entry.gainEnvelope?.points ?? []) {
                localGainPoints.add(point);
            }
        }
        for (const id of collectClipSplitIdentityIds(prior.payload, localGainPoints)) {
            occupied.add(id);
        }
    }
    return capturedIds.every((id) => !occupied.has(id));
}

function restoreStateMatches(action: RestoreClipAction, context?: HandlerValidationContext): boolean {
    // The restore re-appends `clipSnapshot` as-is, so it assumes the owning track
    // is present and the removed clip is absent from every track. A peer may
    // recreate the same identity under another owner after removal.
    const tracks = getTrackStoreState()?.tracks ?? [];
    const priorActions = context?.actions.slice(0, context.actionIndex);
    if (
        !tracks.some((track) => track.id === action.payload.trackId) ||
        tracks.some((track) => track.clips.some((clip) => clip.id === action.payload.clipId)) ||
        !capturedMidiIdentitiesAreAvailable(action, priorActions) ||
        !retiredTakeLaneOwnersMatchStore(action.payload.retiredTakeLanes ?? [], priorActions) ||
        !rippleDeleteShiftStateMatchesStore(
            action.payload.trackId,
            action.payload.ripplePlan?.shiftedClips ?? [],
            action.payload.ripplePlan?.clipAutomationLanes ?? [],
            priorActions
        )
    ) {
        return false;
    }
    const { clipId, ripplePlan } = action.payload;
    // Removal retires these target-owned records. A later owner is a conflict,
    // even when the capture was empty; peer records under other ids stay free.
    if (!clipMidiBucketsAreAbsent(clipId)) {
        return false;
    }
    return (
        clipSatelliteEntriesMatchSnapshot([{ clipId, gainEnvelope: null, warpState: null }]) &&
        clipAutomationLaneTransitionMatchesStore([clipId], [], ripplePlan?.clipAutomationLanes ?? [])
    );
}

/**
 * Batch members of this handler must be mutually independent — no shared clip
 * target, no track removal or restore inside a clip-member batch — because
 * sequential execution after a pre-state preflight cannot otherwise see a
 * target another member consumes: a second restore of the same clip would
 * re-append a duplicate clip id, and a member that removes or restores this
 * clip's track would leave the two writes racing over one track.
 */
function batchMembersAreIndependent(action: RestoreClipAction, context: HandlerValidationContext): boolean {
    const otherMembers = context.actions.filter((_, index) => index !== context.actionIndex);
    if (otherMembers.length === 0) {
        return true;
    }
    const sharesClipTarget = otherMembers.some(
        (member) =>
            (member.type === 'removeClip' || member.type === 'restoreClip') &&
            member.payload.clipId === action.payload.clipId
    );
    if (sharesClipTarget) {
        return false;
    }
    return !otherMembers.some(
        (member) =>
            (member.type === 'removeTrack' || member.type === 'restoreTrack') &&
            member.payload.trackId === action.payload.trackId
    );
}

export const handleRestoreClip = createHandler<'restoreClip'>({
    validateSessionActionArguments: isRestoreClipSessionPayload,
    // Grouped undo replays every inverse of the gesture as one batch; this
    // preflight keeps that batch honest. Single-entry undo never calls validate.
    validate: (action, context) =>
        isRestoreClipSessionPayload(action.payload) &&
        restoreStateMatches(action, context) &&
        batchMembersAreIndependent(action, context),
    execute: (alpha) => {
        if (!isRestoreClipSessionPayload(alpha.payload) || !restoreStateMatches(alpha)) {
            return { status: 'conflict' };
        }
        const {
            clipId,
            trackId,
            clipSnapshot,
            ripplePlan,
            midiNotesSnapshot,
            midiCcSnapshot,
            midiPitchBendSnapshot,
            retiredTakeLanes,
        } = alpha.payload;

        if (ripplePlan) {
            undoRippleDelete({
                trackId,
                removedClips: ripplePlan.removedClips,
                shiftedClips: ripplePlan.shiftedClips,
                clipSatellites: ripplePlan.clipSatellites,
                clipAutomationLanes: ripplePlan.clipAutomationLanes,
                retiredTakeLanes,
            });
        } else {
            updateTrack(trackId, (time) => ({ ...time, clips: [...time.clips, clipSnapshot] }));
            restoreTakesForClip(retiredTakeLanes ?? []);
        }

        restoreMidiClipData({
            clipId,
            notesSnapshot: midiNotesSnapshot,
            controlChangeSnapshot: midiCcSnapshot,
            pitchBendSnapshot: midiPitchBendSnapshot,
        });
        return { status: 'written' };
    },
    describe: () => ({ label: 'Restore clip' }),
    undoable: false,
});
