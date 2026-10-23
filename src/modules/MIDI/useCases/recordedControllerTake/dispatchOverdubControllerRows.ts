import { logger } from '#/infra/logger/appLogger';
import { executeAppAction } from '#/modules/Command/useCases';
import { type OverdubControllerRowsSnapshot } from '#/utils/handlerContract';

/**
 * Land the rows an overdub pass recorded as ONE undoable action, so Undo
 * removes the pass's controllers and bends together and Redo puts the same rows
 * back. A pass with no rows dispatches nothing and adds no history entry.
 *
 * A refused or failed dispatch is logged and dropped rather than thrown: the
 * caller is the transport stop, and a controller fault must not cost the
 * musician the notes of the take.
 */
export async function dispatchOverdubControllerRows(clips: readonly OverdubControllerRowsSnapshot[]): Promise<void> {
    if (clips.length === 0) {
        return;
    }
    try {
        await executeAppAction({ type: 'appendOverdubControllers', payload: { clips } });
    } catch (error: unknown) {
        logger.warn('[MIDI] Recording the overdub controllers failed:', error);
    }
}
