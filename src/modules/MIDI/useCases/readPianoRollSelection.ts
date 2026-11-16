import { clearPianoRollSelection } from './clearPianoRollSelection';
import { currentIdentity, pianoRollSelectionRuntime, type PianoRollSelection } from './pianoRollSelectionRuntime';

export function readPianoRollSelection(): PianoRollSelection {
    if (pianoRollSelectionRuntime.projectIdentity !== currentIdentity()) clearPianoRollSelection();
    const selection = pianoRollSelectionRuntime.selection;
    return {
        ...selection,
        clipIds: [...selection.clipIds],
        viewIds: [...selection.viewIds],
        owners: selection.owners.map((owner) => ({ ...owner })),
    };
}
