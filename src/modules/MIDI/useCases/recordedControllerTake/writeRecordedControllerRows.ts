import { logger } from '#/infra/logger/appLogger';

import { type MidiCC, type MidiPitchBend } from '../../models/MidiNote';

import { appendRecordedMidiControllers } from './appendRecordedMidiControllers';

type WriteRecordedControllerRowsInput = {
    clipId: string;
    cc: readonly MidiCC[];
    pitchBend: readonly MidiPitchBend[];
};

/**
 * Land a take's rows in its clip. A failed write is logged and dropped rather
 * than thrown: the callers sit on the recording commit and the transport stop,
 * and a controller fault must not cost the musician the notes of the take.
 */
export function writeRecordedControllerRows(input: WriteRecordedControllerRowsInput): void {
    try {
        appendRecordedMidiControllers(input);
    } catch (error: unknown) {
        logger.warn('[MIDI] Writing the recorded controllers failed:', error);
    }
}
