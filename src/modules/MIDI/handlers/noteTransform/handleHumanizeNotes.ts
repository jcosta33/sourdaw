import { createHandler } from '#/utils/createHandler';

import { humanizeNotes } from '../../useCases/midiNoteTransforms/humanizeNotes';

export const handleHumanizeNotes = createHandler<'humanizeNotes'>({
    execute: (action) => {
        // Capture the RNG seed into the action payload on first execute so the
        // same action object — which executeAppAction stores in the undo entry
        // and replays verbatim on redo — reproduces identical timing/velocity
        // offsets. On replay `payload.seed` is already set, so undo→redo is a
        // no-op on the randomness: the notes land exactly where they did the
        // first time (inventory item #2).
        const usedSeed = humanizeNotes(
            action.payload.clipId,
            action.payload.amount,
            action.payload.velocityAmount,
            action.payload.seed
        );
        action.payload.seed = usedSeed;
    },
    describe: () => ({ label: 'Humanize notes' }),
    undoable: true,
});
