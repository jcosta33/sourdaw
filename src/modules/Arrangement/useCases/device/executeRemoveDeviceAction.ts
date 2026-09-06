import { executeUserAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

type RemoveDeviceDispatchResult = { status: 'applied' } | { status: 'committed-degraded' } | { status: 'not-applied' };

/** Owns every outcome from one user-triggered device removal. */
export async function executeRemoveDeviceAction(deviceId: string): Promise<RemoveDeviceDispatchResult> {
    let committed = false;
    try {
        await executeUserAppAction(
            { type: 'removeDevice', payload: { deviceId } },
            {
                onCommitted: () => {
                    committed = true;
                },
            }
        );
        return { status: committed ? 'applied' : 'not-applied' };
    } catch (error) {
        if (isAppActionCommittedError(error)) {
            notifyUser('The device was removed from the project, but completion needs attention.', 'warning');
            return { status: 'committed-degraded' };
        }
        notifyUser('The device could not be removed from the project.', 'error');
        return { status: 'not-applied' };
    }
}
