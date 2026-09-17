import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getAgentCapabilityCatalog } from '#/modules/AiRuntime/useCases';
import { getDeviceManifestProtocolContract } from '#/modules/Arrangement/useCases';

import { getAgentProtocolManifest } from '../getAgentProtocolManifest';

/** The domains the Project owner publishes discovery over, in its published order. */
const DISCOVERY_DOMAINS = ['device', 'preset', 'sample', 'asset', 'capability'];

describe('agent protocol versioning', () => {
    it('publishes every independently versioned owner contract without command replay', () => {
        const manifest = getAgentProtocolManifest();

        expect(manifest.map(({ id }) => id)).toEqual([
            'command',
            'query',
            'discovery',
            'receipt',
            'provider-protocol',
            'device-manifest',
            'production-brief',
            'transform',
            'external-adapter',
        ]);
        expect(new Set(manifest.map(({ id }) => id)).size).toBe(manifest.length);
        expect(manifest.find(({ id }) => id === 'device-manifest')).toEqual(getDeviceManifestProtocolContract());
        expect(
            manifest.find(({ id }) => id === 'device-manifest')?.operations.some(({ name }) => name === 'grand-boule')
        ).toBe(true);

        for (const contract of manifest) {
            expect(contract.owner.length).toBeGreaterThan(0);
            expect(contract.schemaVersion).toBeGreaterThan(0);
            expect(contract.capabilities.length).toBeGreaterThan(0);
            expect(contract.operations.length).toBeGreaterThan(0);
            expect(new Set(contract.operations.map(({ name }) => name)).size).toBe(contract.operations.length);
            expect(contract.operations.every(({ version }) => version.length > 0)).toBe(true);
            expect(contract.operations.every(({ availability }) => availability !== 'unknown')).toBe(true);
            expect(['migrate', 'read-only-preserve', 'reject-unsupported', 'discard-retired']).toContain(
                contract.compatibility.mode
            );
            expect(contract.compatibility.behavior.length).toBeGreaterThan(0);
            expect(contract.compatibility.canonicalProjectRequiresCommandReplay).toBe(false);
        }
    });

    it('carries the discovery contract through the manifest into the capability catalog', () => {
        const manifest = getAgentProtocolManifest();
        const discovery = manifest.find(({ id }) => id === 'discovery');
        const entries = getAgentCapabilityCatalog(manifest).entries;

        expect(discovery?.operations.map(({ name }) => name)).toEqual(DISCOVERY_DOMAINS);
        for (const domain of DISCOVERY_DOMAINS) {
            expect(entries.find((entry) => entry.id === `discovery:${domain}`)).toMatchObject({
                name: domain,
                availability: 'available',
                evidence: { surface: 'protocol-contract', owner: 'discovery', contractOwner: 'Project' },
            });
        }
    });

    it('uses the owner-published semantic query types for runtime admission', () => {
        const runtimeSource = readFileSync(
            resolve(process.cwd(), 'src/modules/Project/useCases/semanticProjectQueries.ts'),
            'utf8'
        );

        expect(runtimeSource).toContain('SEMANTIC_PROJECT_QUERY_TYPES.includes(input.type)');
        expect(runtimeSource).not.toMatch(/const QUERY_TYPES\s*=/);
    });
});
