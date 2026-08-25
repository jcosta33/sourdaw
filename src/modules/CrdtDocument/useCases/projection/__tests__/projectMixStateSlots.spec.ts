import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import {
    gainEnvelopeStore,
    vcaGroupStore,
    type GainEnvelopeStoreState,
    type VcaGroupState,
} from '#/modules/Arrangement/stores';

import { projectCrdtToStores } from '../projectProjection';

// Reproduction for the CRDT half of survey item #3, the same defect shape as
// `projectModulationSlot.spec.ts`. A file open restores VCA masters and clip
// gain envelopes (`buildProjectData` / `hydrateModuleStoresFromProjectData`),
// but a tab reload restores from the CRDT document — and neither store was
// document-backed, so a group faded to −6 dB returned at unity, 6 dB hot, live
// and in the bounce.
//
// Two directions, both required:
//   1. a live mix edit reaches the document slot (otherwise nothing is saved);
//   2. a document that already carries the slot reaches the store on rebuild
//      (otherwise nothing is read back, and the slot is a write-only truth
//      cell).
//
// Sibling projection consumers are stubbed so the only stores driven through
// the real `projectCrdtToStores` are the two real stores under test.

const mocks = vi.hoisted(() => ({
    trackStore: { hydrate: vi.fn(), subscribe: vi.fn(() => () => {}) },
    markerStore: { hydrate: vi.fn() },
    takeLaneStore: { hydrate: vi.fn() },
    automationStore: { hydrate: vi.fn() },
    modulationStore: { hydrate: vi.fn() },
    transportStore: { hydrate: vi.fn() },
    tempoMapStore: { hydrate: vi.fn() },
    timeSignatureMapStore: { hydrate: vi.fn() },
    arrangementStore: { hydrate: vi.fn() },
    projectStore: { hydrate: vi.fn() },
    cvGateStore: { hydrate: vi.fn() },
    kneadStore: { hydrate: vi.fn() },
    midiStore: { hydrate: vi.fn() },
    chordTrackStore: { hydrate: vi.fn() },
    grooveTemplateStore: { hydrate: vi.fn() },
    sidechainStore: { hydrate: vi.fn() },
    yeastStore: { hydrate: vi.fn() },
    actionHistoryStore: { hydrate: vi.fn() },
    hydrateYeastCrdtProjection: vi.fn(),
    hydrateKneadFromTrackStore: vi.fn(),
    hydrateSidechainRoutes: vi.fn(),
}));

vi.mock('../../../stores/actionHistoryStore', () => ({ actionHistoryStore: mocks.actionHistoryStore }));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    // Keep the REAL vcaGroupStore and gainEnvelopeStore — they are under test.
    return {
        ...actual,
        trackStore: mocks.trackStore,
        markerStore: mocks.markerStore,
        takeLaneStore: mocks.takeLaneStore,
    };
});

vi.mock('#/modules/Automation/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Automation/stores')>();
    return { ...actual, automationStore: mocks.automationStore, modulationStore: mocks.modulationStore };
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

vi.mock('#/modules/Project/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Project/stores')>();
    return { ...actual, arrangementStore: mocks.arrangementStore, projectStore: mocks.projectStore };
});

vi.mock('#/modules/CvGate/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/CvGate/stores')>();
    return { ...actual, cvGateStore: mocks.cvGateStore };
});

vi.mock('#/modules/Knead/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Knead/stores')>();
    return { ...actual, kneadStore: mocks.kneadStore };
});

vi.mock('#/modules/MIDI/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/MIDI/stores')>();
    return {
        ...actual,
        midiStore: mocks.midiStore,
        chordTrackStore: mocks.chordTrackStore,
        grooveTemplateStore: mocks.grooveTemplateStore,
    };
});

vi.mock('#/modules/Routing/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Routing/stores')>();
    return { ...actual, sidechainStore: mocks.sidechainStore };
});

vi.mock('#/modules/Yeast/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Yeast/stores')>();
    return { ...actual, yeastStore: mocks.yeastStore };
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

/** −6 dB, the fade the survey report names. */
const MINUS_SIX_DB = 0.5011872336272722;

const vcaState: VcaGroupState = {
    groups: [{ id: 'vca-drums', name: 'Drums', gain: MINUS_SIX_DB, muted: false, trackIds: ['track-kick'] }],
};

const envelopeState: GainEnvelopeStoreState = {
    envelopes: {
        'clip-1': {
            clipId: 'clip-1',
            enabled: true,
            points: [
                { id: 'point-a', beatOffset: 0, gainDb: -3 },
                { id: 'point-b', beatOffset: 4, gainDb: 2.5 },
            ],
        },
    },
};

describe('projectCrdtToStores — mix state slot survival', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        vcaGroupStore.set({ groups: [] });
        gainEnvelopeStore.set({ envelopes: {} });
        await flushPendingFrame();
        clearFakeDoc();
        configureFakePort();
    });

    afterEach(async () => {
        configureAutomergeStoragePort(null);
        vcaGroupStore.set({ groups: [] });
        gainEnvelopeStore.set({ envelopes: {} });
        await flushPendingFrame();
        configureAutomergeStoragePort(null);
    });

    it('writes a VCA group fade into the document slot', async () => {
        vcaGroupStore.set(vcaState);
        await flushPendingFrame();

        expect(fakeDoc.vcaGroups).toEqual(vcaState);
    });

    it('recovers a persisted VCA group fade on projection rebuild', () => {
        // Tab reload: the store cache is empty while the document already holds
        // the mix. Projection must bridge the two — before the fix it never
        // does, so the −6 dB submix returns at unity.
        expect(vcaGroupStore.value).toEqual({ groups: [] });
        fakeDoc.vcaGroups = vcaState;

        projectCrdtToStores();

        expect(vcaGroupStore.value).toEqual(vcaState);
        expect(vcaGroupStore.value?.groups[0]?.gain).toBe(MINUS_SIX_DB);
    });

    it('writes clip gain envelope edits into the document slot', async () => {
        gainEnvelopeStore.set(envelopeState);
        await flushPendingFrame();

        expect(fakeDoc.gainEnvelopes).toEqual(envelopeState);
    });

    it('recovers persisted clip gain envelopes on projection rebuild', () => {
        expect(gainEnvelopeStore.value).toEqual({ envelopes: {} });
        fakeDoc.gainEnvelopes = envelopeState;

        projectCrdtToStores();

        expect(gainEnvelopeStore.value).toEqual(envelopeState);
        expect(gainEnvelopeStore.value?.envelopes['clip-1']?.points[1]?.gainDb).toBe(2.5);
    });

    it('clears the outgoing project mix state when the document carries no slot', () => {
        // A document without the slot must reset the store, not leave the
        // previous project's masters attenuating the incoming one's tracks.
        vcaGroupStore.set(vcaState);
        gainEnvelopeStore.set(envelopeState);
        clearFakeDoc();

        projectCrdtToStores();

        expect(vcaGroupStore.value).toEqual({ groups: [] });
        expect(gainEnvelopeStore.value).toEqual({ envelopes: {} });
    });
});
