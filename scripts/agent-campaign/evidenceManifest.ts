const COMMIT = /^[a-f0-9]{40}$/;
const FROZEN_POLICY_SHA256 = '94f87d34436dd6e9b1ac0eff3c663ff0123c3b835daaa0aeb08cfa7dbccbab42';
type JsonObject = Record<string, unknown>;

type ValidationInput = { source: string; observedCommit: string; observedDirty: boolean; releaseReady: boolean };

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function validateEvidenceManifest(input: ValidationInput): Promise<string[]> {
    if (!input.source.endsWith('\n') || input.source.includes('\r') || input.source.startsWith('\uFEFF')) {
        return ['manifest must use UTF-8, LF, and one terminal newline'];
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(input.source);
    } catch {
        return ['manifest is not valid JSON'];
    }
    if (`${JSON.stringify(parsed)}\n` !== input.source) {
        return ['manifest must use canonical generated JSON bytes'];
    }
    if (
        !COMMIT.test(input.observedCommit) ||
        typeof input.observedDirty !== 'boolean' ||
        typeof input.releaseReady !== 'boolean' ||
        !isObject(parsed)
    ) {
        return ['observed run identity or manifest root is invalid'];
    }
    const identity = parsed.identity;
    const provenance = isObject(identity) ? identity.buildProvenance : null;
    const capturedAt = isObject(provenance) ? provenance.capturedAt : null;
    const parsedTimestamp = typeof capturedAt === 'string' ? Date.parse(capturedAt) : Number.NaN;
    if (
        !isObject(identity) ||
        !isObject(provenance) ||
        input.observedDirty ||
        identity.integratedCommit !== input.observedCommit ||
        identity.dirty !== input.observedDirty ||
        provenance.prerequisiteCommit !== input.observedCommit ||
        !Number.isFinite(parsedTimestamp) ||
        new Date(parsedTimestamp).toISOString() !== capturedAt
    ) {
        return ['manifest run identity does not match the observed checkout'];
    }
    const normalized = structuredClone(parsed);
    const normalizedIdentity = normalized.identity;
    const normalizedProvenance = isObject(normalizedIdentity) ? normalizedIdentity.buildProvenance : null;
    if (!isObject(normalizedIdentity) || !isObject(normalizedProvenance)) {
        return ['manifest identity schema is invalid'];
    }
    normalizedIdentity.integratedCommit = '<observed-commit>';
    normalizedIdentity.dirty = '<observed-dirty>';
    normalizedProvenance.prerequisiteCommit = '<observed-commit>';
    normalizedProvenance.capturedAt = '<captured-at>';
    const policyBytes = new TextEncoder().encode(JSON.stringify(normalized));
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', policyBytes));
    const digest = Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== FROZEN_POLICY_SHA256) {
        return ['manifest differs from the independent frozen policy'];
    }
    if (input.releaseReady) {
        return ['mandatory WebLLM artifact closure is not release ready'];
    }
    return [];
}
