import { describe, it, expect, vi, beforeEach } from 'vitest';

import { projectCrdtToStores } from '../projectProjection';

const mocks = vi.hoisted(() => ({
    trackStore: { hydrate: vi.fn() },
    automationStore: { hydrate: vi.fn() },
    midiStore: { hydrate: vi.fn() },
    transportStore: { hydrate: vi.fn() },
    tempoMapStore: { hydrate: vi.fn() },
    timeSignatureMapStore: { hydrate: vi.fn() },
    markerStore: { hydrate: vi.fn() },
    takeLaneStore: { hydrate: vi.fn() },
    arrangementStore: { hydrate: vi.fn() },
    projectStore: { hydrate: vi.fn() },
    cvGateStore: { hydrate: vi.fn() },
    actionHistoryStore: { hydrate: vi.fn() },
    hydrateSidechainRoutes: vi.fn(),
}));

vi.mock('../../../stores/actionHistoryStore', () => {
    return { actionHistoryStore: mocks.actionHistoryStore };
});

// Mock Arrangement stores
vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...actual,
        trackStore: mocks.trackStore,
        markerStore: mocks.markerStore,
        takeLaneStore: mocks.takeLaneStore,
    };
});

// Mock Automation
vi.mock('#/modules/Automation/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Automation/stores')>();
    return {
        ...actual,
        automationStore: mocks.automationStore,
    };
});

// Mock MIDI
vi.mock('#/modules/MIDI/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/MIDI/stores')>();
    return {
        ...actual,
        midiStore: mocks.midiStore,
    };
});

// Mock Project
vi.mock('#/modules/Project/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Project/stores')>();
    return {
        ...actual,
        arrangementStore: mocks.arrangementStore,
        projectStore: mocks.projectStore,
    };
});

// Mock Routing
vi.mock('#/modules/Routing/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Routing/useCases')>();
    return {
        ...actual,
        hydrateSidechainRoutes: mocks.hydrateSidechainRoutes,
    };
});

// Mock Synth
vi.mock('#/modules/Synth/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Synth/stores')>();
    return {
        ...actual,
        cvGateStore: mocks.cvGateStore,
    };
});

// Mock Transport
vi.mock('#/modules/Transport/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/stores')>();
    return {
        ...actual,
        transportStore: mocks.transportStore,
        tempoMapStore: mocks.tempoMapStore,
        timeSignatureMapStore: mocks.timeSignatureMapStore,
    };
});

describe('projectCrdtToStores', () => {
    beforeEach(() => vi.clearAllMocks());

    it('calls hydrate on all project stores and hydrates sidechain routes', () => {
        projectCrdtToStores();

        expect(mocks.trackStore.hydrate).toHaveBeenCalledTimes(1);
        expect(mocks.automationStore.hydrate).toHaveBeenCalledTimes(1);
        expect(mocks.midiStore.hydrate).toHaveBeenCalledTimes(1);
        expect(mocks.transportStore.hydrate).toHaveBeenCalledTimes(1);
        expect(mocks.tempoMapStore.hydrate).toHaveBeenCalledTimes(1);
        expect(mocks.timeSignatureMapStore.hydrate).toHaveBeenCalledTimes(1);
        expect(mocks.markerStore.hydrate).toHaveBeenCalledTimes(1);
        expect(mocks.takeLaneStore.hydrate).toHaveBeenCalledTimes(1);
        expect(mocks.arrangementStore.hydrate).toHaveBeenCalledTimes(1);
        expect(mocks.projectStore.hydrate).toHaveBeenCalledTimes(1);
        expect(mocks.cvGateStore.hydrate).toHaveBeenCalledTimes(1);
        expect(mocks.actionHistoryStore.hydrate).toHaveBeenCalledTimes(1);

        expect(mocks.hydrateSidechainRoutes).toHaveBeenCalledTimes(1);
    });
});
