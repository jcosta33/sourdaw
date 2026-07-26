import { describe, expect, it } from 'vitest';

import {
    agentProjectStateCompatibility,
    agentProtocolRegistry,
    classifyAgentProtocolVersion,
} from '../agentProtocols/agentProtocolGovernance';

import { agentProtocolVersionFixtures } from './fixtures/agentProtocols/agentProtocolVersionFixtures';

const expectedFamilies = [
    'command',
    'query',
    'receipt',
    'provider',
    'device-manifest',
    'production-brief',
    'transform',
    'external-adapter',
];

describe('agent protocol governance', () => {
    it('publishes one complete protocol descriptor per independently versioned family', () => {
        expect(agentProtocolRegistry.map(({ family }) => family)).toEqual(expectedFamilies);

        const ids = agentProtocolRegistry.map(({ id }) => id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(agentProtocolRegistry.map(({ id, schemaVersionOwner }) => schemaVersionOwner === id)).toEqual(
            expectedFamilies.map(() => true)
        );
    });

    it('publishes explicit capability, operation-version, availability, and compatibility policy', () => {
        for (const protocol of agentProtocolRegistry) {
            expect(protocol.capabilities.length).toBeGreaterThan(0);
            expect(Object.keys(protocol.operationVersions).length).toBeGreaterThan(0);
            expect(Object.values(protocol.operationVersions).every((versions) => versions.length > 0)).toBe(true);
            expect(protocol.availability.state).toBe('governance-only');
            expect(protocol.compatibility.current).toBe('read-write');
            expect(protocol.compatibility.future).toBe('read-only-preserve');
        }

        const operationIds = agentProtocolRegistry.flatMap(({ operationVersions }) => Object.keys(operationVersions));
        expect(new Set(operationIds).size).toBe(operationIds.length);
    });

    it('handles frozen old, current, and future schema fixtures without guessing', () => {
        const actual = agentProtocolVersionFixtures.map((fixture) => {
            const protocol = agentProtocolRegistry.find(({ id }) => id === fixture.id);
            if (!protocol) {
                return 'missing';
            }
            return classifyAgentProtocolVersion({ protocol, schemaVersion: fixture.version });
        });

        expect(actual).toEqual(agentProtocolVersionFixtures.map(({ expected }) => expected));
    });

    it('loads canonical state without replaying obsolete commands', () => {
        expect(agentProjectStateCompatibility).toEqual({
            canonicalSource: 'materialized-project-state',
            obsoleteCommandHandling: 'audit-only',
            replayRequiredForLoad: false,
        });
    });
});
