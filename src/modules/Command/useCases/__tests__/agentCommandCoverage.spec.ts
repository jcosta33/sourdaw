import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';

import { getRuntimeActionTypes } from '#/modules/AiRuntime/useCases';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { getDrumPreviewBranchHandlers } from '#/modules/CrdtDocument/useCases';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { getProjectHandlers } from '#/modules/Project/useCases';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { getYeastHandlers } from '#/modules/Yeast/useCases';

import {
    AGENT_COMMAND_LEDGER_CATEGORIES,
    assertPacketMatchesClosure,
    isInterimPacketReference,
    type AgentCommandLedgerCategory,
    type AgentCommandLedgerClosure,
    type AgentCommandLedgerEntry,
    type AgentCommandLedgerOwner,
    type AgentRuntimeActionAccountingRecord,
} from '../../models/AgentCommandLedger';
import { clearHandlerRegistry } from '../../stores/handlerRegistry';
import { executableAppActionDescriptors, isExecutableAppActionType } from '../executableAppActionRegistry';
import { getAgentCommandLedger } from '../getAgentCommandLedger';
import { getAppActionPreviewExecution } from '../getAppActionPreviewExecution';
import { getExecutableAppActionOperationVersion } from '../getExecutableAppActionOperationVersion';
import { registerProductionCommandHandlers } from '../registerProductionCommandHandlers';

/** The registering handler factory name for each owning module, mirroring the ledger's `packet`. */
const OWNER_FACTORY_NAMES: Record<AgentCommandLedgerOwner, string> = {
    Arrangement: 'getArrangementHandlers',
    AudioRendering: 'getAudioRenderingHandlers',
    Automation: 'getAutomationHandlers',
    CrdtDocument: 'getDrumPreviewBranchHandlers',
    MIDI: 'getMidiNoteTransformHandlers',
    Project: 'getProjectHandlers',
    Transport: 'getTransportHandlers',
    Yeast: 'getYeastHandlers',
};

function buildActionTypeOwnerMap(): Map<string, AgentCommandLedgerOwner> {
    const ownerMaps: readonly [AgentCommandLedgerOwner, Record<string, unknown>][] = [
        ['Arrangement', getArrangementHandlers()],
        ['AudioRendering', getAudioRenderingHandlers()],
        ['Automation', getAutomationHandlers()],
        ['CrdtDocument', getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true })],
        ['MIDI', getMidiNoteTransformHandlers()],
        ['Project', getProjectHandlers()],
        ['Transport', getTransportHandlers()],
        ['Yeast', getYeastHandlers()],
    ];
    const actionTypeToOwner = new Map<string, AgentCommandLedgerOwner>();
    for (const [owner, handlerMap] of ownerMaps) {
        for (const actionType of Object.keys(handlerMap)) {
            actionTypeToOwner.set(actionType, owner);
        }
    }
    return actionTypeToOwner;
}

/**
 * Every runtime action type is covered exactly once, by an executable descriptor or by one
 * accounting record, and no record names a type the runtime vocabulary no longer holds. Throws an
 * error naming every type that breaks the rule.
 */
function assertRuntimeActionCensus(
    runtimeActionTypes: readonly string[],
    registeredActionTypes: readonly string[],
    records: readonly AgentRuntimeActionAccountingRecord[]
): void {
    const runtime = new Set(runtimeActionTypes);
    const registered = new Set(registeredActionTypes);
    const recordCounts = new Map<string, number>();
    for (const actionType of records.flatMap((record) => record.actionTypes)) {
        recordCounts.set(actionType, (recordCounts.get(actionType) ?? 0) + 1);
    }
    const unaccounted = [...runtime].filter((type) => !registered.has(type) && !recordCounts.has(type));
    const registeredAndRecorded = [...recordCounts.keys()].filter((type) => registered.has(type));
    const recordedTwice = [...recordCounts].filter(([, count]) => count > 1).map(([type]) => type);
    const stale = [...recordCounts.keys()].filter((type) => !runtime.has(type));
    const problems = [
        ...unaccounted.map((type) => `${type}: no executable descriptor and no accounting record`),
        ...registeredAndRecorded.map((type) => `${type}: registered and also recorded`),
        ...recordedTwice.map((type) => `${type}: recorded more than once`),
        ...stale.map((type) => `${type}: recorded but not a runtime action type`),
    ];
    if (problems.length > 0) {
        throw new Error(`Runtime action census failed:\n${problems.join('\n')}`);
    }
}

function getRegisteredActionTypes(): string[] {
    return executableAppActionDescriptors.map((descriptor) => descriptor.actionType);
}

function getLiveAccounting(): readonly AgentRuntimeActionAccountingRecord[] {
    const records = getAgentCommandLedger().runtimeActionAccounting;
    if (records === undefined) {
        throw new Error('The live ledger must publish its runtime action accounting');
    }
    return records;
}

describe('runtime action census', () => {
    it('covers every live runtime action type exactly once by a descriptor or an accounting record', () => {
        expect(() =>
            assertRuntimeActionCensus(getRuntimeActionTypes(), getRegisteredActionTypes(), getLiveAccounting())
        ).not.toThrow();
    });

    it('fails, naming the type, when a runtime action type has neither a descriptor nor a record', () => {
        expect(() =>
            assertRuntimeActionCensus(
                [...getRuntimeActionTypes(), 'fabricatedRuntimeAction'],
                getRegisteredActionTypes(),
                getLiveAccounting()
            )
        ).toThrowError(/fabricatedRuntimeAction: no executable descriptor and no accounting record/);
    });

    it('fails, naming the type, when a record names a type the runtime vocabulary does not hold', () => {
        const staleRecord: AgentRuntimeActionAccountingRecord = {
            kind: 'outside-agent-scope',
            category: 'view',
            reason: 'stale fixture',
            actionTypes: ['retiredRuntimeAction'],
        };
        expect(() =>
            assertRuntimeActionCensus(getRuntimeActionTypes(), getRegisteredActionTypes(), [
                ...getLiveAccounting(),
                staleRecord,
            ])
        ).toThrowError(/retiredRuntimeAction: recorded but not a runtime action type/);
    });

    it('fails, naming the type, when a registered command is also recorded or a type is recorded twice', () => {
        const doubleRecord: AgentRuntimeActionAccountingRecord = {
            kind: 'outside-agent-scope',
            category: 'view',
            reason: 'double fixture',
            actionTypes: ['addTrack', 'selectTrack'],
        };
        const run = () =>
            assertRuntimeActionCensus(getRuntimeActionTypes(), getRegisteredActionTypes(), [
                ...getLiveAccounting(),
                doubleRecord,
            ]);
        expect(run).toThrowError(/addTrack: registered and also recorded/);
        expect(run).toThrowError(/selectTrack: recorded more than once/);
    });

    it('gives every interim record the runtime-action packet and every record a reason', () => {
        for (const record of getLiveAccounting()) {
            expect(record.reason.length).toBeGreaterThan(0);
            expect(record.actionTypes.length).toBeGreaterThan(0);
            if (record.kind === 'interim-unsupported') {
                expect(record.packet).toBe('#6473');
            }
        }
    });
});

describe('agent command ledger coverage', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        registerProductionCommandHandlers([
            getArrangementHandlers(),
            getAudioRenderingHandlers(),
            getAutomationHandlers(),
            getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
            getMidiNoteTransformHandlers(),
            getProjectHandlers(),
            getTransportHandlers(),
            getYeastHandlers(),
        ]);
    });

    afterEach(() => {
        clearHandlerRegistry();
    });

    it('publishes schema version 1', () => {
        expect(getAgentCommandLedger().schemaVersion).toBe(1);
    });

    it('holds exactly one ledger entry per registered executable command, without duplicates', () => {
        const ledgerOperationIds = getAgentCommandLedger()
            .entries.map((entry) => entry.operationId)
            .sort();
        const registeredActionTypes = executableAppActionDescriptors.map((descriptor) => descriptor.actionType).sort();

        expect(ledgerOperationIds).toEqual(registeredActionTypes);
        expect(new Set(ledgerOperationIds).size).toBe(ledgerOperationIds.length);
    });

    it('carries the descriptor operation version for every entry', () => {
        for (const entry of getAgentCommandLedger().entries) {
            expect(isExecutableAppActionType(entry.operationId)).toBe(true);
            if (!isExecutableAppActionType(entry.operationId)) {
                continue;
            }
            expect(entry.descriptorVersion).toBe(getExecutableAppActionOperationVersion(entry.operationId));
        }
    });

    it('names the actual registering handler module as owner for every entry', () => {
        const actionTypeToOwner = buildActionTypeOwnerMap();

        for (const entry of getAgentCommandLedger().entries) {
            expect(entry.owner).toBe(actionTypeToOwner.get(entry.operationId));
        }
    });

    it("names the owner's registering handler factory as packet for every supported entry", () => {
        for (const entry of getAgentCommandLedger().entries) {
            if (entry.closure !== 'supported') {
                continue;
            }
            expect(entry.packet).toBe(OWNER_FACTORY_NAMES[entry.owner]);
        }
    });

    it('has every live entry supported, each packet naming its owner registering factory', () => {
        expectTypeOf<AgentCommandLedgerClosure>().toEqualTypeOf<'supported' | 'interim-unsupported'>();
        for (const entry of getAgentCommandLedger().entries) {
            expect(entry.closure).toBe('supported');
            expect(entry.packet).toBe(OWNER_FACTORY_NAMES[entry.owner]);
        }
    });

    it('classifies packet format through isInterimPacketReference, matching each closure', () => {
        const supportedEntry: AgentCommandLedgerEntry = {
            operationId: 'addTrack',
            category: 'track',
            owner: 'Arrangement',
            descriptorVersion: 1,
            packet: 'getArrangementHandlers',
            closure: 'supported',
        };
        const interimEntry: AgentCommandLedgerEntry = {
            ...supportedEntry,
            packet: '#2372',
            closure: 'interim-unsupported',
        };

        expect(isInterimPacketReference(supportedEntry.packet)).toBe(false);
        expect(isInterimPacketReference(interimEntry.packet)).toBe(true);
    });

    it('classifies packet reference syntax on boundary inputs', () => {
        expect(isInterimPacketReference('#')).toBe(false);
        expect(isInterimPacketReference('#2372x')).toBe(false);
        expect(isInterimPacketReference('2372')).toBe(false);
        expect(isInterimPacketReference('#2372')).toBe(true);
    });

    it('rejects a supported entry whose packet is a tracker reference, naming the operationId', () => {
        const mismatchedEntry: AgentCommandLedgerEntry = {
            operationId: 'addTrack',
            category: 'track',
            owner: 'Arrangement',
            descriptorVersion: 1,
            packet: '#2372',
            closure: 'supported',
        };

        expect(() => assertPacketMatchesClosure(mismatchedEntry)).toThrowError(/addTrack/);
    });

    it('rejects an interim-unsupported entry whose packet names a handler factory, naming the operationId', () => {
        const mismatchedEntry: AgentCommandLedgerEntry = {
            operationId: 'addTrack',
            category: 'track',
            owner: 'Arrangement',
            descriptorVersion: 1,
            packet: 'getArrangementHandlers',
            closure: 'interim-unsupported',
        };

        expect(() => assertPacketMatchesClosure(mismatchedEntry)).toThrowError(/addTrack/);
    });

    it('reads a literal operationId-to-category mapping for every populated category', () => {
        const entriesByOperationId = new Map(
            getAgentCommandLedger().entries.map((entry) => [entry.operationId, entry.category])
        );
        const expectedCategoryByOperationId: Record<string, AgentCommandLedgerCategory> = {
            addMarker: 'project-timeline',
            addTrack: 'track',
            addClip: 'clip',
            transposeNotes: 'midi',
            setClipFade: 'audio-editing',
            quantizeTransients: 'audio-editing',
            addDevice: 'device',
            setDeviceParameter: 'parameter',
            addAdjustmentRegion: 'automation',
            createBus: 'routing',
            importStemSet: 'asset',
            renderProjectSections: 'render-freeze-export',
            createDrumPreviewBranches: 'branch',
        };

        for (const [operationId, expectedCategory] of Object.entries(expectedCategoryByOperationId)) {
            expect(entriesByOperationId.get(operationId)).toBe(expectedCategory);
        }
    });

    it('carries previewExecution equal to getAppActionPreviewExecution for every entry, and the field discriminates', () => {
        const entries = getAgentCommandLedger().entries;
        for (const entry of entries) {
            expect(isExecutableAppActionType(entry.operationId)).toBe(true);
            if (!isExecutableAppActionType(entry.operationId)) {
                continue;
            }
            expect(entry.previewExecution).toBe(getAppActionPreviewExecution(entry.operationId));
        }
        expect(entries.some((entry) => entry.previewExecution === 'isolated-project')).toBe(true);
        expect(entries.some((entry) => entry.previewExecution !== 'isolated-project')).toBe(true);
    });

    it('covers every category exactly once, either by a ledger entry or by an uncovered-category record', () => {
        const dto = getAgentCommandLedger();
        const categoriesWithEntries = new Set(dto.entries.map((entry) => entry.category));
        const uncoveredCategories = new Set(dto.uncoveredCategories.map((record) => record.category));

        for (const category of AGENT_COMMAND_LEDGER_CATEGORIES) {
            expect(categoriesWithEntries.has(category)).not.toBe(uncoveredCategories.has(category));
        }
        for (const record of dto.uncoveredCategories) {
            expect(record.packet).toMatch(/^#\d+$/);
        }
    });

    it('marks minimumWriteSet true exactly for visible bounded-reversible descriptors', () => {
        const dto = getAgentCommandLedger();

        for (const descriptor of executableAppActionDescriptors) {
            const discoverability =
                'discoverability' in descriptor ? (descriptor.discoverability ?? 'visible') : 'visible';
            const expectedMinimumWriteSet = descriptor.risk === 'bounded-reversible' && discoverability === 'visible';
            const entry = dto.entries.find((candidate) => candidate.operationId === descriptor.actionType);

            expect(entry?.minimumWriteSet).toBe(expectedMinimumWriteSet);
        }
    });

    it('draws every entry category from the published category union', () => {
        expectTypeOf<
            ReturnType<typeof getAgentCommandLedger>['entries'][number]['category']
        >().toEqualTypeOf<AgentCommandLedgerCategory>();

        for (const entry of getAgentCommandLedger().entries) {
            expect((AGENT_COMMAND_LEDGER_CATEGORIES as readonly string[]).includes(entry.category)).toBe(true);
        }
    });
});
