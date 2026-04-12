import { createHandler } from '#/utils/createHandler';
import { midiStore } from '#/modules/MIDI/stores';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { removeClip } from '../../useCases/clip/removeClip';
import { planRippleDelete } from '../../useCases/rippleDelete/planRippleDelete';
import { rippleDeleteClips } from '../../useCases/rippleDelete/rippleDeleteClips';

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
    execute: (a) => {
        const state = getTrackStoreState();
        let trackId: string | null = null;
        if (state) {
            for (const track of state.tracks) {
                if (track.clips.some((c) => c.id === a.payload.clipId)) {
                    trackId = track.id;
                    break;
                }
            }
        }
        if (!trackId) {
            removeClip(a.payload.clipId);
            cleanupMidiData(a.payload.clipId);
            return;
        }
        const rippleResult = rippleDeleteClips({ trackId, clipIds: [a.payload.clipId] });
        if (!rippleResult) {
            removeClip(a.payload.clipId);
            cleanupMidiData(a.payload.clipId);
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
    describe: (a) => {
        const state = getTrackStoreState();
        let clipSnapshot: unknown = null;
        let trackId: string | null = null;
        if (state) {
            for (const track of state.tracks) {
                const clip = track.clips.find((c) => c.id === a.payload.clipId);
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

        const plan = planRippleDelete({ trackId, clipIds: [a.payload.clipId] });
        const ripplePlan = plan
            ? {
                  removedClips: structuredClone(plan.removedClips) as unknown[],
                  shiftedClips: structuredClone(plan.shiftedClips) as unknown[],
              }
            : null;

        const midiState = midiStore.value;
        const notes = midiState?.notesByClipId[a.payload.clipId];
        const cc = midiState?.ccByClipId[a.payload.clipId];
        const pb = midiState?.pitchBendByClipId[a.payload.clipId];

        return {
            label: 'Remove clip',
            inverseAction: {
                type: 'restoreClip',
                payload: {
                    clipId: a.payload.clipId,
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
