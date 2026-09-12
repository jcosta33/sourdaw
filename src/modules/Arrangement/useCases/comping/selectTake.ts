import { executeUserAppAction } from '#/modules/Command/useCases';

/**
 * User intent to promote one take to its lane's active selection. Dispatches
 * the guarded `selectTake` action: undo restores only that lane's selection
 * and refuses when the lane state diverged (#4072). Conflicts surface to the
 * user as notifications.
 */
export async function selectTake(trackId: string, takeId: string): Promise<void> {
    await executeUserAppAction({ type: 'selectTake', payload: { trackId, takeId } });
}
