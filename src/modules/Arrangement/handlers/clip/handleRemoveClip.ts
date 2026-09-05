import { getMidiStoreState, removeMidiClipData } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { readClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { readClipScopedAutomationLanes } from '../../useCases/clip/readClipScopedAutomationLanes';
import { removeClip } from '../../useCases/clip/removeClip';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { planRippleDelete } from '../../useCases/rippleDelete/planRippleDelete';
import { rippleDeleteClips } from '../../useCases/rippleDelete/rippleDeleteClips';

// Minimal structural clip shape used to widen a concrete Clip into the structural
// `ClipSnapshot` carried by the `restoreClip` inverse action payload.
type MinimalClipShape = { id: string; trackId: string; name: string; startBeat: number; endBeat: number };

type RemoveClipAction = Extract<AppAction, { type: 'removeClip' }>;

function findOwningTrackId(clipId: string): string | undefined {
    return getTrackStoreState()?.tracks.find((track) => track.clips.some((clip) => clip.id === clipId))?.id;
}

function clipStillExists(clipId: string): boolean {
    return (getTrackStoreState()?.tracks ?? []).some((track) => track.clips.some((clip) => clip.id === clipId));
}

/**
 * Batch members of this handler must be mutually independent — no shared clip
 * target, no track removal inside a clip-member batch — because sequential
 * execution after a pre-state preflight cannot otherwise see a target another
 * member consumes: a second removeClip of the same clip would capture a second
 * restore inverse that re-appends a duplicate clip id, and a removeTrack of the
 * owning track would leave that inverse pointing at a track that no longer
 * exists, wedging the grouped undo that replays it.
 */
function batchMembersAreIndependent(action: RemoveClipAction, context: HandlerValidationContext): boolean {
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
    const owningTrackId = findOwningTrackId(action.payload.clipId);
    return (
        !owningTrackId ||
        !otherMembers.some((member) => member.type === 'removeTrack' && member.payload.trackId === owningTrackId)
    );
}

export const handleRemoveClip = createHandler<'removeClip'>({
    // Batch co-execution (grouped redo, atomic batches) preflights the state the
    // action assumes — the clip it names is still present — and refuses the whole
    // batch once a target is gone. Single-action dispatch never calls validate,
    // so the per-clip fallbacks in execute below are unchanged.
    validate: (action, context) =>
        clipStillExists(action.payload.clipId) && batchMembersAreIndependent(action, context),
    execute: (alpha) => {
        const state = getTrackStoreState();
        let trackId: string | null = null;
        if (state) {
            for (const track of state.tracks) {
                if (track.clips.some((context) => context.id === alpha.payload.clipId)) {
                    trackId = track.id;
                    break;
                }
            }
        }
        if (!trackId) {
            removeClip(alpha.payload.clipId);
            return;
        }
        const rippleResult = rippleDeleteClips({ trackId, clipIds: [alpha.payload.clipId] });
        if (rippleResult === null) {
            removeClip(alpha.payload.clipId);
            return;
        }
        removeMidiClipData(rippleResult.removedClips.map((clip) => clip.id));
    },
    describe: (alpha) => {
        const state = getTrackStoreState();
        let clipSnapshot: MinimalClipShape | null = null;
        let trackId: string | null = null;
        if (state) {
            for (const track of state.tracks) {
                const clip = track.clips.find((context) => context.id === alpha.payload.clipId);
                if (clip) {
                    clipSnapshot = structuredClone(clip);
                    trackId = track.id;
                    break;
                }
            }
        }
        if (!clipSnapshot || !trackId) {
            return { label: 'Remove clip' };
        }

        const plan = planRippleDelete({ trackId, clipIds: [alpha.payload.clipId] });
        const ripplePlan = plan
            ? {
                  removedClips: structuredClone(plan.removedClips) as readonly MinimalClipShape[],
                  shiftedClips: structuredClone(plan.shiftedClips),
                  clipSatellites: plan.removedClips
                      .map((clip) => readClipSatelliteEntry(clip.id))
                      .filter((entry) => entry.gainEnvelope !== null || entry.warpState !== null),
                  clipAutomationLanes: readClipScopedAutomationLanes(plan.removedClips.map((clip) => clip.id)),
              }
            : null;

        const midiState = getMidiStoreState();
        const notes = midiState?.notesByClipId[alpha.payload.clipId];
        const cc = midiState?.ccByClipId[alpha.payload.clipId];
        const pb = midiState?.pitchBendByClipId[alpha.payload.clipId];

        return {
            label: `Remove clip "${clipSnapshot.name}"`,
            inverseAction: {
                type: 'restoreClip',
                payload: {
                    clipId: alpha.payload.clipId,
                    trackId,
                    clipSnapshot,
                    ripplePlan,
                    midiNotesSnapshot: notes ? structuredClone(notes) : null,
                    midiCcSnapshot: cc ? structuredClone(cc) : null,
                    midiPitchBendSnapshot: pb ? structuredClone(pb) : null,
                },
            },
        };
    },
    undoable: true,
});
