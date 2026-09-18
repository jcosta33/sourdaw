import { logger } from '#/infra/logger/appLogger';

import { branchStateAuthority, type BranchStateBootOutcome } from '../repositories/branchStateAuthority';

/**
 * Bring `branchStore` to the state the app should start in.
 *
 * Two steps, because they cannot be one. Reading the durable envelope is
 * synchronous and has to happen before anything reads a branch id, so the
 * composition root gets its branch list from the first statement. Recovering a
 * collaboration session that never tore down needs the session's lifetime lock
 * to decide whether the session is live or abandoned, and Web Locks are
 * asynchronous — so that runs behind `whenBranchStateSettled`, which the first
 * project load awaits.
 *
 * Nothing here throws. This used to be a side effect of evaluating
 * `branchStore.ts`, where a refused `localStorage` write threw during module
 * evaluation and took every importer down with it — an unbootable app on a full
 * origin quota, with no reachable catch anywhere. See #1557.
 */
export function initBranchState(): void {
    if (branchStateAuthority.hydrateFromDurableState() === 'storage-unavailable') {
        logger.error(
            new Error(
                'Branch state could not be read from durable storage; the app starts on the default branch list ' +
                    'and no durable branch write will be accepted until storage recovers.'
            )
        );
    }

    void branchStateAuthority.settleBoot().then((outcome) => {
        reportBootOutcome(outcome);
    });
}

/**
 * Worth an error rather than a warn: this is once per boot, it is not
 * user-provoked, and each of these outcomes leaves the branch list in a state
 * that does not match what a clean boot would produce.
 */
function reportBootOutcome(outcome: BranchStateBootOutcome): void {
    if (outcome === 'settled' || outcome === 'restored') {
        return;
    }

    if (outcome === 'foreign-session-live') {
        // Not an error: another instance of the app is in a collaboration
        // session and owns the branch list. It is only worth saying because
        // local branch writes are refused until that session ends.
        logger.warn(
            '[CrdtDocument] Another window holds a collaboration session that owns the branch list; ' +
                'local branch changes will not persist until it ends.'
        );
        return;
    }

    if (outcome === 'lock-unavailable') {
        logger.error(
            new Error(
                'Branch state cannot be sequenced because the Web Locks API is unavailable; the branch list is ' +
                    'live for this session and no branch change will survive a reload.'
            )
        );
        return;
    }

    logger.error(
        new Error(
            'Branch state recovery could not read or write durable storage; a collaboration session backup may ' +
                'still be pending and will be retried at the next boot.'
        )
    );
}
