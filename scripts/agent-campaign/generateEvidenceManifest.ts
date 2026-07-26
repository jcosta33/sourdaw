import type { EvidenceRunIdentity } from './evidenceContract';

type ContractModule = typeof import('./evidenceContract');
const contractModulePath = './evidenceContract.ts';
const { createEvidencePolicy } = (await import(contractModulePath)) as ContractModule;
const canonical = (value: unknown): string => `${JSON.stringify(value)}\n`;
export const generateEvidencePolicy = (): string => canonical(createEvidencePolicy());
export function generateEvidenceManifest(input: EvidenceRunIdentity & { policySource: string }): string {
    const policy = createEvidencePolicy();
    if (input.policySource !== canonical(policy)) {
        throw new Error('policy source differs from the checked canonical template');
    }
    const buildProvenance = { kind: 'local', prerequisiteCommit: input.observedCommit, capturedAt: input.capturedAt };
    const run = { integratedCommit: input.observedCommit, dirty: input.observedDirty, buildProvenance };
    return canonical({ envelopeVersion: 1, policy, run });
}
