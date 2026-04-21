import { midiStore } from '#/modules/MIDI/stores';
import { createHandler } from '#/utils/createHandler';

import { removeClip } from '../../useCases/clip/removeClip';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { planRippleDelete } from '../../useCases/rippleDelete/planRippleDelete';
import { rippleDeleteClips } from '../../useCases/rippleDelete/rippleDeleteClips';

// Minimal structural clip shape used to widen a concrete Clip into the structural
// `ClipSnapshot` carried by the `restoreClip` inverse action payload.
type MinimalClipShape = { id: string; trackId: string; startBeat: number; endBeat: number };
type MidiEntry = { readonly id: string };

function cleanupMidiData(clipId: string): void {
    const ms = midiStore.value;
    if (!ms) {
        return;
    }
    const { [clipId]: _notes, ...restNotes } = ms.notesByClipId;
    const { [clipId]: _cc, ...restCc } = ms.ccByClipId;
    const { [clipId]: _pb, ...restPb } = ms.pitchBendByClipId;
    if (_notes || _cc || _pb) {
        midiStore.set({ ...ms, notesByClipId: restNotes, ccByClipId: restCc, pitchBendByClipId: restPb });
    }
}

export const handleRemoveClip = createHandler<'removeClip'>({
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
            cleanupMidiData(alpha.payload.clipId);
            return;
        }
        const rippleResult = rippleDeleteClips({ trackId, clipIds: [alpha.payload.clipId] });
        if (!rippleResult) {
            removeClip(alpha.payload.clipId);
            cleanupMidiData(alpha.payload.clipId);
            return;
        }
        // Batch MIDI cleanup for all removed clips in a single store write
        const ms = midiStore.value;
        if (ms) {
            const notesCopy = { ...ms.notesByClipId };
            const ccCopy = { ...ms.ccByClipId };
            const pbCopy = { ...ms.pitchBendByClipId };
            let changed = false;
            for (const removed of rippleResult.removedClips) {
                if (notesCopy[removed.id] || ccCopy[removed.id] || pbCopy[removed.id]) {
                    delete notesCopy[removed.id];
                    delete ccCopy[removed.id];
                    delete pbCopy[removed.id];
                    changed = true;
                }
            }
            if (changed) {
                midiStore.set({ ...ms, notesByClipId: notesCopy, ccByClipId: ccCopy, pitchBendByClipId: pbCopy });
            }
        }
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
              }
            : null;

        const midiState = midiStore.value;
        const notes = midiState?.notesByClipId[alpha.payload.clipId];
        const cc = midiState?.ccByClipId[alpha.payload.clipId];
        const pb = midiState?.pitchBendByClipId[alpha.payload.clipId];

        return {
            label: 'Remove clip',
            inverseAction: {
                type: 'restoreClip',
                payload: {
                    clipId: alpha.payload.clipId,
                    trackId,
                    clipSnapshot,
                    ripplePlan,
                    midiNotesSnapshot: notes ? (structuredClone(notes) as readonly MidiEntry[]) : null,
                    midiCcSnapshot: cc ? (structuredClone(cc) as readonly MidiEntry[]) : null,
                    midiPitchBendSnapshot: pb ? (structuredClone(pb) as readonly MidiEntry[]) : null,
                },
            },
        };
    },
    undoable: true,
});
