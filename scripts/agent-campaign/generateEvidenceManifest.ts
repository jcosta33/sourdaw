import type { EvidenceRunIdentity } from './evidenceContract';

type ContractModule = typeof import('./evidenceContract');

const contractModulePath = './evidenceContract.ts';
const { createEvidenceManifest } = (await import(contractModulePath)) as ContractModule;

export function generateEvidenceManifest(identity: EvidenceRunIdentity): string {
    return `${JSON.stringify(createEvidenceManifest(identity))}\n`;
}
