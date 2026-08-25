import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { modulationStore, type ModulationStoreState } from '#/modules/Automation/stores';

import { projectCrdtToStores } from '../projectProjection';

// Audit CC-4 reproduction. `modulationStore` persists to the CRDT root doc slot
// `modulation`, but `projectCrdtToStores` must also read it back — otherwise the
// slot is a write-only truth cell: every modulator/mapping the user configures
// is silently lost on the next reload and never received from a collaboration
// peer. This spec isolates the modulation slot by mocking every sibling
// projection consumer to a no-op, so the only store exercised through the real
// projection is the real `modulationStore`.

const mocks = vi.hoisted(() => ({
    trackStore: { hydrate: vi.fn(), subscribe: vi.fn(() => () => {}) },
    automationStore: { hydrate: vi.fn() },
    transportStore: { hydrate: vi.fn() },
    tempoMapStore: { hydrate: vi.fn() },
    timeSignatureMapStore: { hydrate: vi.fn() },
    markerStore: { hydrate: vi.fn() },
    takeLaneStore: { hydrate: vi.fn() },
    arrangementStore: { hydrate: vi.fn() },
    projectStore: { hydrate: vi.fn() },
    cvGateStore: { hydrate: vi.fn() },
    actionHistoryStore: { hydrate: vi.fn() },
    hydrateYeastCrdtProjection: vi.fn(),
    hydrateKneadFromTrackStore: vi.fn(),
    hydrateSidechainRoutes: vi.fn(),
}));

vi.mock('../../../stores/actionHistoryStore', () => ({ actionHistoryStore: mocks.actionHistoryStore }));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...actual,
        trackStore: mocks.trackStore,
        markerStore: mocks.markerStore,
        takeLaneStore: mocks.takeLaneStore,
    };
});

vi.mock('#/modules/Automation/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Automation/stores')>();
    // Keep the REAL modulationStore — it is the store under test.
    return { ...actual, automationStore: mocks.automationStore };
});

vi.mock('#/modules/Yeast/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Yeast/useCases')>();
    return { ...actual, hydrateYeastCrdtProjection: mocks.hydrateYeastCrdtProjection };
});

vi.mock('#/modules/Knead/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Knead/useCases')>();
    return { ...actual, hydrateKneadFromTrackStore: mocks.hydrateKneadFromTrackStore };
});

vi.mock('#/modules/Routing/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Routing/useCases')>();
    return { ...actual, hydrateSidechainRoutes: mocks.hydrateSidechainRoutes };
});

vi.mock('#/modules/Project/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Project/stores')>();
    return { ...actual, arrangementStore: mocks.arrangementStore, projectStore: mocks.projectStore };
});

vi.mock('#/modules/CvGate/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/CvGate/stores')>();
    return { ...actual, cvGateStore: mocks.cvGateStore };
});

vi.mock('#/modules/Transport/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/stores')>();
    return {
        ...actual,
        transportStore: mocks.transportStore,
        tempoMapStore: mocks.tempoMapStore,
        timeSignatureMapStore: mocks.timeSignatureMapStore,
    };
});

type TestDoc = { [key: string]: unknown };
type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

const fakeDoc: TestDoc = {};

function clearFakeDoc(): void {
    for (const key of Object.keys(fakeDoc)) {
        delete fakeDoc[key];
    }
}

function configureFakePort(): void {
    const port: TestPort = {
        getDoc: () => fakeDoc,
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            changeFn(fakeDoc);
        },
    };
    configureAutomergeStoragePort(port);
}

function flushPendingFrame(): Promise<void> {
    return new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
            resolve();
        });
    });
}

const validModulator = {
    id: 'mod-lfo-1',
    name: 'Slow LFO',
    trackId: 'track-1',
    kind: 'lfo',
    config: { kind: 'lfo', waveform: 'sine', rate: 4, sync: true, phase: 0, depth: 0.5 },
    mappings: [{ targetTrackId: 'track-1', targetDeviceId: 'device-1', targetParamId: 'gain', amount: 0.25 }],
    enabled: true,
} satisfies ModulationStoreState['modulators'][number];

const validState: ModulationStoreState = { modulators: [validModulator] };

describe('projectCrdtToStores — modulation slot survival (audit CC-4)', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        modulationStore.set({ modulators: [] });
        await flushPendingFrame();
        clearFakeDoc();
        configureFakePort();
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
    });

    it('writes modulation edits into the document slot', async () => {
        modulationStore.set(validState);
        await flushPendingFrame();

        expect(fakeDoc.modulation).toEqual(validState);
    });

    it('recovers a persisted/received modulation slot on projection rebuild', () => {
        // Fresh session or remote peer: the store cache is empty while the
        // document already holds the modulation slot. Projection must bridge
        // the two — on main it never does, so the store stays empty (data loss).
        expect(modulationStore.value).toEqual({ modulators: [] });
        fakeDoc.modulation = validState;

        projectCrdtToStores();

        expect(modulationStore.value).toEqual(validState);
    });
});
