type ContractModule = typeof import('./evidenceContract');

const contractModulePath = './evidenceContract.ts';
const { evidenceManifestSource } = (await import(contractModulePath)) as ContractModule;

export function generateEvidenceManifest(): string {
    return `${JSON.stringify(evidenceManifestSource)}\n`;
}
