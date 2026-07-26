import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEvidencePolicy, type EvidenceRunIdentity } from '../../../scripts/agent-campaign/evidenceContract';
import {
    computeEvidencePolicyDigest,
    evidencePolicyTransitions,
    validateEvidenceManifest,
    validateEvidencePolicy,
} from '../../../scripts/agent-campaign/evidenceManifest';
import {
    generateEvidenceManifest,
    generateEvidencePolicy,
} from '../../../scripts/agent-campaign/generateEvidenceManifest';

const policySource = readFileSync(resolve(process.cwd(), 'evidence/agent-campaign/manifest.json'), 'utf8');
const observedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const capturedAt = '2026-07-26T20:00:00.000Z';
const observedNow = '2026-07-26T20:00:30.000Z';
const identity: EvidenceRunIdentity = { observedCommit, observedDirty: false, capturedAt };
const run = generateEvidenceManifest;
const source = run({ policySource, ...identity });
const dirtySource = run({ policySource, ...identity, observedDirty: true });
const forgedCaptureSource = run({ policySource, ...identity, capturedAt: '2000-01-01T00:00:00.000Z' });
const policy = createEvidencePolicy();
type Policy = ReturnType<typeof createEvidencePolicy>;
type Validation = Parameters<typeof validateEvidenceManifest>[0];
function validate(overrides: Partial<Validation> = {}): Promise<string[]> {
    const observed = { observedCommit, observedDirty: false, observedCapturedAt: capturedAt, observedNow };
    return validateEvidenceManifest({ source, policySource, releaseReady: false, ...observed, ...overrides });
}
function mutatePolicy(apply: (draft: Policy) => void): string {
    const draft = structuredClone(policy);
    apply(draft);
    return `${JSON.stringify(draft)}\n`;
}
describe('agent campaign evidence manifest', () => {
    it('checks the versioned policy, observed run envelope, and pending WebLLM release', async () => {
        expect(generateEvidencePolicy()).toBe(policySource);
        await expect(validateEvidencePolicy(policySource)).resolves.toEqual([]);
        await expect(computeEvidencePolicyDigest(policySource)).resolves.toBe(evidencePolicyTransitions.at(-1)?.sha256);
        expect(evidencePolicyTransitions.at(-1)).toMatchObject({
            policyVersion: 2,
            predecessorSha256: '94f87d34436dd6e9b1ac0eff3c663ff0123c3b835daaa0aeb08cfa7dbccbab42',
            transitionReason: 'Separate the checked policy template from observed run provenance',
            governingHashTransition: 'unchanged: no governing source hash changed',
        });
        await expect(validate()).resolves.toEqual([]);
        await expect(validate({ source: policySource })).resolves.toContain(
            'checked policy template is not a run envelope'
        );
        expect([policy.inventories.gates.entries.length, policy.inventories.results.entries.length]).toEqual([75, 88]);
        expect(() => Object.assign(policy.capabilities[0]!, { ownerTask: '' })).toThrow(TypeError);
        const missing = policy.environment.webLlmArtifactClosure.missingDigestCategories.join(',');
        expect(missing).toBe('config,tokenizer,weights,wasm');
        await expect(validate({ releaseReady: true })).resolves.not.toEqual([]);
    });
    it.each([
        ['stale head', { observedCommit: '1'.repeat(40) }],
        ['dirty checkout', { observedDirty: true, source: dirtySource }],
        ['caller-forged capture', { source: forgedCaptureSource }],
        ['unknown envelope field', { source: source.replace('{"envelopeVersion":1', '{"envelopeVersion":1,"x":0') }],
        ['stale capture', { observedNow: '2026-07-26T20:01:00.001Z' }],
        ['future capture', { observedNow: '2026-07-26T19:59:59.999Z' }],
        ['mode omission', { releaseReady: undefined }],
    ])('rejects %s', async (_name, overrides) => {
        await expect(validate(overrides)).resolves.not.toEqual([]);
    });
    it.each([
        ['gate omission', (draft: Policy) => draft.inventories.gates.entries.shift()],
        ['result pairing', (draft: Policy) => (draft.inventories.results.entries[0]!.gateOrSuiteId = 'AC-002')],
        ['owner authority', (draft: Policy) => (draft.capabilities[0]!.ownerTask = '')],
    ])('fails closed on %s policy mutation', async (_name, apply) => {
        await expect(validateEvidencePolicy(mutatePolicy(apply))).resolves.not.toEqual([]);
    });
});
