import { logger } from '#/infra/logger/appLogger';

import type { RealtimeMidiProcessor } from '../../repositories/webMidi/realtimeMidiProcessorState';

type ReleaseKeyInRemovedYeastRackInput = Readonly<{
    process: RealtimeMidiProcessor;
    context: BaseAudioContext;
    /** The device the key's note-on went through; the chain no longer holds it. */
    yeastDeviceId: string;
    instrumentTrackId: string;
    note: number;
    channel: number;
    sampleFrame: number;
    /** The instance the rack keyed the held key by at the note-on. */
    noteInstanceId: string | undefined;
}>;

/**
 * Takes a key up out of the rack of a Yeast that has left the chain.
 *
 * Removing a Yeast edits only the track store: the rack it owns survives with
 * the key still held, and an undone removal restores the same rack with an
 * unchanged projection, so nothing would ever settle that key. While the
 * worker still runs that rack, the key-up is delivered to it like any other
 * and its answer is dropped: the Yeast is no longer the musician's to hear,
 * and the voices it started are ended directly by the caller.
 *
 * The worker holds one rack, and installing another settles the one it left.
 * A rack the worker has moved on from has already lost the held key that way,
 * so the key-up is withheld rather than switching the worker back, which would
 * rebuild the rack that replaced it and cut its sounding notes.
 */
export async function releaseKeyInRemovedYeastRack(input: ReleaseKeyInRemovedYeastRackInput): Promise<void> {
    try {
        await input.process({
            context: input.context,
            rackId: input.yeastDeviceId,
            routeId: input.instrumentTrackId,
            trackId: input.instrumentTrackId,
            note: input.note,
            velocity: 0,
            channel: input.channel,
            isNoteOn: false,
            sampleTime: input.sampleFrame,
            sampleRate: input.context.sampleRate,
            noteInstanceId: input.noteInstanceId,
            onlyWhileRackCurrent: true,
        });
    } catch (error: unknown) {
        logger.warn('[MIDI] Removed Yeast key release failed:', error);
    }
}
