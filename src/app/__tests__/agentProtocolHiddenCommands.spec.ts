import { describe, expect, it } from 'vitest';

import { getAgentCapabilityCatalog } from '#/modules/AiRuntime/useCases';
import { getCommandProtocolContracts, getExecutableCommandRegistrations } from '#/modules/Command/useCases';

import { getAgentProtocolManifest } from '../getAgentProtocolManifest';

function partitionByDiscoverability() {
    const registrations = getExecutableCommandRegistrations();
    return {
        hidden: registrations.filter(({ discoverability }) => discoverability === 'hidden').map((r) => r.actionType),
        visible: registrations.filter(({ discoverability }) => discoverability === 'visible').map((r) => r.actionType),
    };
}

describe('agent protocol publication of hidden commands', () => {
    it('leaves hidden commands out of the command contract and keeps every visible one available', () => {
        const { hidden, visible } = partitionByDiscoverability();
        expect(hidden.length).toBeGreaterThan(0);
        expect(visible.length).toBeGreaterThan(0);

        const operations = getCommandProtocolContracts().command.operations;

        expect(operations.filter(({ name }) => hidden.includes(name as never))).toEqual([]);
        expect(operations.map(({ name }) => name)).toEqual(visible);
    });

    it('advertises no hidden command in the capability catalog the external adapter serves', () => {
        const { hidden, visible } = partitionByDiscoverability();
        expect(hidden.length).toBeGreaterThan(0);

        const entries = getAgentCapabilityCatalog(getAgentProtocolManifest()).entries;
        const commandEntries = entries.filter(({ id }) => id.startsWith('command:'));
        const commandEntryNames = commandEntries.map(({ name }) => name);

        expect(commandEntryNames.filter((name) => hidden.includes(name as never))).toEqual([]);
        expect(commandEntryNames).toEqual(visible);
        expect(commandEntries.every(({ availability }) => availability === 'available')).toBe(true);
    });
});
