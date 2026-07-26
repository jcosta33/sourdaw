import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEvidenceManifest, type EvidenceRunIdentity } from '../../../scripts/agent-campaign/evidenceContract';
import { validateEvidenceManifest } from '../../../scripts/agent-campaign/evidenceManifest';
import { generateEvidenceManifest } from '../../../scripts/agent-campaign/generateEvidenceManifest';

const BASELINE: EvidenceRunIdentity = {
    observedCommit: '28920e9cf61367c25da2da1a092db6f720899ccc',
    observedDirty: false,
    capturedAt: '2026-07-26T18:49:17.139Z',
};
const manifestSource = readFileSync(resolve(process.cwd(), 'evidence/agent-campaign/manifest.json'), 'utf8');
const checkedManifest = createEvidenceManifest(BASELINE);
const dirtySource = generateEvidenceManifest({ ...BASELINE, observedDirty: true });
const releaseError = 'mandatory WebLLM artifact closure is not release ready';
type Manifest = ReturnType<typeof createEvidenceManifest>;
type ValidationOverrides = Partial<EvidenceRunIdentity> & { source?: string; releaseReady?: boolean };

function validate(overrides: ValidationOverrides = {}): Promise<string[]> {
    return validateEvidenceManifest({ ...BASELINE, source: manifestSource, releaseReady: false, ...overrides });
}

function mutate(apply: (draft: Manifest) => void): string {
    const draft = structuredClone(checkedManifest);
    apply(draft);
    return `${JSON.stringify(draft)}\n`;
}

describe('agent campaign evidence manifest', () => {
    it('generates complete frozen rows for the explicitly observed baseline', async () => {
        expect(generateEvidenceManifest(BASELINE)).toBe(manifestSource);
        await expect(validate()).resolves.toEqual([]);
        expect(checkedManifest.inventories.gates.entries).toHaveLength(75);
        expect(checkedManifest.inventories.results.entries).toHaveLength(88);
        for (const id of ['conflictDetection', 'lockDetection', 'reversionDetection', 'staleRevisionDetection']) {
            expect(checkedManifest.thresholds[id]).toEqual(['exact', 1]);
        }
        expect(() => Object.assign(checkedManifest.capabilities[0]!, { ownerTask: '' })).toThrow(TypeError);
        expect(createEvidenceManifest(BASELINE)).not.toBe(checkedManifest);
    });

    it('fails release admission while mandatory WebLLM lacks an immutable digest closure', async () => {
        const missing = checkedManifest.environment.webLlmArtifactClosure.missingDigestCategories.join(',');
        expect(missing).toBe('config,tokenizer,weights,wasm');
        await expect(validate({ releaseReady: true })).resolves.toContain(releaseError);
    });

    it.each([
        ['stale head', { observedCommit: '1111111111111111111111111111111111111111' }],
        ['dirty checkout', { observedDirty: true, source: dirtySource }],
        ['mode omission', { releaseReady: undefined }],
    ])('rejects %s', async (_name, identity) => {
        await expect(validate(identity)).resolves.not.toEqual([]);
    });

    it.each([
        ['provenance', (draft: Manifest) => (draft.identity.buildProvenance.prerequisiteCommit = '1'.repeat(40))],
        ['timestamp', (draft: Manifest) => (draft.identity.buildProvenance.capturedAt = 'not-an-iso-timestamp')],
        ['gate omission', (draft: Manifest) => draft.inventories.gates.entries.shift()],
        ['result pairing', (draft: Manifest) => (draft.inventories.results.entries[0]!.gateOrSuiteId = 'AC-002')],
        ['owner authority', (draft: Manifest) => (draft.capabilities[0]!.ownerTask = '')],
    ])('fails closed on %s mutation', async (_name, apply) => {
        await expect(validate({ source: mutate(apply) })).resolves.not.toEqual([]);
    });
});
