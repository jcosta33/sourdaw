import { useState } from 'react';

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
 * **Mute and solo are recorded, deliberately.** Shipping DAWs do not agree here:
 * Logic Pro puts mute and solo in the Undo History and the standing user request
 * is to get them *out* (logicprohelp.com "Remove Solo and Mute from undo
 * history?"); Ableton Live leaves solo out and the standing request is to put it
 * *in* (forum.ableton.com t=244579, "SOLO Actions should be saved to UNDO
 * HISTORY", Live 11); Pro Tools records neither and gets asked for both; REAPER
 * refuses to decide and exposes it as a preference (`undomask`). With the
 * industry split, this is not a question the mixer strip gets to answer on its
 * own — and this project has already answered it, in the one place that binds
 * every dispatcher: `handleMuteTrack`, `handleSoloTrack` and
 * `handleToggleSoloSafe` are `undoable: true`, so a mute the assistant performs
 * is on the stack today. Suppressing it here (with `skipUndo`) would make the
 * same operation behave differently depending on which surface issued it, which
 * is the exact defect being closed. If the project later decides performative
 * toggles do not belong in history, the lever is `undoable` on those handlers —
 * one place, all dispatchers — not a bypass at a call site.
 *
 * **Gain and pan settle before they commit.** `Fader` and `RotaryKnob` both emit
 * `isTransient` true for each sample under the pointer and false once for the
 * settled value. The transient half drives only the audio engine, through
 * `setTrackGain`/`setTrackPan`'s existing transient path, so the level follows
 * the fader in real time; the settled value dispatches, which is what puts one
 * Automerge transaction and one undo entry on a whole sweep.
 * `handleSetTrackGain.describe()` runs before the write, so the inverse it
 * snapshots is the value from before the gesture began rather than the
 * second-to-last pointer sample — one press of undo returns the whole move.
 * Same bridge as `setGlutenParamWithAudio`.
 *
 * Consequence worth knowing: with the transient half no longer persisting, a
 * fader ridden during playback in an automation write mode records one point per
 * gesture rather than one per pointer sample. That follows from `isTransient`'s
 * pinned contract ("skips persistence and automation when the change is
 * transient", `setTrackGain.spec.ts`) and matches what the Inspector's
 * `TrackLevelSection` already does with the same use cases.
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

    return {
        select: () => selectTrack(track.id),
        toggleMute: () => {
            void executeAppAction({
                type: 'muteTrack',
                payload: { trackId: track.id, muted: !track.muted },
            });
        },
        toggleSolo: (additive) => {
            if (additive) {
                void executeAppAction({
                    type: 'soloTrack',
                    payload: { trackId: track.id, soloed: !track.soloed },
                });
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
            void executeAppAction({ type: 'toggleSoloSafe', payload: { trackId: track.id } });
        },
        setGain: (value, isTransient = false) => {
            if (isTransient) {
                setGestureGain(value);
                setTrackGain(track.id, value, true);
                return;
            }
            setGestureGain(null);
            void executeAppAction({ type: 'setTrackGain', payload: { trackId: track.id, gain: value } });
        },
        setPan: (value, isTransient = false) => {
            if (isTransient) {
                setGesturePan(value);
                setTrackPan(track.id, value, true);
                return;
            }
            setGesturePan(null);
            void executeAppAction({ type: 'setTrackPan', payload: { trackId: track.id, pan: value } });
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
        releaseGainAutomation: () => {
            if (track.automationMode === 'touch') {
                releaseTouchAutomation(track.id, 'gain');
            }
        },
        releasePanAutomation: () => {
            if (track.automationMode === 'touch') {
                releaseTouchAutomation(track.id, 'pan');
            }
        },
        displayGain,
        displayPan,
    };
}
