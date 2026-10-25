import { clampScheduledExpression } from './clampScheduledExpression';
import { type NoteExpressionTimeline, type ScheduledNoteExpression } from './noteExpressionTimeline';

/** The expression the voice holds: the note's own, but for the bend and its range when a channel move set them last. */
export function readNoteExpression({
    own,
    channel,
    bendOwner,
}: Pick<NoteExpressionTimeline, 'own' | 'channel' | 'bendOwner'>): ScheduledNoteExpression {
    if (bendOwner !== 'channel' || !channel) {
        return own;
    }
    return clampScheduledExpression(
        { pressure: own.pressure, slide: own.slide, pitchBend: channel.value },
        channel.rangeSemitones
    );
}
