import { type ActionHandler, type HandlerDescribeResult } from '#/utils/handlerContract';

export type CommandRecovery = 'inverse' | 'compensable' | 'irreversible';

type CommandRecoveryHandler = Pick<ActionHandler, 'prepareAbort' | 'undoable'>;

/**
 * What undoing one command would cost: a declared inverse an undoable handler can replay,
 * an inverse or abort compensation that only approximates it, or nothing at all.
 */
export function classifyCommandRecovery(
    handler: CommandRecoveryHandler,
    description: HandlerDescribeResult
): CommandRecovery {
    if (description.inverseAction && handler.undoable) {
        return 'inverse';
    }
    if (description.inverseAction || handler.prepareAbort) {
        return 'compensable';
    }
    return 'irreversible';
}
