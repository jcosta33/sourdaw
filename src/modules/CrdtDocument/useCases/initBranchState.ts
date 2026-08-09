import { logger } from '#/infra/logger/appLogger';

import { restoreBranchStateFromSessionBackup } from '../stores/branchStore';

/**
 * Bring `branchStore` to the state the app should start in.
 *
 * A collaboration session projects the host's branch list over the local one
 * and stashes the local list in a session backup. If the app is killed mid
 * session — a crash, a reload, a closed tab — nothing runs the teardown that
 * puts the local list back, so the backup is still there at the next boot and
 * this is what consumes it.
 *
 * The composition root owns this call. It used to be a side effect of
 * evaluating `branchStore.ts`, which meant a refused `localStorage` write threw
 * while the module was still evaluating and took every importer down with it —
 * an unbootable app on a full origin quota, with no reachable catch anywhere,
 * because the throw preceded all app code. Here a failure is a reported
 * degradation instead. See #1557.
 */
export function initBranchState(): void {
    const restored = restoreBranchStateFromSessionBackup();
    if (restored) {
        return;
    }

    // Worth an error rather than the adapter's warn: this is once per boot, it
    // is not user-provoked, and it means the branch the user left the session
    // on is only as durable as this tab. The backup survives, so the next boot
    // retries — saying nothing would make a permanent-looking loss out of a
    // recoverable one.
    logger.error(
        new Error(
            'Branch state recovered from the session backup could not be persisted; ' +
                'it is live for this session and the backup was kept for the next boot.'
        )
    );
}
