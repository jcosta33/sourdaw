type ContractModule = typeof import('./evidenceContract');

const contractModulePath = './evidenceContract.ts';
const { evidenceManifestSource } = (await import(contractModulePath)) as ContractModule;

const frozenBytes = `${JSON.stringify(evidenceManifestSource)}\n`;

export function validateEvidenceManifest(source: string): string[] {
    if (!source.endsWith('\n') || source.includes('\r') || source.startsWith('\uFEFF')) {
        return ['manifest must use UTF-8, LF, and one terminal newline'];
    }
    try {
        const parsed: unknown = JSON.parse(source);
        if (`${JSON.stringify(parsed)}\n` !== source) {
            return ['manifest must use canonical generated JSON bytes'];
        }
    } catch {
        return ['manifest is not valid JSON'];
    }
    if (source !== frozenBytes) {
        return ['manifest differs from the frozen evidence contract'];
    }
    return [];
}
