import { pendingYeastRelease } from '../../repositories/webMidi/pendingYeastRelease';

import type { ActiveNoteData } from '../../models/WebMidiTypes';

type RetireDrainOfRemovedYeastInput = Readonly<{
    noteData: ActiveNoteData;
    yeastDeviceId: string;
    /** The instrument track's devices as the track store holds them now. */
    chainDevices: readonly Readonly<{ id: string; type: string }>[] | undefined;
    /** Frame the sounding generated voices are released at. */
    sampleFrame: number;
}>;

/**
 * Whether the idle pump a note's session owns must stop because the Yeast it
 * drains has left the chain. A removed Yeast edits only the track store, so
 * the rack keeps generating and the pump keeps handing its notes back; they
 * belong to a device the musician no longer has and must not sound.
 *
 * The first call that finds the Yeast gone ends the generated voices still
 * sounding on its route, since nothing is left to send their note-offs, and
 * latches the note's session as ended so an undone removal cannot revive a
 * pump whose receiver and ownership predate it.
 */
export function retireDrainOfRemovedYeast(input: RetireDrainOfRemovedYeastInput): boolean {
    const { noteData, yeastDeviceId } = input;
    if (noteData.yeastSessionEnded === true) {
        return true;
    }
    const holdsYeast = input.chainDevices?.some((device) => device.id === yeastDeviceId && device.type === 'yeast');
    if (holdsYeast === true) {
        return false;
    }
    noteData.yeastSessionEnded = true;
    pendingYeastRelease.releaseRoute(`${noteData.instrumentTrackId}:${yeastDeviceId}`, input.sampleFrame, 0);
    return true;
}
