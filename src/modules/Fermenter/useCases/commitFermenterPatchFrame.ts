import { executeAppActionBatch } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type prepareFermenterPatchWrite } from './prepareFermenterPatchWrite';

type PreparedWrite = NonNullable<ReturnType<typeof prepareFermenterPatchWrite>>;

/** One atomic frame keeps independent devices from invalidating each other's revision fence. */
export async function commitFermenterPatchFrame(writes: readonly PreparedWrite[]): Promise<void> {
    const current = (): boolean => writes.every((write) => write.isCurrent());
    try {
        if (!current()) {
            for (const write of writes) {
                write.reconcileRefusal();
            }
            return;
        }
        const actions = writes.map((write) => write.action());
        const result = await executeAppActionBatch(actions, {
            skipUndo: true,
            skipMacroRecording: true,
            shouldExecute: current,
            onCommitted: (committed) => {
                for (const [index, action] of actions.entries()) {
                    if (committed.includes(action)) {
                        writes[index]!.markCommitted();
                    }
                }
            },
        });
        for (const write of writes) {
            write.settle();
        }
        if (result.status === 'failed' || result.status === 'rejected' || result.status === 'ambiguous') {
            notifyUser(result.reason, 'error');
        } else if (result.status === 'committed-with-warning' || result.status === 'executed-with-warning') {
            notifyUser(result.warning, 'warning');
        }
    } catch (error) {
        for (const write of writes) {
            write.reconcileRefusal();
        }
        notifyUser(error instanceof Error ? error.message : 'Fermenter patch change failed', 'error');
    } finally {
        for (const write of writes) {
            write.release();
        }
    }
}
