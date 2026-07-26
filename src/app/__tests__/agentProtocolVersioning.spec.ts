import { change, init } from '@automerge/automerge';
import { describe, expect, it, vi } from 'vitest';

import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    DOC_PREFIX_ROOT,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    replaceCrdtDoc,
} from '#/modules/CrdtDocument/useCases';
import { projectStore } from '#/modules/Project/stores';
import { loadProject, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';

import { agentProtocolRegistry, resolvePersistedAgentProtocol } from '../agentProtocols/agentProtocolGovernance';

import {
    agentProjectHydrationFixture,
    agentProtocolOwnerFixtures,
    agentProtocolVersionFixtures,
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
    it('publishes complete, uniquely identified families with exact semantic owners', () => {
        expect(agentProtocolRegistry.map(({ id, semanticOwner: owner }) => ({ id, owner }))).toEqual(
            agentProtocolOwnerFixtures
        );
        expect(new Set(agentProtocolRegistry.map(({ id }) => id)).size).toBe(agentProtocolOwnerFixtures.length);
    });

    it('deep-freezes independent policies, capabilities, operation versions, and availability', () => {
        expect(Object.isFrozen(agentProtocolRegistry)).toBe(true);
        for (const protocol of agentProtocolRegistry) {
            expect(
                [
                    protocol,
                    protocol.capabilities,
                    protocol.operationVersions,
                    protocol.compatibility,
                    protocol.availability,
                    ...Object.values(protocol.operationVersions),
                ].every(Object.isFrozen)
            ).toBe(true);
        }
        expect(new Set(agentProtocolRegistry.map(({ compatibility }) => compatibility)).size).toBe(
            agentProtocolOwnerFixtures.length
        );
        expect(new Set(agentProtocolRegistry.map(({ availability }) => availability)).size).toBe(
            agentProtocolOwnerFixtures.length
        );
    });

    it('resolves frozen old, current, and future persisted versions through one boundary', () => {
        const actual = agentProtocolVersionFixtures.map(({ id, version }) => {
            const resolution = resolvePersistedAgentProtocol({ id, schemaVersion: version });
            return resolution.status === 'supported' ? resolution.handling : resolution.status;
        });
        expect(actual).toEqual(agentProtocolVersionFixtures.map(({ expected }) => expected));
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
        expect(getCrdtDoc<Record<string, unknown>>(DOC_PREFIX_ROOT)?.agentProtocolAudit).toEqual(
            agentProjectHydrationFixture.agentProtocolAudit
        );
        expect(loadMocks.executeAppAction).not.toHaveBeenCalled();
    });
});
