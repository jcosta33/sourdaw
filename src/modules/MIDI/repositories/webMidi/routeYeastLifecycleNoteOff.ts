import { pendingYeastRelease } from './pendingYeastRelease';

type LifecycleYeastNoteOff = {
    channel: number;
    note: number;
    /** The generated voice this off retires, when the rack carried one (#4873). */
    noteInstanceId?: string;
    /** Sample frame the worker settled the voice at, when it carried one. */
    sampleFrame?: number;
};

/**
 * Release the captured owners behind a batch of Worker lifecycle note-offs for
 * one track (#4873). Each identity resolves against the voice registry first,
 * so the ORIGINAL instrument control a generated voice was started on releases
 * even after the track's instrument changed; a same-pitch successor on the
 * replacement stays untouched.
 *
 * Returns the identityless offs no captured owner claims — the compatibility
 * leftovers the caller delivers through the current-node route, matching the
 * pre-#4873 behavior for voices that carry no instance identity. An
 * instance-keyed off with no captured owner is a repeat of an already-released
 * voice and is dropped, never routed at the current node (mirroring the drain
 * path's guard in #4870).
 */
export function releaseCapturedYeastLifecycleVoices(
    trackId: string,
    noteOffs: readonly LifecycleYeastNoteOff[]
): LifecycleYeastNoteOff[] {
    const leftovers: LifecycleYeastNoteOff[] = [];
    for (const noteOff of noteOffs) {
        const released = pendingYeastRelease.releaseLifecycleVoice({
            trackId,
            channel: noteOff.channel,
            pitch: noteOff.note,
            noteInstanceId: noteOff.noteInstanceId,
            sampleFrame: noteOff.sampleFrame,
            // Panic-style forced offs: a lifecycle retirement carries no MIDI
            // release-velocity byte, so the release dynamic is 0.
            releaseVelocity: 0,
        });
        if (!released && noteOff.noteInstanceId === undefined) {
            leftovers.push(noteOff);
        }
    }
    return leftovers;
}
