import { logger } from '#/infra/logger/appLogger';
import { executeAppAction } from '#/modules/Command/useCases';
import { type OverdubControllerRowsSnapshot } from '#/utils/handlerContract';

import { recordedControllerTakeState } from '../../repositories/webMidi/recordedControllerTakeState';

/**
 * Land the rows an overdub pass recorded as ONE undoable action, so Undo
 * removes the pass's controllers and bends together and Redo puts the same rows
 * back. A pass with no rows dispatches nothing and adds no history entry.
 *
 * Until the dispatch settles, its rows are registered as pending so a later pass
 * into the same clip that ends first declares its registered-parameter state
 * against them (`declareOverdubRegisteredState`), as it would had they landed.
 *
 * A refused or failed dispatch is logged and dropped rather than thrown: the
 * caller is the transport stop, and a controller fault must not cost the
 * musician the notes of the take.
 */
export async function dispatchOverdubControllerRows(clips: readonly OverdubControllerRowsSnapshot[]): Promise<void> {
    if (clips.length === 0) {
        return;
    }
    const { pendingOverdubPasses } = recordedControllerTakeState;
    pendingOverdubPasses.add(clips);
    try {
        await executeAppAction({ type: 'appendOverdubControllers', payload: { clips } });
    } catch (error: unknown) {
        logger.warn('[MIDI] Recording the overdub controllers failed:', error);
    } finally {
        pendingOverdubPasses.delete(clips);
    }
}
