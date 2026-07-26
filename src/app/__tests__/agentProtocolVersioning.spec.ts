import { change, init } from '@automerge/automerge';
import { describe, expect, it, vi } from 'vitest';

import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import { DOC_PREFIX_ROOT, registerCrdtStorageRuntime, replaceCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { projectStore } from '#/modules/Project/stores';
import { loadProject, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';

import { agentProtocolRegistry, resolvePersistedAgentProtocol } from '../agentProtocols/agentProtocolGovernance';

import {
    agentProtocolDescriptorGolden,
    agentProjectHydrationFixture,
} from './fixtures/agentProtocols/agentProtocolVersionFixtures';

const loadMocks = vi.hoisted(() => ({
    clearUndoHistory: vi.fn(),
    executeAppAction: vi.fn(),
    loadCrdtProject: vi.fn(),
    migrateAbsoluteMidiNotes: vi.fn(),
    prepareCachedAudioBuffersFromIdb: vi.fn(() => Promise.resolve({ publish: vi.fn() })),
    readLegacyChordTrackMigration: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
    startCrdtAutoSave: vi.fn(() => vi.fn()),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    cancelPendingAudioBufferImport: vi.fn(),
    getAudioContext: vi.fn(() => ({})),
    prepareCachedAudioBuffersFromIdb: loadMocks.prepareCachedAudioBuffersFromIdb,
    setMasterGainValue: vi.fn(),
}));
vi.mock('#/modules/Command/useCases', () => ({
    clearUndoHistory: loadMocks.clearUndoHistory,
    executeAppAction: loadMocks.executeAppAction,
    resetActionReplayAuthority: loadMocks.resetActionReplayAuthority,
}));
vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    loadCrdtProject: loadMocks.loadCrdtProject,
    persistCrdtProject: vi.fn(() => Promise.resolve()),
    startCrdtAutoSave: loadMocks.startCrdtAutoSave,
}));
vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    migrateAbsoluteMidiNotes: loadMocks.migrateAbsoluteMidiNotes,
    readLegacyChordTrackMigration: loadMocks.readLegacyChordTrackMigration,
}));

describe('agent protocol governance', () => {
    it('publishes the complete governance-only registry against an independent golden', () => {
        expect(agentProtocolRegistry).toEqual(agentProtocolDescriptorGolden);
    });

    it('deep-freezes independent policies, capabilities, operation versions, and availability', () => {
        expect(Object.isFrozen(agentProtocolRegistry)).toBe(true);
        for (const protocol of agentProtocolRegistry) {
            expect(
                [
                    protocol,
                    protocol.requiredCapabilities,
                    protocol.supportedCapabilities,
                    protocol.requiredOperationVersions,
                    protocol.supportedOperationVersions,
                    protocol.compatibility,
                    protocol.availability,
                    ...Object.values(protocol.requiredOperationVersions),
                ].every(Object.isFrozen)
            ).toBe(true);
        }
        for (const field of ['compatibility', 'availability'] as const) {
            expect(new Set(agentProtocolRegistry.map((protocol) => protocol[field])).size).toBe(
                agentProtocolDescriptorGolden.length
            );
        }
    });

    it('resolves frozen old, current, and future persisted versions through one boundary', () => {
        const actual = agentProtocolDescriptorGolden.flatMap(({ id, schemaVersion }) =>
            [schemaVersion - 1, schemaVersion, schemaVersion + 1].map((version) => {
                const resolution = resolvePersistedAgentProtocol({ id, schemaVersion: version });
                return resolution.status === 'supported' ? resolution.handling : resolution.status;
            })
        );
        const expected = agentProtocolDescriptorGolden.flatMap(({ compatibility }) =>
            (['previous', 'current', 'future'] as const).map((version) => compatibility[version])
        );
        expect(actual).toEqual(expected);
    });

    it('resolves aliases and tombstones and rejects unknown or malformed identities deterministically', () => {
        expect(resolvePersistedAgentProtocol({ id: 'sourdaw.agent.model-provider', schemaVersion: 1 })).toMatchObject({
            status: 'supported',
            persistedId: 'sourdaw.agent.model-provider',
            canonicalId: 'sourdaw.agent.provider',
        });
        expect(resolvePersistedAgentProtocol({ id: 'sourdaw.agent.runtime-action', schemaVersion: 0 })).toEqual({
            status: 'tombstoned',
            persistedId: 'sourdaw.agent.runtime-action',
            replacement: 'sourdaw.agent.command',
            handling: 'read-only-preserve',
        });
        expect(
            [
                resolvePersistedAgentProtocol({ id: null, schemaVersion: 1 }),
                resolvePersistedAgentProtocol({ id: 'sourdaw.agent.unknown', schemaVersion: 1 }),
                resolvePersistedAgentProtocol({ id: 'sourdaw.agent.command', schemaVersion: 1.5 }),
            ].map((result) => (result.status === 'unsupported' ? result.reason : result.status))
        ).toEqual(['malformed-id', 'unknown-id', 'malformed-version']);
    });

    it('hydrates materialized project and audit history without replaying an obsolete command', async () => {
        registerCrdtStorageRuntime();
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        let persistedDocument = init<Record<string, unknown>>();
        persistedDocument = change(persistedDocument, (draft) => {
            Object.assign(draft, structuredClone(agentProjectHydrationFixture));
        });
        loadMocks.loadCrdtProject.mockImplementation(() => {
            replaceCrdtDoc({ id: DOC_PREFIX_ROOT, doc: persistedDocument });
            return Promise.resolve(true);
        });

        await expect(loadProject()).resolves.toBe(true);

        expect(projectStore.value?.name).toBe(agentProjectHydrationFixture.projectMeta.name);
        expect(actionHistoryStore.value?.entries).toEqual(agentProjectHydrationFixture.actionHistory.entries);
        expect(loadMocks.executeAppAction).not.toHaveBeenCalled();
    });
});
