import { type MidiCC } from '../../models/MidiNote';
import { isCarriedBendReturnOnEditedHead } from '../../services/registeredParameterState';

/** The return rows belonging to the edited head, in their stored order. */
export function getHandEditedReturnFamily(
    rows: readonly MidiCC[],
    head: { channel: number; beat: number }
): readonly MidiCC[] {
    return rows.filter((row) => isCarriedBendReturnOnEditedHead(row, head));
}
