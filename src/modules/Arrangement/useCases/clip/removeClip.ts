import { midiStore } from '#/modules/MIDI/stores';

import { mapAllTracks } from '../../repositories/track/mapAllTracks';

export function removeClip(clipId: string): void {
    mapAllTracks((time) => ({ ...time, clips: time.clips.filter((context) => context.id !== clipId) }));

    // Clean up MIDI data keyed by the removed clip to prevent orphaned entries.
    const ms = midiStore.value;
    if (ms) {
        const { [clipId]: _notes, ...restNotes } = ms.notesByClipId;
        const { [clipId]: _cc, ...restCc } = ms.ccByClipId;
        const { [clipId]: _pb, ...restPb } = ms.pitchBendByClipId;
        if (_notes || _cc || _pb) {
            midiStore.set({ ...ms, notesByClipId: restNotes, ccByClipId: restCc, pitchBendByClipId: restPb });
        }
    }
}
