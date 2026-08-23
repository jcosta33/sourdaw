import { LEASE_OWNER_INDEX, LEASE_STORE, type LeaseRecord } from './durableAssetIndexedDb';
import { createDurableAssetRecordAccess } from './durableAssetRecordAccess';

const records = createDurableAssetRecordAccess();

// Terminal receipts make retries idempotent across ordinary restarts. They are
// not project reachability: after this declared horizon (or the per-owner
// bound) an ancient retry fails closed as unknown, while the owned blob is
// retained until a future authoritative project-deletion integration exists.
const TERMINAL_LEASE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TERMINAL_LEASES_PER_OWNER = 4096;

async function compactTerminalLeaseReceipts(ownerId: string): Promise<void> {
    const database = await records.openDurableAssetDatabase();
    const transaction = database.transaction(LEASE_STORE, 'readwrite');
    const completion = records.awaitTransaction(transaction);
    const store = transaction.objectStore(LEASE_STORE);
    const values = await records.readIndexedValues(store, LEASE_OWNER_INDEX, ownerId);
    if (values.some((value) => !records.isLeaseRecord(value))) {
        transaction.abort();
        await completion.catch(() => undefined);
        throw new Error(`Collaboration staging receipts are corrupt: ${ownerId}`);
    }
    const terminal = (values as LeaseRecord[])
        .filter((lease) => lease.state !== 'staged')
        .sort((left, right) => (right.terminalAt ?? 0) - (left.terminalAt ?? 0));
    const cutoff = Date.now() - TERMINAL_LEASE_RETENTION_MS;
    const removable = terminal.filter(
        (lease, index) => index >= MAX_TERMINAL_LEASES_PER_OWNER || (lease.terminalAt ?? 0) < cutoff
    );
    for (const lease of removable) {
        store.delete(lease.leaseId);
    }
    await completion;
}

/** Own the bounded, blob-independent retention policy for terminal lease receipts. */
export function createDurableAssetReceiptRetention() {
    return { compactTerminalLeaseReceipts };
}
