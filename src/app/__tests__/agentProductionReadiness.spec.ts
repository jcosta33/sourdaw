import { describe, expect, it } from 'vitest';

import { getAgentCapabilityCatalog } from '#/modules/AiRuntime/useCases';
import { getAgentCommandLedger } from '#/modules/Command/useCases';

import {
    AGENT_PRODUCTION_PHASES,
    evaluateAgentProductionReadiness,
    getAgentProductionReadiness,
} from '../getAgentProductionReadiness';
import { getAgentProtocolManifest } from '../getAgentProtocolManifest';

type ManifestFixtureContract = {
    id: string;
    owner: string;
    schemaVersion: number;
    capabilities: readonly string[];
    operations: ReadonlyArray<{ name: string; version: string; availability: string }>;
    availability: string;
    compatibility: {
        mode: 'migrate' | 'read-only-preserve' | 'reject-unsupported' | 'discard-retired';
        behavior: string;
        canonicalProjectRequiresCommandReplay: false;
    };
};

/** A manifest that satisfies every phase gate in isolation, so a mutated copy isolates one cause. */
function buildPassingManifestFixture(): ManifestFixtureContract[] {
    const availableOperation = { name: 'op', version: '1', availability: 'available' };
    // Mirrors the live `discovery` contract: one operation per published discovery domain, each of
    // which `buildPassingCatalogFixture` gives a matching `discovery:<name>` catalog entry.
    const discoveryOperations = [
        { name: 'device', version: '1', availability: 'available' },
        { name: 'preset', version: '1', availability: 'available' },
    ];
    const compatibility = {
        mode: 'reject-unsupported' as const,
        behavior: 'fixture',
        canonicalProjectRequiresCommandReplay: false as const,
    };
    return [
        {
            id: 'command',
            owner: 'Command',
            schemaVersion: 1,
            capabilities: ['atomic-batch'],
            operations: [availableOperation],
            availability: 'available',
            compatibility,
        },
        {
            id: 'query',
            owner: 'Project',
            schemaVersion: 1,
            capabilities: [],
            operations: [availableOperation],
            availability: 'available',
            compatibility,
        },
        {
            id: 'discovery',
            owner: 'Project',
            schemaVersion: 1,
            capabilities: [],
            operations: discoveryOperations,
            availability: 'available',
            compatibility,
        },
        {
            id: 'receipt',
            owner: 'Command',
            schemaVersion: 1,
            capabilities: [],
            operations: [availableOperation],
            availability: 'available',
            compatibility,
        },
        {
            id: 'production-brief',
            owner: 'Project',
            schemaVersion: 1,
            capabilities: [],
            operations: [availableOperation],
            availability: 'available',
            compatibility,
        },
        {
            id: 'transform',
            owner: 'MIDI',
            schemaVersion: 1,
            capabilities: [],
            operations: [availableOperation],
            availability: 'available',
            compatibility,
        },
        {
            id: 'external-adapter',
            owner: 'AiRuntime',
            schemaVersion: 1,
            capabilities: [],
            operations: [availableOperation],
            availability: 'available',
            compatibility,
        },
    ];
}

function buildPassingCatalogFixture(): ReturnType<typeof getAgentCapabilityCatalog> {
    return {
        version: 'fixture-v1',
        entries: [
            {
                id: 'discovery:device',
                name: 'device',
                availability: 'available',
                reason: null,
                version: '1',
                evidence: {},
            },
            {
                id: 'discovery:preset',
                name: 'preset',
                availability: 'available',
                reason: null,
                version: '1',
                evidence: {},
            },
            {
                id: 'agent.media.listen',
                name: 'agent.media.listen',
                availability: 'unavailable',
                reason: 'deferred',
                version: null,
                evidence: { callable: false },
            },
            {
                id: 'agent.media.generate',
                name: 'agent.media.generate',
                availability: 'unavailable',
                reason: 'deferred',
                version: null,
                evidence: { callable: false },
            },
            {
                id: 'agent.project.reconstruct',
                name: 'agent.project.reconstruct',
                availability: 'unavailable',
                reason: 'deferred',
                version: null,
                evidence: { callable: false },
            },
        ],
    };
}

function buildPassingLedgerFixture(): ReturnType<typeof getAgentCommandLedger> {
    return {
        schemaVersion: 1,
        entries: [
            {
                operationId: 'addTrack',
                category: 'track',
                owner: 'Arrangement',
                descriptorVersion: 1,
                packet: 'getArrangementHandlers',
                closure: 'supported',
                minimumWriteSet: true,
            },
            {
                operationId: 'renderProjectSections',
                category: 'render-freeze-export',
                owner: 'AudioRendering',
                descriptorVersion: 1,
                packet: 'getAudioRenderingHandlers',
                closure: 'supported',
                minimumWriteSet: false,
            },
        ],
        uncoveredCategories: [],
    };
}

type LedgerEntryFixture = ReturnType<typeof buildPassingLedgerFixture>['entries'][number];

/** Marks the `addTrack` entry interim-unsupported; every other entry passes through unchanged. */
function markAddTrackInterimUnsupported(entry: LedgerEntryFixture): LedgerEntryFixture {
    if (entry.operationId !== 'addTrack') {
        return entry;
    }
    return { ...entry, closure: 'interim-unsupported', packet: '#9999' };
}

describe('agent production readiness', () => {
    it('returns phases in exactly the published phase order', () => {
        const result = getAgentProductionReadiness();

        expect(result.phases.map((phase) => phase.id)).toEqual([...AGENT_PRODUCTION_PHASES]);
    });

    it('passes every phase on the live head because the discovery contract and the capability catalog agree domain-by-domain', () => {
        const result = getAgentProductionReadiness();

        // Verified against live code: `getAgentCapabilityCatalog` (AiRuntime) publishes one entry
        // per `discovery` contract operation, `id` = `discovery:${operation.name}`, `availability`
        // `'available'` (`src/app/__tests__/agentProtocolVersioning.spec.ts:51-64`). Every published
        // discovery domain therefore has a matching catalog entry, so `read-only-assistance` passes
        // and nothing cascades.
        expect(result.phases).toEqual(
            AGENT_PRODUCTION_PHASES.map((id) => ({ id, gate: 'passed', status: 'passed', blockedBy: null }))
        );
    });

    it('reports no completion claim on the live head, blocked only by the four uncovered ledger categories', () => {
        const result = getAgentProductionReadiness();

        expect(result.completionClaim).toBe(false);
        expect(result.completionBlockers).toEqual([
            'ledger:uncovered:decision',
            'ledger:uncovered:history',
            'ledger:uncovered:macro',
            'ledger:uncovered:revert',
        ]);
    });

    it('blocks every later phase behind a missing query contract even though their own gates would pass', () => {
        const manifest = buildPassingManifestFixture().filter((contract) => contract.id !== 'query');
        const result = evaluateAgentProductionReadiness({
            manifest,
            ledger: buildPassingLedgerFixture(),
            catalog: buildPassingCatalogFixture(),
        });

        expect(result.phases[0]).toEqual({
            id: 'command-query-extraction',
            gate: 'failed',
            status: 'failed',
            blockedBy: null,
        });
        for (const phase of result.phases.slice(1)) {
            expect(phase.status).toBe('blocked');
            expect(phase.blockedBy).toBe('command-query-extraction');
        }
        const externalAdaptersPhase = result.phases.find((phase) => phase.id === 'external-adapters');
        expect(externalAdaptersPhase).toEqual({
            id: 'external-adapters',
            gate: 'passed',
            status: 'blocked',
            blockedBy: 'command-query-extraction',
        });
    });

    it('fails previewable-basic-edits when a minimum-write-set entry is interim-unsupported', () => {
        const ledgerFixture = buildPassingLedgerFixture();
        const ledger = {
            ...ledgerFixture,
            entries: ledgerFixture.entries.map(markAddTrackInterimUnsupported),
        };
        const result = evaluateAgentProductionReadiness({
            manifest: buildPassingManifestFixture(),
            ledger,
            catalog: buildPassingCatalogFixture(),
        });

        expect(result.phases.find((phase) => phase.id === 'previewable-basic-edits')).toEqual({
            id: 'previewable-basic-edits',
            gate: 'failed',
            status: 'failed',
            blockedBy: null,
        });
        expect(result.completionBlockers).toContain('ledger:interim-unsupported:addTrack');
    });

    it('claims completion against the live manifest and catalog once the ledger has no uncovered category', () => {
        const liveLedger = getAgentCommandLedger();
        const ledger = { ...liveLedger, uncoveredCategories: [] };
        const manifest = getAgentProtocolManifest();
        const catalog = getAgentCapabilityCatalog(manifest);

        const result = evaluateAgentProductionReadiness({ manifest, ledger, catalog });

        // Every phase gate already passes on the live head (see the second test in this file), so
        // clearing the ledger's only remaining blocker — its uncovered categories — flips the claim.
        expect(result.completionClaim).toBe(true);
        expect(result.completionBlockers).toEqual([]);
    });

    it('fails read-only-assistance and blocks previewable-basic-edits when the catalog omits an entry for one discovery domain', () => {
        const catalogFixture = buildPassingCatalogFixture();
        const catalog = {
            ...catalogFixture,
            entries: catalogFixture.entries.filter((entry) => entry.id !== 'discovery:preset'),
        };
        const result = evaluateAgentProductionReadiness({
            manifest: buildPassingManifestFixture(),
            ledger: buildPassingLedgerFixture(),
            catalog,
        });

        expect(result.phases.find((phase) => phase.id === 'read-only-assistance')).toEqual({
            id: 'read-only-assistance',
            gate: 'failed',
            status: 'failed',
            blockedBy: null,
        });
        expect(result.phases.find((phase) => phase.id === 'previewable-basic-edits')).toEqual({
            id: 'previewable-basic-edits',
            gate: 'passed',
            status: 'blocked',
            blockedBy: 'read-only-assistance',
        });
    });

    it('fails media-autonomy-exclusion and blocks external-adapters when a deferred capability becomes available', () => {
        const catalogFixture = buildPassingCatalogFixture();
        const catalog = {
            ...catalogFixture,
            entries: catalogFixture.entries.map((entry) =>
                entry.name === 'agent.media.listen' ? { ...entry, availability: 'available' as const } : entry
            ),
        };
        const result = evaluateAgentProductionReadiness({
            manifest: buildPassingManifestFixture(),
            ledger: buildPassingLedgerFixture(),
            catalog,
        });

        expect(result.phases.find((phase) => phase.id === 'media-autonomy-exclusion')).toEqual({
            id: 'media-autonomy-exclusion',
            gate: 'failed',
            status: 'failed',
            blockedBy: null,
        });
        expect(result.phases.find((phase) => phase.id === 'external-adapters')).toEqual({
            id: 'external-adapters',
            gate: 'passed',
            status: 'blocked',
            blockedBy: 'media-autonomy-exclusion',
        });
    });
});
