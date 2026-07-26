import { change, init } from '@automerge/automerge';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import { DOC_PREFIX_ROOT, registerCrdtStorageRuntime, replaceCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { projectStore } from '#/modules/Project/stores';
import { loadProject, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';

import { agentProtocolRegistry, resolvePersistedAgentProtocol } from '../agentProtocols/agentProtocolGovernance';

import { projectFixture, protocolGolden } from './fixtures/agentProtocols/agentProtocolVersionFixtures';

import type { PersistedAgentProtocolResolution } from '../agentProtocols/agentProtocolGovernance';

const loadMocks = vi.hoisted(() => ({
    executeAppAction: vi.fn(),
    loadCrdtProject: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    cancelPendingAudioBufferImport: vi.fn(),
    getAudioContext: vi.fn(() => ({})),
    prepareCachedAudioBuffersFromIdb: vi.fn(() => Promise.resolve({ publish: vi.fn() })),
    setMasterGainValue: vi.fn(),
}));
vi.mock('#/modules/Command/useCases', () => ({
    clearUndoHistory: vi.fn(),
    executeAppAction: loadMocks.executeAppAction,
    resetActionReplayAuthority: vi.fn(),
}));
vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    loadCrdtProject: loadMocks.loadCrdtProject,
    persistCrdtProject: vi.fn(() => Promise.resolve()),
    startCrdtAutoSave: vi.fn(() => vi.fn()),
}));
vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    migrateAbsoluteMidiNotes: vi.fn(),
    readLegacyChordTrackMigration: vi.fn(),
}));

describe('agent protocol governance', () => {
    it('publishes the complete governance-only registry against an independent golden', () => {
        expect(agentProtocolRegistry).toEqual(protocolGolden);
    });

    it('deep-freezes independent policies, capabilities, operation versions, and availability', () => {
        const frozenValues = agentProtocolRegistry.flatMap((protocol) => [
            protocol,
            protocol.requiredCapabilities,
            protocol.supportedCapabilities,
            protocol.requiredOperationVersions,
            protocol.supportedOperationVersions,
            protocol.compatibility,
            protocol.availability,
            ...Object.values(protocol.requiredOperationVersions),
        ]);
        expect([agentProtocolRegistry, ...frozenValues].every(Object.isFrozen)).toBe(true);
        for (const field of ['compatibility', 'availability'] as const) {
            expect(new Set(agentProtocolRegistry.map((protocol) => protocol[field])).size).toBe(protocolGolden.length);
        }
    });

    it('resolves frozen old, current, and future persisted versions through one boundary', () => {
        expectTypeOf(resolvePersistedAgentProtocol).returns.toEqualTypeOf<PersistedAgentProtocolResolution>();
        const actual = protocolGolden.flatMap(({ id, schemaVersion }) =>
            [schemaVersion - 1, schemaVersion, schemaVersion + 1].map((version) => {
                const resolution = resolvePersistedAgentProtocol({ id, schemaVersion: version });
                if (resolution.status === 'supported') {
                    return resolution.handling;
                }
                return resolution.status === 'unsupported' ? resolution.reason : resolution.status;
            })
        );
        const expected = protocolGolden.flatMap(({ schemaVersion, compatibility }) => {
            let previous: string = compatibility.previous;
            if (schemaVersion - 1 < compatibility.minimumReadableVersion) {
                previous = 'below-minimum-version';
            }
            return [previous, compatibility.current, compatibility.future];
        });
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
            Object.assign(draft, structuredClone(projectFixture));
        });
        loadMocks.loadCrdtProject.mockImplementation(() => {
            replaceCrdtDoc({ id: DOC_PREFIX_ROOT, doc: persistedDocument });
            return Promise.resolve(true);
        });

        await expect(loadProject()).resolves.toBe(true);

        expect(projectStore.value?.name).toBe(projectFixture.projectMeta.name);
        expect(actionHistoryStore.value?.entries).toEqual(projectFixture.actionHistory.entries);
        expect(loadMocks.executeAppAction).not.toHaveBeenCalled();
    });
});
