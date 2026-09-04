import { type PullRequestMutationLockOwner } from './pullRequestMutationLock.ts';

type IncidentBase = {
    number: number;
    ownerOid: string;
    owner: PullRequestMutationLockOwner;
};

export type RejectedMergeIncident = IncidentBase & {
    kind: 'rejected-merge';
    rejectedHead: string;
    receiptId: number;
};

export type MissingReceiptIncident = IncidentBase & {
    kind: 'missing-receipt';
};

export type RecoveryIncident = RejectedMergeIncident | MissingReceiptIncident;

const INCIDENT_3344: RejectedMergeIncident = {
    kind: 'rejected-merge',
    number: 3344,
    ownerOid: '9f9c875746e69d6282e4233b32dfb1d07f418724',
    owner: {
        version: 1,
        pid: 1297320,
        token: 'bcf9e594-59ce-450e-a357-97a433899ce5',
    },
    rejectedHead: '8dca20782dfc174bf28ed2ad985414674e7a8180',
    receiptId: 5506507863,
};

// PR #3437's delivery died before any receipt was posted, so this incident proves the
// absence of an author-App delivery receipt instead of matching a rejected merge.
const INCIDENT_3437: MissingReceiptIncident = {
    kind: 'missing-receipt',
    number: 3437,
    ownerOid: '3ebcbf92f6a331dcd31a00b1891b522fbd170748',
    owner: {
        version: 1,
        pid: 26953,
        token: 'f515a71d-c25a-4714-b725-ef6e9b141005',
    },
};

// A parallel session's delivery crashed after the first incident's recovery, retaining a
// second lock on the same PR; same missing-receipt proof class.
const INCIDENT_3437_SECOND: MissingReceiptIncident = {
    kind: 'missing-receipt',
    number: 3437,
    ownerOid: '4d5a9fed9640e4b074b79c8a9fa3f6708ad3538e',
    owner: {
        version: 1,
        pid: 45432,
        token: '8cd2556c-c162-45d7-bc73-17a019c581b1',
    },
};

/**
 * Owners written before the lock carried a process fence cannot be proven dead from the blob alone,
 * so each retained pre-fence crash keeps the remote proof that made its recovery safe.
 */
export const legacyDeliveryLockIncidents: readonly RecoveryIncident[] = [
    INCIDENT_3344,
    INCIDENT_3437,
    INCIDENT_3437_SECOND,
];
