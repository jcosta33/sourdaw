import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getAgentCapabilityCatalog } from '#/modules/AiRuntime/useCases';
import { clearHandlerRegistry } from '#/modules/Command/stores';
import { getAgentCommandLedger, registerProductionCommandHandlers } from '#/modules/Command/useCases';

import { evaluateAgentProductionReadiness, getAgentProductionReadiness } from '../getAgentProductionReadiness';
import { getAgentProtocolManifest } from '../getAgentProtocolManifest';
import { getProductionCommandHandlerMaps } from '../getProductionCommandHandlerMaps';

/**
 * The published phase order, written literally rather than imported from `AGENT_PRODUCTION_PHASES`
 * so a silent reorder of the production constant cannot also reorder what this file pins.
 */
const AGENT_PRODUCTION_PHASE_ORDER = [
    'command-query-extraction',
    'read-only-assistance',
    'previewable-basic-edits',
    'batches-and-transforms',
    'offline-render-measurement',
    'vibe-mix-planning',
    'media-autonomy-exclusion',
    'external-adapters',
] as const;

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
                previewExecution: 'isolated-project',
            },
            {
                operationId: 'renderProjectSections',
                category: 'render-freeze-export',
                owner: 'AudioRendering',
                descriptorVersion: 1,
                packet: 'getAudioRenderingHandlers',
                closure: 'supported',
                minimumWriteSet: false,
                previewExecution: 'unknown',
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
    // getAgentCommandLedger's previewExecution field reads the currently registered handlers
    // (getAppActionPreviewExecution), so the live-head assertions below only hold once the real
    // production handler maps are registered, the same way the app boots them.
    beforeEach(() => {
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
    });

    afterEach(() => {
        clearHandlerRegistry();
    });

    it('returns phases in exactly the published phase order', () => {
        const result = getAgentProductionReadiness();

        expect(result.phases.map((phase) => phase.id)).toEqual([...AGENT_PRODUCTION_PHASE_ORDER]);
    });

    it('fails previewable-basic-edits and external-adapters on the live head, blocking every phase after previewable-basic-edits', () => {
        const result = getAgentProductionReadiness();

        // Verified against live code:
        // - `previewable-basic-edits` requires every minimum-write-set entry to be `supported` AND
        //   `previewExecution === 'isolated-project'`. Most minimum-write-set handlers (renameTrack,
        //   muteTrack, setTrackGain, addMarker, addAutomationLane, ...) never declare
        //   `previewExecution: 'isolated-project'`, so `getAppActionPreviewExecution` reports
        //   `'unknown'` for them; only a handful (addTrack, createBus, addClip, moveClip, splitClip,
        //   drawClip, duplicateClipAt, moveClips, addDevice, setDeviceParameter, addNotes) declare it.
        //   The gate therefore fails independently of any other phase.
        // - `external-adapters` requires the `external-adapter` contract's `availability ===
        //   'available'`. `getAiRuntimeProtocolContracts.ts` sets it to `'available'` only when an
        //   adapter operation is itself `'available'`, else `'runtime-dependent'`
        //   (getAiRuntimeProtocolContracts.ts:63-65); no provider adapter is registered here, so it
        //   stays `'runtime-dependent'` and this gate fails too, on top of being blocked.
        expect(result.phases).toEqual([
            { id: 'command-query-extraction', gate: 'passed', status: 'passed', blockedBy: null },
            { id: 'read-only-assistance', gate: 'passed', status: 'passed', blockedBy: null },
            { id: 'previewable-basic-edits', gate: 'failed', status: 'failed', blockedBy: null },
            {
                id: 'batches-and-transforms',
                gate: 'passed',
                status: 'blocked',
                blockedBy: 'previewable-basic-edits',
            },
            {
                id: 'offline-render-measurement',
                gate: 'passed',
                status: 'blocked',
                blockedBy: 'previewable-basic-edits',
            },
            { id: 'vibe-mix-planning', gate: 'passed', status: 'blocked', blockedBy: 'previewable-basic-edits' },
            {
                id: 'media-autonomy-exclusion',
                gate: 'passed',
                status: 'blocked',
                blockedBy: 'previewable-basic-edits',
            },
            {
                id: 'external-adapters',
                gate: 'failed',
                status: 'blocked',
                blockedBy: 'previewable-basic-edits',
            },
        ]);
    });

    it('reports no completion claim on the live head, blocked by every phase from previewable-basic-edits onward plus the four uncovered ledger categories', () => {
        const result = getAgentProductionReadiness();

        expect(result.completionClaim).toBe(false);
        expect(result.completionBlockers).toEqual([
            'batches-and-transforms',
            'external-adapters',
            'ledger:uncovered:decision',
            'ledger:uncovered:history',
            'ledger:uncovered:macro',
            'ledger:uncovered:revert',
            'media-autonomy-exclusion',
            'offline-render-measurement',
            'previewable-basic-edits',
            'vibe-mix-planning',
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

    it('still reports no completion claim against the live manifest and catalog after clearing the uncovered categories, because previewable-basic-edits and external-adapters still fail', () => {
        const liveLedger = getAgentCommandLedger();
        const ledger = { ...liveLedger, uncoveredCategories: [] };
        const manifest = getAgentProtocolManifest();
        const catalog = getAgentCapabilityCatalog(manifest);

        const result = evaluateAgentProductionReadiness({ manifest, ledger, catalog });

        // Ledger coverage was never the only live-head blocker: previewable-basic-edits and
        // external-adapters fail on their own gates (see the second test in this file), so clearing
        // uncoveredCategories only drops the four ledger:uncovered:* blockers, not the phase ones.
        expect(result.completionClaim).toBe(false);
        expect(result.completionBlockers).toEqual([
            'batches-and-transforms',
            'external-adapters',
            'media-autonomy-exclusion',
            'offline-render-measurement',
            'previewable-basic-edits',
            'vibe-mix-planning',
        ]);
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

    it('claims completion when every phase gate passes and the ledger has no uncovered category', () => {
        const result = evaluateAgentProductionReadiness({
            manifest: buildPassingManifestFixture(),
            ledger: buildPassingLedgerFixture(),
            catalog: buildPassingCatalogFixture(),
        });

        expect(result.completionClaim).toBe(true);
        expect(result.completionBlockers).toEqual([]);
    });

    it('fails previewable-basic-edits and blocks batches-and-transforms when a minimum-write-set entry has an unknown preview execution', () => {
        const ledgerFixture = buildPassingLedgerFixture();
        const ledger = {
            ...ledgerFixture,
            entries: ledgerFixture.entries.map((entry) =>
                entry.operationId === 'addTrack' ? { ...entry, previewExecution: 'unknown' as const } : entry
            ),
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
        expect(result.phases.find((phase) => phase.id === 'batches-and-transforms')).toEqual({
            id: 'batches-and-transforms',
            gate: 'passed',
            status: 'blocked',
            blockedBy: 'previewable-basic-edits',
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
