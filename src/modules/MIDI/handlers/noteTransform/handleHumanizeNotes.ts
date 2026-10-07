import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';
import { clampVelocity } from '#/utils/midiData';
import { createSeededRandom, generateSeed } from '#/utils/SeededRandom/SeededRandom';

import { type MidiNote } from '../../models/MidiNote';
import { humanizeNotes } from '../../useCases/midiNoteTransforms/humanizeNotes';
import { getWritableMidiClipReplayGuardForBatch } from '../getWritableMidiClipReplayGuard';

import { prepareMidiNoteTransformUndo } from './prepareMidiNoteTransformUndo';

type HumanizeNotesAction = Extract<AppAction, { type: 'humanizeNotes' }>;

/**
 * The exact map the `humanizeNotes` use case applies, evaluated read-only so
 * `describe` can preview the transformed notes for the undo guard. It must
 * draw the same rng values in the same order as the use case's updater, or the
 * captured `expectedNotes` would not match what the write produced and undo
 * would refuse. The two live apart because the use case owns the write path
 * and this handler owns the dispatch contract (#4615).
 */
function previewHumanizedNotes(
    notes: readonly MidiNote[],
    amount: number,
    velocityAmount: number,
    seed: number
): MidiNote[] {
    const rng = createSeededRandom(seed);
    return notes.map((note) => ({
        ...note,
        startBeat: note.startBeat + (rng() - 0.5) * amount * 0.25,
        velocity: clampVelocity(note.velocity + Math.round((rng() - 0.5) * velocityAmount * 10)),
    }));
}

function prepareHumanizeNotes(action: HumanizeNotesAction) {
    // describe runs before execute, so the seed is minted here when absent and
    // captured into the payload — execute then draws with the same seed and
    // the previewed transform matches the write exactly.
    if (action.payload.seed === undefined) {
        action.payload.seed = generateSeed();
    }
    const seed = action.payload.seed;
    return prepareMidiNoteTransformUndo({
        clipId: action.payload.clipId,
        label: 'Humanize notes',
        transform: (notes) => {
            const velocityAmount = action.payload.velocityAmount ?? action.payload.amount;
            return previewHumanizedNotes(notes, action.payload.amount, velocityAmount, seed);
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
    describe: (action) => prepareHumanizeNotes(action).description,
    isNoop: (action) => prepareHumanizeNotes(action).isNoop,
    undoable: true,
});
