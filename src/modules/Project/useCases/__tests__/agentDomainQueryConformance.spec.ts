import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import {
    installTransactionalIndexedDb,
    type TransactionalIndexedDbInstallation,
} from '#/infra/testing/installTransactionalIndexedDb';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import {
    createTrack,
    deleteUserPreset,
    getAgentBuiltinDeviceFactoryManifest,
    getAgentPresetDiscoveryManifest,
    getArrangementHandlers,
    getFactoryPresets,
    getUserPresets,
    saveCurrentAsPreset,
    setTrackStoreState,
} from '#/modules/Arrangement/useCases';
import { getAgentBuiltinDeviceRuntimeManifest } from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { executeAppAction } from '#/modules/Command/useCases';
import { createCrdtProject } from '#/modules/CrdtDocument/useCases';
import { defaultPluginScanState, pluginScanStore, type PluginScanState } from '#/modules/PluginHost/stores';
import { getAgentDeviceFactoryManifest } from '#/modules/PluginHost/useCases';
import { libraryStore, type LibraryState } from '#/modules/SampleLibrary/stores';
import { searchAgentCatalog } from '#/modules/SampleLibrary/useCases';

import {
    AGENT_DISCOVERY_DOMAINS,
    AGENT_DISCOVERY_SAMPLE_QUERY_LIMIT,
    type AgentDiscoveryDomain,
    type AgentDiscoveryFilters,
    type AgentDiscoveryResult,
} from '../../models/AgentDiscoveryQuery';
import { SEMANTIC_PROJECT_QUERY_TYPES } from '../../models/SemanticProjectQuery';
import { defaultProjectStoreState, projectStore } from '../../stores/projectStore';
import { agentCapabilityDiscoveryPort } from '../agentCapabilityDiscoveryPort';
import { getProjectProtocolContracts } from '../getProjectProtocolContracts';
import { queryAgentDiscovery } from '../queryAgentDiscovery';

// Every built-in descriptor is matched by a runtime factory on this platform, so
// the runtime half is spied on to answer for a type no factory claims.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return { ...actual, getAgentBuiltinDeviceRuntimeManifest: vi.fn(actual.getAgentBuiltinDeviceRuntimeManifest) };
});

const DISCOVERY_PROJECT_ID = '9f1c4d7a-3b2e-4c55-9a10-7d4e2f6b8c31';
const LIBRARY_ROOT_ID = 'discovery-user-library';
const SAMPLE_TEXT = 'kick';

type LibrarySample = LibraryState['samples'][number];
type LibrarySyncStatus = LibrarySample['sync']['status'];
type ScannedPluginRecord = PluginScanState['scannedPlugins'][number];

function buildSample(args: { id: string; displayName: string; status: LibrarySyncStatus }): LibrarySample {
    return {
        id: args.id,
        libraryRootId: LIBRARY_ROOT_ID,
        relativePath: `drums/${args.id}.wav`,
        displayName: args.displayName,
        ext: 'wav',
        folder: 'drums',
        sync: { exists: true, status: args.status },
        format: { durationSec: 1.5, sampleRate: 48_000, channels: 2 },
        tags: [],
        favorite: false,
    };
}

const SEEDED_SAMPLES: LibrarySample[] = [
    buildSample({ id: 'sample-kick-a', displayName: 'Kick A', status: 'discovered' }),
    buildSample({ id: 'sample-kick-b', displayName: 'Kick B', status: 'indexed' }),
    buildSample({ id: 'sample-kick-offline', displayName: 'Kick Offline', status: 'offline' }),
];

function buildScannedPlugin(args: { id: string; name: string; descriptorId: string }): ScannedPluginRecord {
    return {
        id: args.id,
        name: args.name,
        vendor: 'Discovery Audio',
        format: 'clap',
        category: 'effect',
        path: `/plugins/${args.id}.clap`,
        version: '1.2.0',
        descriptor_id: args.descriptorId,
        num_inputs: 2,
        num_outputs: 2,
        num_parameters: 4,
        has_custom_ui: false,
    };
}

const SCANNED_PLUGINS: ScannedPluginRecord[] = [
    buildScannedPlugin({ id: 'plugin-shaper', name: 'Shaper', descriptorId: 'com.discovery.shaper' }),
    buildScannedPlugin({ id: 'plugin-widener', name: 'Widener', descriptorId: 'com.discovery.widener' }),
];

const presetDiscoveryManifestOverride = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        getAgentPresetDiscoveryManifest: () =>
            presetDiscoveryManifestOverride.value ?? actual.getAgentPresetDiscoveryManifest(),
    };
});

function seedProject(): void {
    const drums = createTrack({ id: 'track-drums', name: 'Drums', kind: 'audio' });
    const bass = createTrack({ id: 'track-bass', name: 'Bass DI', kind: 'audio' });
    drums.clips = [
        {
            id: 'clip-drums-verse',
            trackId: drums.id,
            name: 'Verse drums',
            startBeat: 0,
            endBeat: 16,
            type: 'audio',
            audioBufferId: 'buffer-drums',
            assetHash: 'asset-drums',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '',
            locked: false,
            muted: false,
        },
    ];
    bass.clips = [
        {
            id: 'clip-bass-chorus',
            trackId: bass.id,
            name: 'Chorus bass',
            startBeat: 16,
            endBeat: 24,
            type: 'audio',
            audioBufferId: 'buffer-bass',
            assetHash: 'asset-bass',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '',
            locked: false,
            muted: false,
        },
        {
            id: 'clip-bass-midi',
            trackId: bass.id,
            name: 'Chorus line',
            startBeat: 24,
            endBeat: 32,
            type: 'midi',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '',
            locked: false,
            muted: false,
        },
    ];

    setTrackStoreState({ ...structuredClone(defaultTrackState), tracks: [drums, bass] });
    projectStore.set({
        ...structuredClone(defaultProjectStoreState),
        projectId: DISCOVERY_PROJECT_ID,
        name: 'Discovery Project',
    });
}

function buildReadyRoot(fileCount: number): LibraryState['roots'][number] {
    return {
        id: LIBRARY_ROOT_ID,
        name: 'User Library',
        provider: 'desktop',
        rootRef: '',
        connectedAt: 0,
        status: 'ready',
        fileCount,
        settings: { recursive: true },
    };
}

function seedLibrary(samples: LibrarySample[], roots: 'ready' | 'none' = 'ready'): void {
    const state = libraryStore.value;
    if (!state) {
        throw new Error('The sample library store carries no state to seed.');
    }
    libraryStore.set({
        ...state,
        roots: roots === 'none' ? [] : [buildReadyRoot(samples.length)],
        samples,
        folderTrees: {},
    });
}

function seedPluginScan(scannedPlugins: ScannedPluginRecord[]): void {
    pluginScanStore.set({ ...structuredClone(defaultPluginScanState), scannedPlugins, lastScanTime: 1_000 });
}

function registerCapabilityCatalog(extraIds: readonly string[] = []): void {
    agentCapabilityDiscoveryPort.setProvider(() => ({
        version: 'discovery-capability-catalog-v1',
        entries: [
            {
                id: 'query:object',
                name: 'object',
                availability: 'available',
                reason: null,
                version: '1',
                evidence: { surface: 'protocol-contract', owner: 'query' },
            },
            {
                id: 'agent.media.listen',
                name: 'agent.media.listen',
                availability: 'unavailable',
                reason: 'deferred',
                version: null,
                evidence: { surface: 'application-tool', owner: 'AiRuntime' },
            },
            ...extraIds.map((id) => ({
                id,
                name: id,
                availability: 'available' as const,
                reason: null,
                version: '1',
                evidence: { surface: 'protocol-contract', owner: 'query' },
            })),
        ],
    }));
}

/** Every entry the domain answers with, counted by walking its own cursors. */
function walkEveryMatch(probe: DomainProbe): number {
    let cursor: string | null = null;
    let seen = 0;
    do {
        const page = expectReceipt(
            queryAgentDiscovery({
                domain: probe.domain,
                filters: probe.filters,
                page: cursor === null ? { limit: 50 } : { limit: 50, cursor },
            })
        );
        seen += page.items.length;
        cursor = page.nextCursor;
    } while (cursor !== null);
    return seen;
}

/** Narrow an answer to its receipt branch, failing loudly on any other status. */
function expectReceipt(result: AgentDiscoveryResult) {
    if (result.status !== 'receipt') {
        throw new Error(`Expected a discovery receipt but the query answered "${result.status}".`);
    }
    return result.receipt;
}

function builtinDeviceTypes(): string[] {
    return getAgentBuiltinDeviceFactoryManifest().map((descriptor) => descriptor.type);
}

let savedPresetId: string | null = null;

type DomainProbe = {
    domain: AgentDiscoveryDomain;
    filters?: AgentDiscoveryFilters;
    /** The ids the owning producer publishes right now, read from that owner. */
    publishedIds: () => string[];
    /** A change to the producer's own state, never to the query layer. */
    changeProducer: () => Promise<void> | void;
};

const DOMAIN_PROBES: DomainProbe[] = [
    {
        domain: 'device',
        publishedIds: () => [
            ...builtinDeviceTypes(),
            ...getAgentDeviceFactoryManifest().devices.map((device) => device.type),
        ],
        changeProducer: () => {
            seedPluginScan([]);
        },
    },
    {
        domain: 'preset',
        publishedIds: () => [...getFactoryPresets(), ...getUserPresets()].map((preset) => preset.id),
        changeProducer: () => {
            savedPresetId =
                saveCurrentAsPreset({ name: 'Discovery Probe', category: 'bass', trackKind: 'midi', devices: [] })
                    ?.id ?? null;
        },
    },
    {
        domain: 'sample',
        filters: { text: SAMPLE_TEXT },
        publishedIds: () => {
            const result = searchAgentCatalog({ text: SAMPLE_TEXT });
            return result.status === 'results' ? result.items.map((item) => item.id) : [];
        },
        changeProducer: () => {
            seedLibrary([
                ...SEEDED_SAMPLES,
                buildSample({ id: 'sample-kick-c', displayName: 'Kick C', status: 'indexed' }),
            ]);
        },
    },
    {
        domain: 'asset',
        publishedIds: () =>
            (trackStore.value?.tracks ?? [])
                .flatMap((track) => track.clips.map((clip) => clip.audioBufferId))
                .filter((id): id is string => typeof id === 'string'),
        changeProducer: async () => {
            const expectedGain = trackStore.value?.tracks.find((track) => track.id === 'track-bass')?.gain;
            if (expectedGain === undefined) {
                throw new Error('The seeded bass track carries no gain to change.');
            }
            await executeAppAction({
                type: 'setTrackGain',
                payload: { trackId: 'track-bass', gain: 0.42, expectedGain },
            });
        },
    },
    {
        domain: 'capability',
        publishedIds: () => agentCapabilityDiscoveryPort.read()?.entries.map((entry) => entry.id) ?? [],
        changeProducer: () => {
            registerCapabilityCatalog(['query:diff']);
        },
    },
];

describe('agent domain query conformance', () => {
    let indexedDb: TransactionalIndexedDbInstallation | null = null;

    beforeEach(async () => {
        presetDiscoveryManifestOverride.value = null;
        // jsdom ships no Web Locks API, and the durable reset the project
        // bootstrap performs sequences on it.
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        indexedDb = installTransactionalIndexedDb();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        await createCrdtProject('Discovery Project');
        seedProject();
        seedPluginScan(SCANNED_PLUGINS);
        seedLibrary(SEEDED_SAMPLES);
        registerCapabilityCatalog();
    });

    afterEach(async () => {
        agentCapabilityDiscoveryPort.setProvider(null);
        pluginScanStore.set(structuredClone(defaultPluginScanState));
        seedLibrary([], 'none');
        if (savedPresetId !== null) {
            deleteUserPreset(savedPresetId);
            savedPresetId = null;
        }
        await indexedDb?.dispose();
        vi.unstubAllGlobals();
        indexedDb = null;
    });

    for (const probe of DOMAIN_PROBES) {
        it(`answers ${probe.domain} discovery with a bounded page of owner-published ids`, () => {
            const published = probe.publishedIds();
            const receipt = expectReceipt(queryAgentDiscovery({ domain: probe.domain, filters: probe.filters }));

            expect(published.length).toBeGreaterThan(1);
            expect(receipt).toMatchObject({
                schema: 'sourdaw.agent-discovery-receipt',
                schemaVersion: 1,
                domain: probe.domain,
            });
            expect(receipt.revisionToken.length).toBeGreaterThan(0);
            expect(receipt.items.length).toBeLessThanOrEqual(receipt.page.limit);
            expect(receipt.page.total).toBeGreaterThanOrEqual(receipt.items.length);
            expect(receipt.items.length).toBeGreaterThan(0);
            for (const item of receipt.items) {
                expect(published).toContain(item.id);
                expect(item.domain).toBe(probe.domain);
            }
        });

        it(`moves the ${probe.domain} revision token only when that producer changes`, async () => {
            const query = () => expectReceipt(queryAgentDiscovery({ domain: probe.domain, filters: probe.filters }));
            const before = query().revisionToken;

            expect(query().revisionToken).toBe(before);

            await probe.changeProducer();

            expect(query().revisionToken).not.toBe(before);
        });

        it(`pages ${probe.domain} discovery and refuses a cursor minted against an older revision`, async () => {
            const first = expectReceipt(
                queryAgentDiscovery({ domain: probe.domain, filters: probe.filters, page: { limit: 1 } })
            );

            const walked = walkEveryMatch(probe);

            expect(walked).toBeGreaterThan(1);
            expect(first.items).toHaveLength(1);
            // The page counts every match, not the slice this page returned.
            expect(first.page.total).toBe(walked);
            expect(first.nextCursor).toEqual(expect.any(String));
            expect(() =>
                queryAgentDiscovery({ domain: probe.domain, filters: probe.filters, page: { limit: 51 } })
            ).toThrow('page limit');

            const second = expectReceipt(
                queryAgentDiscovery({
                    domain: probe.domain,
                    filters: probe.filters,
                    page: { limit: 1, cursor: first.nextCursor! },
                })
            );

            expect(second.page.offset).toBe(1);
            expect(second.items[0]?.id).not.toBe(first.items[0]?.id);

            await probe.changeProducer();

            expect(() =>
                queryAgentDiscovery({
                    domain: probe.domain,
                    filters: probe.filters,
                    page: { limit: 1, cursor: first.nextCursor! },
                })
            ).toThrow('stale semantic query cursor');
        });
    }

    it('reports a domain it does not answer as unsupported rather than empty', () => {
        expect(queryAgentDiscovery({ domain: 'track' })).toEqual({
            status: 'unsupported',
            domain: 'track',
            reason: 'unknown-domain',
        });
    });

    it('separates a sample browse it cannot answer from a catalog it cannot read', () => {
        expect(queryAgentDiscovery({ domain: 'sample' })).toEqual({
            status: 'unsupported',
            domain: 'sample',
            reason: 'sample-browse-requires-text',
        });
        expect(queryAgentDiscovery({ domain: 'sample', filters: { text: '   ' } })).toEqual({
            status: 'unsupported',
            domain: 'sample',
            reason: 'sample-browse-requires-text',
        });

        seedLibrary([], 'none');

        expect(queryAgentDiscovery({ domain: 'sample', filters: { text: SAMPLE_TEXT } })).toEqual({
            status: 'unavailable',
            domain: 'sample',
            reason: 'catalog-not-indexed',
        });
    });

    it('answers an operable library that matched nothing with an empty receipt, not an unavailable catalog', () => {
        seedLibrary([]);

        const receipt = expectReceipt(queryAgentDiscovery({ domain: 'sample', filters: { text: SAMPLE_TEXT } }));

        expect(receipt.items).toEqual([]);
        expect(receipt.page.total).toBe(0);
    });

    it('reports an unregistered capability provider as unavailable, and an empty one as an empty receipt', () => {
        agentCapabilityDiscoveryPort.setProvider(null);

        expect(queryAgentDiscovery({ domain: 'capability' })).toEqual({
            status: 'unavailable',
            domain: 'capability',
            reason: 'capability-provider-unregistered',
        });

        agentCapabilityDiscoveryPort.setProvider(() => ({ version: 'discovery-empty-v1', entries: [] }));
        const receipt = expectReceipt(queryAgentDiscovery({ domain: 'capability' }));

        expect(receipt.items).toEqual([]);
        expect(receipt.page.total).toBe(0);
    });

    it('refuses a kind filter on a domain whose producer publishes no kind vocabulary', () => {
        expect(queryAgentDiscovery({ domain: 'sample', filters: { text: SAMPLE_TEXT, kind: 'drums' } })).toEqual({
            status: 'unsupported',
            domain: 'sample',
            reason: 'filter-not-supported',
        });
        expect(queryAgentDiscovery({ domain: 'asset', filters: { kind: 'audio' } })).toEqual({
            status: 'unsupported',
            domain: 'asset',
            reason: 'filter-not-supported',
        });
    });

    it('keeps the unavailable verdict each producer published instead of dropping the entry', () => {
        vi.mocked(getAgentBuiltinDeviceRuntimeManifest).mockReturnValueOnce([]);

        const devices = expectReceipt(queryAgentDiscovery({ domain: 'device', page: { limit: 50 } }));

        expect(devices.items.filter((item) => item.availability === 'unavailable').length).toBeGreaterThan(0);

        const capabilities = expectReceipt(queryAgentDiscovery({ domain: 'capability' }));

        expect(capabilities.items.find((item) => item.id === 'agent.media.listen')).toMatchObject({
            availability: 'unavailable',
            reason: 'deferred',
        });
    });

    it('reports every sample the catalog answered with as available, whatever index state its record carries', () => {
        const receipt = expectReceipt(queryAgentDiscovery({ domain: 'sample', filters: { text: SAMPLE_TEXT } }));

        expect(receipt.items.map((item) => item.id).toSorted()).toEqual(
            SEEDED_SAMPLES.map((sample) => sample.id).toSorted()
        );
        for (const item of receipt.items) {
            expect(item).toMatchObject({ availability: 'available', reason: null });
        }
        expect(receipt.items.find((item) => item.id === 'sample-kick-a')?.evidence).toMatchObject({
            provenance: { indexStatus: 'discovered' },
        });
    });

    it('counts every match the catalog returned in one sample page', () => {
        const matches = Array.from({ length: 12 }, (_, index) =>
            buildSample({
                id: `sample-kick-${String(index)}`,
                displayName: `Kick ${String(index)}`,
                status: 'discovered',
            })
        );
        seedLibrary(matches);

        expect(searchAgentCatalog({ text: SAMPLE_TEXT, limit: AGENT_DISCOVERY_SAMPLE_QUERY_LIMIT }).status).toBe(
            'results'
        );

        const receipt = expectReceipt(queryAgentDiscovery({ domain: 'sample', filters: { text: SAMPLE_TEXT } }));

        expect(receipt.page).toEqual({ offset: 0, limit: 20, total: 12 });
        expect(receipt.items).toHaveLength(12);
        expect(receipt.warnings).not.toContain('sample-catalog-truncated');
    });

    it('refuses an id filter on the sample catalog it can only apply to one ranked page', () => {
        expect(
            queryAgentDiscovery({ domain: 'sample', filters: { text: SAMPLE_TEXT, stableId: 'sample-kick-a' } })
        ).toEqual({
            status: 'unsupported',
            domain: 'sample',
            reason: 'filter-not-supported',
        });
    });

    it('moves the device revision token when a producer re-versions an entry it still publishes', () => {
        const runtime = getAgentBuiltinDeviceRuntimeManifest(builtinDeviceTypes());
        const before = expectReceipt(queryAgentDiscovery({ domain: 'device', page: { limit: 50 } }));

        vi.mocked(getAgentBuiltinDeviceRuntimeManifest).mockReturnValueOnce(
            runtime.map((entry, index) =>
                index === 0 ? { ...entry, runtimeVersion: `${entry.runtimeVersion}-probe` } : entry
            )
        );
        const after = expectReceipt(queryAgentDiscovery({ domain: 'device', page: { limit: 50 } }));

        expect(after.items.map((item) => item.id)).toEqual(before.items.map((item) => item.id));
        expect(after.revisionToken).not.toBe(before.revisionToken);
    });

    it('moves the capability revision token when a producer changes only an availability', () => {
        const published = agentCapabilityDiscoveryPort.read()?.entries ?? [];
        const before = expectReceipt(queryAgentDiscovery({ domain: 'capability' }));

        agentCapabilityDiscoveryPort.setProvider(() => ({
            version: 'discovery-capability-catalog-v1',
            entries: published.map((entry) =>
                entry.id === 'query:object' ? { ...entry, availability: 'unavailable' as const } : entry
            ),
        }));
        const after = expectReceipt(queryAgentDiscovery({ domain: 'capability' }));

        expect(after.items.map((item) => item.id)).toEqual(before.items.map((item) => item.id));
        expect(after.revisionToken).not.toBe(before.revisionToken);
    });

    it('reads one page through one cursor however a caller orders the same filters', () => {
        const first = expectReceipt(
            queryAgentDiscovery({ domain: 'device', filters: { kind: 'external', text: 'e' }, page: { limit: 1 } })
        );
        const reordered = expectReceipt(
            queryAgentDiscovery({ domain: 'device', filters: { text: 'e', kind: 'external' }, page: { limit: 1 } })
        );

        expect(first.page.total).toBe(SCANNED_PLUGINS.length);
        expect(reordered.nextCursor).toBe(first.nextCursor);

        const second = expectReceipt(
            queryAgentDiscovery({
                domain: 'device',
                filters: { text: 'e', kind: 'external' },
                page: { limit: 1, cursor: first.nextCursor! },
            })
        );

        expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    });

    it('matches owner-published character tags when the display name does not contain the character', () => {
        const preset = expectReceipt(queryAgentDiscovery({ domain: 'preset', filters: { text: 'tube' } }));
        const device = expectReceipt(queryAgentDiscovery({ domain: 'device', filters: { text: 'tape' } }));

        expect(preset.items.find((item) => item.id === 'fx-dist-warm-overdrive')).toMatchObject({
            name: 'Warm Overdrive',
            evidence: {
                tags: expect.arrayContaining(['tube']),
                deviceTypes: ['builtin-distortion'],
            },
        });
        expect(device.items.find((item) => item.id === 'faust-tape-delay')).toMatchObject({
            evidence: { characterTags: ['tape'] },
        });
    });

    it.each([
        { label: 'metadata-only', version: 'preset-v1:metadata-only-change' },
        { label: 'parameter-only', version: 'preset-v1:parameter-only-change' },
    ])('rejects an older preset cursor after a $label owner reversion', ({ version }) => {
        const first = expectReceipt(queryAgentDiscovery({ domain: 'preset', page: { limit: 1 } }));
        const manifest = getAgentPresetDiscoveryManifest();
        const target = manifest.find((preset) => preset.id === 'fx-rev-plate');
        if (!target || first.nextCursor === null) {
            throw new Error('Expected a page cursor and the authored plate preset.');
        }
        presetDiscoveryManifestOverride.value = manifest.map((preset) => {
            if (preset.id !== target.id) {
                return preset;
            }
            const tags = [...preset.tags];
            if (version.includes('metadata')) {
                tags.push('metadata-probe');
            }
            return { ...preset, tags, version };
        });

        expect(() => queryAgentDiscovery({ domain: 'preset', page: { limit: 1, cursor: first.nextCursor! } })).toThrow(
            'Invalid or stale semantic query cursor'
        );
    });

    it('marks a built-in device unavailable when no runtime factory claims its type', () => {
        vi.mocked(getAgentBuiltinDeviceRuntimeManifest).mockReturnValueOnce([]);

        const receipt = expectReceipt(queryAgentDiscovery({ domain: 'device', page: { limit: 50 } }));
        const builtinTypes = builtinDeviceTypes();
        const builtins = receipt.items.filter((item) => builtinTypes.includes(item.id));

        expect(builtins.length).toBeGreaterThan(0);
        for (const item of builtins) {
            expect(item.availability).toBe('unavailable');
        }
        expect(builtins.some((item) => item.reason === 'runtime-unavailable')).toBe(true);
    });

    it('withholds the external device catalog until a scan has run, keeping the built-in half', () => {
        pluginScanStore.set(structuredClone(defaultPluginScanState));

        const receipt = expectReceipt(queryAgentDiscovery({ domain: 'device', page: { limit: 50 } }));
        const builtinTypes = builtinDeviceTypes();

        expect(receipt.warnings).toContain('plugin-scan-not-run');
        expect(receipt.items.every((item) => builtinTypes.includes(item.id))).toBe(true);
        expect(receipt.items.length).toBeGreaterThan(0);
    });

    it('names assets by the ids the project index holds and by nothing it invented', () => {
        const receipt = expectReceipt(queryAgentDiscovery({ domain: 'asset' }));

        expect(receipt.items.map((item) => item.id).toSorted()).toEqual(['buffer-bass', 'buffer-drums']);
        expect(receipt.items.find((item) => item.id === 'buffer-drums')?.evidence).toMatchObject({
            source: 'semantic-project-index',
            contentAddress: 'asset-drums',
            clipIds: ['clip-drums-verse'],
        });

        const filtered = expectReceipt(queryAgentDiscovery({ domain: 'asset', filters: { stableId: 'buffer-bass' } }));

        expect(filtered.items.map((item) => item.id)).toEqual(['buffer-bass']);
        expect(filtered.page.total).toBe(1);
    });

    it('publishes discovery on its own protocol contract, leaving the semantic query types alone', () => {
        const contracts = getProjectProtocolContracts();

        expect(contracts.discovery.operations.map((operation) => operation.name)).toEqual([...AGENT_DISCOVERY_DOMAINS]);
        expect(contracts.discovery.capabilities).toContain('owner-catalog-discovery');
        expect(contracts.query.operations.map((operation) => operation.name)).toEqual([
            ...SEMANTIC_PROJECT_QUERY_TYPES,
        ]);
        expect(contracts.query.capabilities).not.toContain('owner-catalog-discovery');
    });
});
