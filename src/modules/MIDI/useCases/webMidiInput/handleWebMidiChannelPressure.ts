import { applyNoteExpression } from '#/modules/AudioEngine/useCases';

import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { setMemberExpression } from '../../repositories/webMidi/memberExpressionState';
import { recordPendingMemberExpression } from '../../repositories/webMidi/pendingMemberAdmission';
import { activeNotes, channelToNote } from '../../repositories/webMidi/state';

import { recordHeldNoteExpression } from './recordHeldNoteExpression';
import { resolveInputDispatchFrame } from './resolveInputDispatchFrame';
import { resolveInputEventTime, type CapturedInputEventTime } from './resolveInputEventTime';

export function handleWebMidiChannelPressure(
    channel: number,
    pressure: number,
    timeStamp?: number | CapturedInputEventTime
): void {
    if (!getMpeEnabled() || channel < 1) {
        return;
    }

    setMemberExpression(channel, { pressure });
    const eventTime = resolveInputEventTime({ timeStamp });
    recordPendingMemberExpression(channel, { dimension: 'pressure', value: pressure, eventTime });

    const noteForChannel = channelToNote.get(channel);
    if (noteForChannel === undefined) {
        return;
    }

    const noteData = activeNotes.get(noteForChannel);
    if (noteData) {
        recordHeldNoteExpression(noteData, { dimension: 'pressure', value: pressure, eventTime });
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
            sampleFrame: resolveInputDispatchFrame({ eventTime }),
        });
    }
}
