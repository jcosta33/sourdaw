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

type RecoveryReceipt = RecoveryReceiptBase & {
    version: 2;
    adoptedOwnerOid: string;
};

const RECOVERY_RECEIPT_KEYS = [
    'version',
    'operation',
    'number',
    'ownerOid',
    'adoptedOwnerOid',
    'head',
    'payloadDigest',
    'outcome',
];

export function recoveryReceipt(
    number: number,
    ownerOid: string,
    adoptedOwnerOid: string,
    head: string,
    payloadDigest: string,
    outcome: 'absent' | 'landed'
): RecoveryReceipt {
    return {
        version: 2,
        operation: 'review-publication-recovery',
        number,
        ownerOid,
        adoptedOwnerOid,
        head,
        payloadDigest,
        outcome,
    };
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
        Object.keys(receipt).length === (receipt.version === 1 ? 7 : 8) &&
        Object.keys(receipt).every((key) => RECOVERY_RECEIPT_KEYS.includes(key)) &&
        (receipt.version === 1 ||
            (receipt.version === 2 &&
                typeof receipt.adoptedOwnerOid === 'string' &&
                /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(receipt.adoptedOwnerOid))) &&
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
        value.version === 2 &&
        value.adoptedOwnerOid === adoptedOwnerOid
    );
}

export function hasExactRecoveryReceipt(value: unknown, receipt: object): boolean {
    return JSON.stringify(value) === JSON.stringify(receipt);
}
