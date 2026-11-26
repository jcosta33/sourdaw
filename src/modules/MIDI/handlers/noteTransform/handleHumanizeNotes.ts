import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';
import { generateSeed } from '#/utils/SeededRandom/SeededRandom';

import { humanizeMidiNotes } from '../../transformers/humanizeMidiNotes';
import { humanizeNotes } from '../../useCases/midiNoteTransforms/humanizeNotes';
import { getWritableMidiClipReplayGuardForBatch } from '../getWritableMidiClipReplayGuard';

import { isMidiNoteTransformSessionEntry } from './isMidiNoteTransformSessionEntry';
import { prepareMidiNoteTransformUndo } from './prepareMidiNoteTransformUndo';

type HumanizeNotesAction = Extract<AppAction, { type: 'humanizeNotes' }>;

function prepareHumanizeNotes(action: HumanizeNotesAction, context?: HandlerValidationContext) {
    // describe runs before execute, so the seed is minted here when absent and
    // captured into the payload — execute then draws with the same seed and
    // the previewed transform matches the write exactly.
    if (action.payload.seed === undefined) {
        action.payload.seed = generateSeed();
    }
    const seed = action.payload.seed;
    return prepareMidiNoteTransformUndo({
        context,
        clipId: action.payload.clipId,
        label: 'Humanize notes',
        transform: (notes) => {
            const velocityAmount = action.payload.velocityAmount ?? action.payload.amount;
            return humanizeMidiNotes(notes, action.payload.amount, velocityAmount, seed);
        },
    });
}

export const handleHumanizeNotes = createHandler<'humanizeNotes'>({
    execute: (action) => {
        if (!getWritableMidiClipReplayGuardForBatch(action.payload.clipId)) {
            return { status: 'conflict' };
        }
        // Capture the RNG seed into the action payload on first execute so the
        // same action object — which executeAppAction stores in the undo entry
        // and replays verbatim on redo — reproduces identical timing/velocity
        // offsets. On replay `payload.seed` is already set (the prepare pass
        // mints it earlier in the same dispatch), so undo→redo is a no-op on
        // the randomness: the notes land exactly where they did the first time
        // (inventory item #2).
        const usedSeed = humanizeNotes(
            action.payload.clipId,
            action.payload.amount,
            action.payload.velocityAmount,
            action.payload.seed
        );
        action.payload.seed = usedSeed;
        return { status: 'written' };
    },
    validate: (action, context) => getWritableMidiClipReplayGuardForBatch(action.payload.clipId, context) !== null,
    describe: (action, context) => prepareHumanizeNotes(action, context).description,
    isNoop: (action) => prepareHumanizeNotes(action).isNoop,
    validateSessionEntry: (entry) => {
        const { action } = entry;
        if (action.type !== 'humanizeNotes' || action.payload.seed === undefined) {
            return false;
        }
        const { clipId, amount, velocityAmount = amount, seed } = action.payload;
        return isMidiNoteTransformSessionEntry({
            entry,
            clipId,
            transform: (notes) => humanizeMidiNotes(notes, amount, velocityAmount, seed),
        });
    },
    undoable: true,
});
