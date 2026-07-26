const COMMIT = /^[a-f0-9]{40}$/;
const CAPTURE_WINDOW_MS = 60_000;
type JsonObject = Record<string, unknown>;
export const evidencePolicyTransitions = Object.freeze([
    Object.freeze({
        policyVersion: 1,
        transitionId: 'evidence-policy-v1',
        sha256: '94f87d34436dd6e9b1ac0eff3c663ff0123c3b835daaa0aeb08cfa7dbccbab42',
        predecessorSha256: null,
        transitionReason: 'Initial normalized evidence policy',
        governingHashTransition: 'established: all governing source hashes',
    }),
    Object.freeze({
        policyVersion: 2,
        transitionId: 'evidence-policy-v2',
        sha256: '6b56bcad58cb5888d0e3366dabc2c51ecf7a0213569f46fc736e28502f2e4675',
        predecessorSha256: '94f87d34436dd6e9b1ac0eff3c663ff0123c3b835daaa0aeb08cfa7dbccbab42',
        transitionReason: 'Separate the checked policy template from observed run provenance',
        governingHashTransition: 'unchanged: no governing source hash changed',
    }),
]);
type ValidationInput = Record<
    'source' | 'policySource' | 'observedCommit' | 'observedCapturedAt' | 'observedNow',
    string
> & { observedDirty: boolean; releaseReady: boolean };
const isObject = (value: unknown): value is JsonObject =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
const canonical = (value: unknown): string => `${JSON.stringify(value)}\n`;
const keys = (value: JsonObject): string => Object.keys(value).sort().join(',');
function parseCanonical(source: string): JsonObject | null {
    if (!source.endsWith('\n') || source.includes('\r') || source.startsWith('\uFEFF')) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(source);
        return isObject(parsed) && canonical(parsed) === source ? parsed : null;
    } catch {
        return null;
    }
}
function canonicalTime(value: unknown): number {
    const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
    return Number.isFinite(parsed) && typeof value === 'string' && new Date(parsed).toISOString() === value
        ? parsed
        : Number.NaN;
}
async function sha256(source: string): Promise<string> {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)));
    return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function computeEvidencePolicyDigest(source: string): Promise<string> {
    if (!parseCanonical(source)) {
        throw new Error('policy template must use canonical generated JSON bytes');
    }
    return sha256(source);
}
export async function validateEvidencePolicy(source: string): Promise<string[]> {
    const policy = parseCanonical(source);
    if (!policy) {
        return ['policy template must use canonical generated JSON bytes'];
    }
    const chainIsValid = evidencePolicyTransitions.every(
        (transition, index) =>
            transition.policyVersion === index + 1 &&
            transition.predecessorSha256 === (evidencePolicyTransitions[index - 1]?.sha256 ?? null)
    );
    const current = evidencePolicyTransitions.at(-1);
    const invalidTransition =
        !chainIsValid ||
        !current ||
        policy.policyVersion !== current.policyVersion ||
        policy.policyTransitionId !== current.transitionId;
    if (invalidTransition) {
        return ['policy version or append-only transition chain is invalid'];
    }
    if ((await sha256(source)) !== current.sha256) {
        return ['policy differs from the versioned frozen digest'];
    }
    return [];
}
export async function validateEvidenceManifest(input: ValidationInput): Promise<string[]> {
    const policyFailure = await validateEvidencePolicy(input.policySource);
    if (policyFailure.length > 0) {
        return policyFailure;
    }
    const envelope = parseCanonical(input.source);
    if (
        !envelope ||
        keys(envelope) !== 'envelopeVersion,policy,run' ||
        envelope.envelopeVersion !== 1 ||
        !isObject(envelope.policy) ||
        !isObject(envelope.run)
    ) {
        return ['checked policy template is not a run envelope'];
    }
    if (canonical(envelope.policy) !== input.policySource) {
        return ['run envelope policy differs from the checked template'];
    }
    const invalidIdentity =
        !COMMIT.test(input.observedCommit) ||
        typeof input.observedDirty !== 'boolean' ||
        typeof input.releaseReady !== 'boolean' ||
        input.observedDirty;
    const provenance = envelope.run.buildProvenance;
    const runMismatch =
        !isObject(provenance) ||
        keys(envelope.run) !== 'buildProvenance,dirty,integratedCommit' ||
        keys(provenance) !== 'capturedAt,kind,prerequisiteCommit' ||
        provenance.kind !== 'local' ||
        envelope.run.integratedCommit !== input.observedCommit ||
        envelope.run.dirty !== input.observedDirty ||
        provenance.prerequisiteCommit !== input.observedCommit;
    if (invalidIdentity || runMismatch) {
        return ['run envelope does not match the observed checkout'];
    }
    const captureTime = canonicalTime(input.observedCapturedAt);
    const now = canonicalTime(input.observedNow);
    const invalidCapture =
        provenance.capturedAt !== input.observedCapturedAt ||
        !Number.isFinite(captureTime) ||
        !Number.isFinite(now) ||
        now - captureTime < 0 ||
        now - captureTime > CAPTURE_WINDOW_MS;
    if (invalidCapture) {
        return [`run capture must be current within the ${CAPTURE_WINDOW_MS}ms execution window`];
    }
    if (input.releaseReady) {
        return ['mandatory WebLLM artifact closure is not release ready'];
    }
    return [];
}
