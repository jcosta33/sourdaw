export const OPERATOR_ABSENT_ATTESTATION = 'operator-attested';

type RecoveryReceiptBase = {
    operation: 'review-publication-recovery';
    number: number;
    ownerOid: string;
    head: string;
    payloadDigest: string;
    outcome: 'absent' | 'landed';
};

type LegacyRecoveryReceipt = RecoveryReceiptBase & {
    version: 1;
};

type AdoptedRecoveryReceipt = RecoveryReceiptBase & {
    version: 2;
    adoptedOwnerOid: string;
};

/**
 * The operator's `--attest-absent` is the release authority for a version-3 receipt, and no field
 * of the owner journal proves it. Version 2 stays the shape of every release the journal itself
 * authorized (a prepared owner, or an attested HTTP 422), so replay never infers the attestation
 * from an older receipt that could not have recorded it.
 */
type OperatorAttestedAbsentRecoveryReceipt = RecoveryReceiptBase & {
    version: 3;
    adoptedOwnerOid: string;
    absentAttestation: typeof OPERATOR_ABSENT_ATTESTATION;
};

export type RecoveryReceipt = AdoptedRecoveryReceipt | OperatorAttestedAbsentRecoveryReceipt;

const RECOVERY_RECEIPT_KEYS = [
    'version',
    'operation',
    'number',
    'ownerOid',
    'adoptedOwnerOid',
    'head',
    'payloadDigest',
    'outcome',
    'absentAttestation',
];

function recoveryReceiptKeyCount(version: unknown): number | undefined {
    if (version === 1) {
        return 7;
    }
    if (version === 2) {
        return 8;
    }
    if (version === 3) {
        return 9;
    }
    return undefined;
}

export function recoveryReceipt(
    number: number,
    ownerOid: string,
    adoptedOwnerOid: string,
    head: string,
    payloadDigest: string,
    outcome: 'absent' | 'landed',
    absentAttestation?: typeof OPERATOR_ABSENT_ATTESTATION
): RecoveryReceipt {
    const base = {
        operation: 'review-publication-recovery' as const,
        number,
        ownerOid,
        adoptedOwnerOid,
        head,
        payloadDigest,
        outcome,
    };
    return absentAttestation === undefined ? { version: 2, ...base } : { version: 3, ...base, absentAttestation };
}

function hasAdoptedOwnerOid(receipt: Record<string, unknown>): boolean {
    return (
        typeof receipt.adoptedOwnerOid === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(receipt.adoptedOwnerOid)
    );
}

function isAdoptedReceiptShape(receipt: Record<string, unknown>): boolean {
    if (!hasAdoptedOwnerOid(receipt)) {
        return false;
    }
    if (receipt.version === 2) {
        return true;
    }
    return receipt.version === 3 && receipt.absentAttestation === OPERATOR_ABSENT_ATTESTATION;
}

export function isMatchingRecoveryReceipt(
    value: unknown,
    number: number,
    ownerOid: string
): value is LegacyRecoveryReceipt | RecoveryReceipt {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const receipt = value as Record<string, unknown>;
    return (
        Object.keys(receipt).length === recoveryReceiptKeyCount(receipt.version) &&
        Object.keys(receipt).every((key) => RECOVERY_RECEIPT_KEYS.includes(key)) &&
        (receipt.version === 1 || isAdoptedReceiptShape(receipt)) &&
        receipt.operation === 'review-publication-recovery' &&
        receipt.number === number &&
        receipt.ownerOid === ownerOid &&
        typeof receipt.head === 'string' &&
        /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(receipt.head) &&
        typeof receipt.payloadDigest === 'string' &&
        /^[0-9a-f]{64}$/u.test(receipt.payloadDigest) &&
        (receipt.outcome === 'absent' || receipt.outcome === 'landed')
    );
}

export function isReplayableAdoptedRecoveryReceipt(
    value: unknown,
    number: number,
    ownerOid: string,
    adoptedOwnerOid: string
): value is RecoveryReceipt {
    return (
        isMatchingRecoveryReceipt(value, number, ownerOid) &&
        (value.version === 2 || value.version === 3) &&
        value.adoptedOwnerOid === adoptedOwnerOid
    );
}

export function hasExactRecoveryReceipt(value: unknown, receipt: object): boolean {
    return JSON.stringify(value) === JSON.stringify(receipt);
}
