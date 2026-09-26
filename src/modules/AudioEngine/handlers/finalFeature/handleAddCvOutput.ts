import { cvGateStore } from '#/modules/CvGate/stores';
import { addCvOutput } from '#/modules/CvGate/useCases';
import { createHandler } from '#/utils/createHandler';

// AudioEngine-local shape (AGENTS.md §95 — model isolation).
type CvOutputType = 'cv-pitch' | 'cv-velocity' | 'cv-modulation' | 'gate' | 'trigger' | 'clock';

/**
 * #4615 — `executeAppAction` calls `describe()` BEFORE `execute()` to capture
 * the undo entry, and `addCvOutput` is not a stochastic operation, so both calls
 * receive the same action object. The inverse payload is minted up front in a
 * per-action WeakMap and filled in place by the write — the same pattern the
 * generation handlers use — so the recorded entry carries the written output id
 * by reference once the add lands.
 */
type AddCvOutputUndoState = { inverse: { outputId: string } };

const addCvOutputUndoStates = new WeakMap<object, AddCvOutputUndoState>();

function ensureAddCvOutputUndoState(action: object): AddCvOutputUndoState {
    const existing = addCvOutputUndoStates.get(action);
    if (existing) {
        return existing;
    }
    const state: AddCvOutputUndoState = { inverse: { outputId: '' } };
    addCvOutputUndoStates.set(action, state);
    return state;
}

export const handleAddCvOutput = createHandler<'addCvOutput'>({
    execute: (alpha) => {
        // Captured before the write: an output already occupying this channel is
        // exactly what makes the use case refuse the add, so without this guard
        // the post-write lookup would mistake that unrelated output for the new
        // one and undo would remove it.
        const preWriteChannelOccupied = cvGateStore.value?.outputs.some(
            (output) => output.outputChannel === alpha.payload.channel
        );
        addCvOutput(alpha.payload.name, alpha.payload.channel, alpha.payload.type as CvOutputType);
        // The use case enforces one output per channel, so the output now on this
        // channel is the added one iff the channel was free before and is taken
        // now. Otherwise (invalid type, duplicate channel, or no store) the use
        // case refused silently and no undo entry may be recorded.
        const addedOutput = cvGateStore.value?.outputs.find((output) => output.outputChannel === alpha.payload.channel);
        if (preWriteChannelOccupied || !addedOutput) {
            return { status: 'no-write' };
        }
        ensureAddCvOutputUndoState(alpha).inverse.outputId = addedOutput.id;
        return { status: 'written' };
    },
    describe: (alpha) => {
        const state = ensureAddCvOutputUndoState(alpha);
        return { label: 'Add CV/Gate Output', inverseAction: { type: 'removeCvOutput', payload: state.inverse } };
    },
    undoable: true,
});
