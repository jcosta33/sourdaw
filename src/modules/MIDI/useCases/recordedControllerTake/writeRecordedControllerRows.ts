import { logger } from '#/infra/logger/appLogger';

import { type MidiCC, type MidiPitchBend } from '../../models/MidiNote';

import { appendRecordedMidiControllers } from './appendRecordedMidiControllers';

type WriteRecordedControllerRowsInput = {
    clipId: string;
    cc: readonly MidiCC[];
    pitchBend: readonly MidiPitchBend[];
};

/**
 * Land a committing take's rows in its clip, inside the commit's transaction. A
 * failed write is logged and dropped rather than thrown: a controller fault must
 * not cost the musician the notes of the take. An overdub pass lands through
 * `landOverdubPass` instead, as its own undoable action.
 */
export function writeRecordedControllerRows(input: WriteRecordedControllerRowsInput): void {
    try {
        appendRecordedMidiControllers(input);
    } catch (error: unknown) {
        logger.warn('[MIDI] Writing the recorded controllers failed:', error);
    }
}
