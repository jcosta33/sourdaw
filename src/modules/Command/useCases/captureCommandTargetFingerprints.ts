import {
    COMMAND_MASTER_GAIN_TARGET_ID,
    COMMAND_TEMPO_TARGET_ID,
    COMMAND_TIME_SIGNATURE_TARGET_ID,
} from './getCommandDivergenceTargetIds';

type CaptureCommandTargetFingerprintsInput = {
    document: unknown;
    targetIds: readonly string[];
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function appendFingerprint(fingerprints: Map<string, string[]>, targetId: string, fingerprint: string): void {
    const matches = fingerprints.get(targetId) ?? [];
    matches.push(fingerprint);
    fingerprints.set(targetId, matches);
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    if (isRecord(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
            .join(',')}}`;
    }
    if (value === undefined) {
        return 'null';
    }
    return JSON.stringify(value);
}

function collectTargetFingerprints(
    value: unknown,
    targetIds: ReadonlySet<string>,
    fingerprints: Map<string, string[]>,
    visited: WeakSet<object>
): void {
    if (Array.isArray(value)) {
        for (const item of value) {
            collectTargetFingerprints(item, targetIds, fingerprints, visited);
        }
        return;
    }
    if (typeof value !== 'object' || value === null || visited.has(value)) {
        return;
    }
    visited.add(value);
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string' && targetIds.has(record.id)) {
        appendFingerprint(fingerprints, record.id, stableStringify(record));
    }
    if (typeof record.id === 'string' && isRecord(record.parameterValues)) {
        for (const [parameterId, parameterValue] of Object.entries(record.parameterValues)) {
            const parameterFingerprint = stableStringify({
                deviceId: record.id,
                parameterId,
                value: parameterValue,
            });
            for (const targetIdentity of [parameterId, `${record.id}:${parameterId}`]) {
                if (targetIds.has(targetIdentity)) {
                    appendFingerprint(fingerprints, targetIdentity, parameterFingerprint);
                }
            }
        }
    }
    for (const child of Object.values(record)) {
        collectTargetFingerprints(child, targetIds, fingerprints, visited);
    }
}

export function captureCommandTargetFingerprints(
    input: CaptureCommandTargetFingerprintsInput
): Readonly<Record<string, string>> {
    const fingerprintMatches = new Map<string, string[]>();
    collectTargetFingerprints(input.document, new Set(input.targetIds), fingerprintMatches, new WeakSet<object>());
    if (isRecord(input.document) && isRecord(input.document.transport)) {
        if (input.targetIds.includes(COMMAND_MASTER_GAIN_TARGET_ID)) {
            appendFingerprint(
                fingerprintMatches,
                COMMAND_MASTER_GAIN_TARGET_ID,
                stableStringify(input.document.transport.masterGain)
            );
        }
        if (input.targetIds.includes(COMMAND_TEMPO_TARGET_ID)) {
            appendFingerprint(
                fingerprintMatches,
                COMMAND_TEMPO_TARGET_ID,
                stableStringify(input.document.transport.tempo)
            );
        }
        if (input.targetIds.includes(COMMAND_TIME_SIGNATURE_TARGET_ID)) {
            appendFingerprint(
                fingerprintMatches,
                COMMAND_TIME_SIGNATURE_TARGET_ID,
                stableStringify({
                    denominator: input.document.transport.timeSignatureDenominator,
                    numerator: input.document.transport.timeSignatureNumerator,
                })
            );
        }
    }
    return Object.fromEntries(
        [...fingerprintMatches].map(([targetId, matches]) => [targetId, JSON.stringify(matches.sort())])
    );
}
