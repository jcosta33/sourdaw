import { useState } from 'react';

import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';
import {
    soloTrackExclusive,
    toggleInputMonitoring,
    selectTrack,
    setTrackGain,
    setTrackPan,
    toggleVcaMembership,
    createAndAssignVcaGroup,
    removeFromVca,
} from '#/modules/Arrangement/useCases';
import { releaseTouchAutomation } from '#/modules/Automation/useCases';
import { executeAppAction } from '#/modules/Command/useCases';
import { confirmUser } from '#/utils/Notification/confirmUser';

import { type Track } from '../../models/TrackViewTypes';

/**
 * Dispatch options for the strip's performative toggles — see the note on
 * `useChannelStripActions`. The write still runs inside its Automerge
 * transaction; only the claim on the shared, capped action history is declined.
 */
const PERFORMATIVE_TOGGLE = { skipUndo: true } as const;

export type ChannelStripActions = {
    select: () => void;
    toggleMute: () => void;
    toggleSolo: (additive: boolean) => void;
    toggleArm: () => void;
    toggleMonitoring: () => void;
    toggleSoloSafeFlag: () => void;
    setGain: (value: number, isTransient?: boolean) => void;
    setPan: (value: number, isTransient?: boolean) => void;
    setColor: (color: string) => void;
    rename: (name: string) => void;
    removeWithConfirm: () => void;
    toggleVca: (groupId: string) => void;
    createVcaAndAssign: () => void;
    removeFromVca: () => void;
    releaseGainAutomation: () => void;
    releasePanAutomation: () => void;
    /**
     * What the fader and the pan knob should draw. Mid-gesture this is the value
     * under the user's thumb, which project truth deliberately does not yet
     * carry; otherwise it is project truth.
     */
    displayGain: number;
    displayPan: number;
};

/**
 * Presentation facade for channel-strip controls. Binds a single `Track` to the set of
 * domain actions a channel strip can dispatch. Centralising the bindings here keeps the
 * strip component thin (one import instead of ~14) and computes toggle targets from the
 * bound track so the view does not branch on current state.
 *
 * **The strip writes through `executeAppAction`, like every other surface.** It
 * used to call the bare Arrangement use cases, which write `trackStore` outside
 * an Automerge transaction and capture nothing — so deleting a track here was
 * unrecoverable while the identical delete from the timeline context menu
 * (`TrackContextMenu.tsx`) or the track list (`TrackListView.tsx`) was one undo
 * press away, and the strip's own confirm dialog said so out loud. The handlers
 * needed nothing: `handleRemoveTrack` already snapshots clips, devices, routing,
 * automation, MIDI and takes for its `restoreTrack` inverse, and mute, solo,
 * solo-safe, rename and colour all already had `undoable: true` handlers. This
 * was only ever a routing change at the call sites. Arming already dispatched,
 * which is why the file was inconsistent with itself.
 *
 * **Mute, solo and solo-safe from the buttons are not recorded, deliberately.**
 * Shipping DAWs do not agree: Logic Pro puts mute and solo in the Undo History
 * and the standing user request is to get them *out* (logicprohelp.com "Remove
 * Solo and Mute from undo history?"); Ableton Live leaves solo out and the
 * standing request is to put it *in* (forum.ableton.com t=244579, Live 11); Pro
 * Tools records neither and gets asked for both; REAPER refuses to decide and
 * exposes it as a preference (`undomask`). An industry split settles nothing, so
 * the deciding fact has to be a local one — and it is `actionHistoryStore`.
 *
 * That store is not a local scratchpad. It is `createAutomergeStorage('root',
 * 'actionHistory')` — a slot of the *synced* root document, shared with every
 * peer, capped at `MAX_HISTORY` 200 and evicting oldest first, with each
 * eviction revoking the replay capability for the entry that vanished. So a
 * toggle recorded here does not cost this user a slot in their own undo stack;
 * it costs *every collaborator* a slot in a shared, capped one. A mixing pass
 * measured at 7 entries, 6 of them toggles, fills a 50-entry history panel in
 * about seven passes and pushes real structural edits over the eviction edge.
 * Live and Pro Tools leaving these out reads differently once the resource is
 * shared: it is not taste, it is the right default.
 *
 * The lever is `skipUndo` at this call site rather than `undoable: false` on the
 * three handlers, and the difference is the point. A hand on the M button during
 * a mix is a *performance*; the assistant muting twelve tracks, or the command
 * list issuing the same action, is an *edit*, and an edit must stay reversible.
 * Turning the handlers off would take both. `skipUndo` declines only the history
 * claim: the write still runs inside the Automerge transaction, so it syncs,
 * persists and merges exactly as any other write, and every non-performative
 * dispatcher keeps its entry. That is the same "one canonical write path"
 * this file exists to enforce — history membership is a separate axis from it.
 *
 * **Gain and pan settle before they commit.** `Fader` and `RotaryKnob` both emit
 * `isTransient` true for each sample under the pointer and false once for the
 * settled value. The transient half drives the audio engine and the automation
 * recorder, through `setTrackGain`/`setTrackPan`'s transient path, so the level
 * follows the fader in real time and a ride performed against a rolling
 * transport still reaches its lane sample by sample; the settled value
 * dispatches, which is what puts one Automerge transaction and one undo entry on
 * a whole sweep. `handleSetTrackGain.describe()` runs before the write, so the
 * inverse it snapshots is the value from before the gesture began rather than
 * the second-to-last pointer sample — one press of undo returns the whole move.
 * Same bridge as `setGlutenParamWithAudio`.
 *
 * What is split is *persistence*, not the gesture: undo granularity and
 * automation resolution are separate questions, and answering the first must not
 * silently answer the second. See `setTrackGain` for why.
 */
export function useChannelStripActions(track: Track): ChannelStripActions {
    // Mid-gesture value, held only for the duration of a drag. Project truth is
    // not written until the gesture settles, so without this the fader would
    // freeze under the user's thumb while the audio moved — the mirror image of
    // #1550, and just as wrong.
    const [gestureGain, setGestureGain] = useState<number | null>(null);
    const [gesturePan, setGesturePan] = useState<number | null>(null);

    let displayGain = track.gain;
    if (gestureGain !== null) {
        displayGain = gestureGain;
    }
    let displayPan = track.pan;
    if (gesturePan !== null) {
        displayPan = gesturePan;
    }

    /**
     * Touch mode disarms only after the write it belongs to has landed.
     *
     * `releaseTouchAutomation` clears the lane's armed flag, and the strip also
     * calls it straight from the fader's `pointerup`. That alone is now too
     * early: the commit is a dispatch, so its own `recordAutomationValue` runs
     * *after* the synchronous release and re-arms the lane — which is precisely
     * what `releaseTouchAutomation` exists to prevent, and leaves
     * `applyAutomation` skipping the lane until transport stop. Releasing again
     * in the dispatch continuation puts the release back on the far side of the
     * write. The two calls are not redundant: the pointerup one is what
     * disarms a gesture that ends without a committed change and therefore
     * never dispatches at all.
     */
    const releaseTouch = (parameterId: 'gain' | 'pan'): void => {
        if (track.automationMode === 'touch') {
            releaseTouchAutomation(track.id, parameterId);
        }
    };

    /**
     * Put the engine back on project truth after a commit that never landed.
     *
     * The transient half of a gesture drives the engine and nothing else, so a
     * rejected commit that only restored the *display* left the strip reading
     * project truth, the project agreeing, every peer hearing project truth —
     * and this user alone hearing the abandoned value, silently, until the next
     * write to that track. `trackStore` is read here rather than the bound
     * `track` prop because a commit can fail *after* it wrote (an
     * `AppActionCommittedError` from a post-commit effect), in which case truth
     * is the new value and the prop in this closure is a render behind.
     *
     * Routed through the same use case the gesture used, so the Toaster pad
     * mirror is corrected with the strip gain rather than left on the abandoned
     * value. That also means the correction reaches the automation recorder
     * while a pass is rolling — a restatement being recorded as if it were a
     * gesture, which is the same projection-versus-gesture gap tracked against
     * `projectTrackToLiveStrip`.
     */
    const restoreEngineFromProjectTruth = (parameterId: 'gain' | 'pan'): void => {
        const committed = trackStore.value?.tracks.find((candidate) => candidate.id === track.id);
        if (parameterId === 'gain') {
            setTrackGain(track.id, committed?.gain ?? track.gain, true);
            return;
        }
        setTrackPan(track.id, committed?.pan ?? track.pan, true);
    };

    /**
     * Commit a settled gesture and hold its value on screen until the write has
     * landed.
     *
     * Handing the display straight back to `track.gain` at dispatch time showed
     * the *pre-gesture* value for as long as the action took to commit, so the
     * fader visibly snapped back to where the move started on every release.
     * Clearing in `finally` rather than on success means a rejected action also
     * returns the control to project truth instead of stranding it on a value
     * the project never took — and it is clamping-proof, which comparing the
     * committed value against `track.gain` would not be.
     */
    const commitGesture = (
        action: Parameters<typeof executeAppAction>[0],
        parameterId: 'gain' | 'pan',
        clearGesture: () => void
    ): void => {
        void (async () => {
            try {
                await executeAppAction(action);
            } catch (error) {
                // `void` on a rejecting promise is an unhandled rejection, not a
                // handled one — the `finally` below runs but nothing consumes
                // the failure, so a commit that throws took down the page's
                // rejection handler while every test around it still passed.
                logger.error(new Error(`Channel strip commit failed for action: ${action.type}`, { cause: error }));
                // Before the `finally` hands the display back: the display and
                // the engine have to arrive at project truth together, or the
                // user is looking at one value and hearing another.
                restoreEngineFromProjectTruth(parameterId);
            } finally {
                clearGesture();
                releaseTouch(parameterId);
            }
        })();
    };

    return {
        select: () => selectTrack(track.id),
        toggleMute: () => {
            void executeAppAction(
                { type: 'muteTrack', payload: { trackId: track.id, muted: !track.muted } },
                PERFORMATIVE_TOGGLE
            );
        },
        toggleSolo: (additive) => {
            if (additive) {
                void executeAppAction(
                    { type: 'soloTrack', payload: { trackId: track.id, soloed: !track.soloed } },
                    PERFORMATIVE_TOGGLE
                );
                return;
            }
            // Exclusive solo has no `AppAction`: it rewrites every track's solo
            // flag at once, and the only handler that can do that
            // (`restoreTrackSoloStates`) is an inverse-only, `undoable: false`
            // action. Giving it an action means a new handler that can compute
            // its own inverse, which is more than the routing change this file
            // is. Tracked separately; until then a plain solo click stays
            // unrecorded while a ⌘-click does not.
            soloTrackExclusive(track.id);
        },
        toggleArm: () => {
            void executeAppAction({
                type: 'armTrack',
                payload: { trackId: track.id, armed: !track.armed },
            });
        },
        toggleMonitoring: () => toggleInputMonitoring(track.id),
        toggleSoloSafeFlag: () => {
            void executeAppAction({ type: 'toggleSoloSafe', payload: { trackId: track.id } }, PERFORMATIVE_TOGGLE);
        },
        setGain: (value, isTransient = false) => {
            setGestureGain(value);
            if (isTransient) {
                setTrackGain(track.id, value, true);
                return;
            }
            commitGesture({ type: 'setTrackGain', payload: { trackId: track.id, gain: value } }, 'gain', () =>
                setGestureGain(null)
            );
        },
        setPan: (value, isTransient = false) => {
            setGesturePan(value);
            if (isTransient) {
                setTrackPan(track.id, value, true);
                return;
            }
            commitGesture({ type: 'setTrackPan', payload: { trackId: track.id, pan: value } }, 'pan', () =>
                setGesturePan(null)
            );
        },
        setColor: (color) => {
            void executeAppAction({ type: 'setTrackColor', payload: { trackId: track.id, color } });
        },
        rename: (name) => {
            void executeAppAction({ type: 'renameTrack', payload: { trackId: track.id, name } });
        },
        removeWithConfirm: () => {
            void (async () => {
                const ok = await confirmUser({
                    title: `Delete "${track.name}"?`,
                    // Says what the delete costs rather than that it is
                    // permanent, now that it is not. Same wording as the other
                    // two delete gestures, which is the point.
                    message: 'The track, its clips and its devices are removed. Undo restores them.',
                    confirmLabel: 'Delete',
                    variant: 'danger',
                });
                if (ok) {
                    void executeAppAction({ type: 'removeTrack', payload: { trackId: track.id } });
                }
            })();
        },
        toggleVca: (groupId) => toggleVcaMembership(track.id, groupId),
        createVcaAndAssign: () => createAndAssignVcaGroup(track.id),
        removeFromVca: () => removeFromVca(track.id),
        releaseGainAutomation: () => releaseTouch('gain'),
        releasePanAutomation: () => releaseTouch('pan'),
        displayGain,
        displayPan,
    };
}
