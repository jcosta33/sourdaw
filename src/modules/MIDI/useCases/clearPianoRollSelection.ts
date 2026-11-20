import { currentIdentity, pianoRollSelectionRuntime } from './pianoRollSelectionRuntime';

export function clearPianoRollSelection(): void {
    pianoRollSelectionRuntime.projectIdentity = currentIdentity();
    pianoRollSelectionRuntime.selection = {
        clipId: null,
        clipIds: [],
        viewIds: [],
        status: 'unavailable',
        owners: [],
        token: crypto.randomUUID(),
    };
}
