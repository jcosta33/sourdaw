import { describe, expect, it, vi } from 'vitest';

import { APPLICATION_OWNED_CAPABILITY_OPERATIONS } from '../../models/AgentCapabilityOperations';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { DEFERRED_AGENT_CAPABILITIES } from '../deferredAgentCapabilities';
import { getAgentCapabilityCatalog } from '../getAgentCapabilityCatalog';

const QUERY_CONTRACT = {
    id: 'query',
    owner: 'Project',
    operations: [
        { name: 'object', version: '1', availability: 'available' },
        { name: 'discovery.sample', version: '1', availability: 'available' },
    ],
};

const ADAPTER_CONTRACT = {
    id: 'external-adapter',
    owner: 'AiRuntime',
    operations: [{ name: 'anthropic', version: '2', availability: 'configuration-required' }],
};

function readOperationNames(data: unknown): string[] {
    if (typeof data !== 'object' || data === null || !('operations' in data) || !Array.isArray(data.operations)) {
        throw new Error('The capabilities receipt carries no operations array.');
    }
    return data.operations.map((operation: unknown) => {
        if (
            typeof operation !== 'object' ||
            operation === null ||
            !('name' in operation) ||
            typeof operation.name !== 'string'
        ) {
            throw new Error('A capability operation carries no name.');
        }
        return operation.name;
    });
}

async function readCapabilityReceiptOperationNames(): Promise<string[]> {
    const result = await runApplicationOwnedToolLoop({
        loopId: 'capability-catalog-loop',
        terminalToolNames: new Set(['command.batch.propose']),
        requestTurn: vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [{ id: 'capabilities-1', name: 'agent.capabilities', arguments: {} }],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
    });
    const receipt = result.receipts.find((entry) => entry.callId === 'capabilities-1');
    expect(receipt?.status).toBe('success');
    return readOperationNames(receipt?.data);
}

function applicationSurfaceEntries() {
    return getAgentCapabilityCatalog([QUERY_CONTRACT, ADAPTER_CONTRACT]).entries.filter(
        (entry) => entry.evidence.surface === 'application-tool'
    );
}

describe('agent capability catalog', () => {
    it('publishes every application-owned operation and reports a deferred one as unreachable', () => {
        const entries = applicationSurfaceEntries();

        expect(entries.map((entry) => entry.name)).toEqual([
            ...APPLICATION_OWNED_CAPABILITY_OPERATIONS.map((operation) => operation.name),
            ...DEFERRED_AGENT_CAPABILITIES.map((operation) => operation.name),
        ]);
        for (const deferred of DEFERRED_AGENT_CAPABILITIES) {
            const entry = entries.find((candidate) => candidate.name === deferred.name);
            expect(entry).toMatchObject({
                id: deferred.name,
                availability: 'unavailable',
                reason: deferred.reason,
                version: null,
            });
            expect(entry?.evidence).toMatchObject({
                surface: 'application-tool',
                owner: deferred.owner,
                callable: false,
                declaredAvailability: 'deferred',
                kind: 'deferred-capability',
            });
        }
        const proposalOnly = entries.find((entry) => entry.name === 'render.request');
        expect(proposalOnly).toMatchObject({ availability: 'available' });
        expect(proposalOnly?.evidence).toMatchObject({ declaredAvailability: 'proposal-only', callable: true });
    });

    it('answers the agent.capabilities receipt from the same source the catalog reads', async () => {
        expect(await readCapabilityReceiptOperationNames()).toEqual(
            applicationSurfaceEntries().map((entry) => entry.name)
        );
    });

    it('copies each protocol contract operation with its contract identity and published version', () => {
        const entries = getAgentCapabilityCatalog([QUERY_CONTRACT, ADAPTER_CONTRACT]).entries;

        expect(entries.find((entry) => entry.id === 'query:discovery.sample')).toEqual({
            id: 'query:discovery.sample',
            name: 'discovery.sample',
            availability: 'available',
            reason: null,
            version: '1',
            evidence: {
                surface: 'protocol-contract',
                owner: 'query',
                contractOwner: 'Project',
                declaredAvailability: 'available',
            },
        });
        expect(entries.find((entry) => entry.id === 'external-adapter:anthropic')).toMatchObject({
            availability: 'unavailable',
            reason: 'configuration-required',
            version: '2',
        });
    });

    it('names no capability beyond the operations its owners published', () => {
        const entries = getAgentCapabilityCatalog([]).entries;

        expect(entries.map((entry) => entry.id)).toEqual([
            ...APPLICATION_OWNED_CAPABILITY_OPERATIONS.map((operation) => operation.name),
            ...DEFERRED_AGENT_CAPABILITIES.map((operation) => operation.name),
        ]);
    });
});
