import { applyNoteExpression } from '#/modules/AudioEngine/useCases';

import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { activeNotes, channelToNote } from '../../repositories/webMidi/state';

import { resolveInputDispatchFrame } from './resolveInputDispatchFrame';
import { resolveInputEventTime } from './resolveInputEventTime';

export function handleWebMidiChannelPressure(channel: number, pressure: number, timeStamp?: number): void {
    if (!getMpeEnabled() || channel < 1) {
        return;
    }

    const noteForChannel = channelToNote.get(channel);
    if (noteForChannel === undefined) {
        return;
    }

    const noteData = activeNotes.get(noteForChannel);
    if (noteData) {
        noteData.pressure = pressure;
        // Reach the instrument voice through the one expression surface the
        // scheduled path also uses (audit MD-2).
        applyNoteExpression({
            trackId: noteData.instrumentTrackId,
            note: noteData.note,
            channel: noteData.channel,
            expression: {
                pitchBend: noteData.pitchBend,
                pressure: noteData.pressure,
                slide: noteData.slide,
            },
            // Expression now shares the note events' serial tail (audit MD-3),
            // so it can be voiced a turn or more after it arrived. Addressing
            // its own arrival frame keeps it landing where it was performed.
            sampleFrame: resolveInputDispatchFrame({ eventTime: resolveInputEventTime({ timeStamp }) }),
        });
    }
}
