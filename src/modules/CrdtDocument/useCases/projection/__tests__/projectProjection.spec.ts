import { describe, it, expect, vi, beforeEach } from 'vitest';

import { projectCrdtToStores, setupProjectionBridge } from '../projectProjection';

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
    hydrateSidechainRoutes: vi.fn(),
    onChange: vi.fn(),
}));

vi.mock('../../../repositories/automergeRepository', () => ({
    automergeRepository: { onChange: mocks.onChange },
}));

// Mock Arrangement stores
vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    trackStore: mocks.trackStore,
    markerStore: mocks.markerStore,
    takeLaneStore: mocks.takeLaneStore,
}));

// Mock Automation
vi.mock('#/modules/Automation/stores', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    automationStore: mocks.automationStore,
}));

// Mock MIDI
vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    midiStore: mocks.midiStore,
}));

// Mock Project
vi.mock('#/modules/Project/stores', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    arrangementStore: mocks.arrangementStore,
    projectStore: mocks.projectStore,
}));

// Mock Routing
vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    hydrateSidechainRoutes: mocks.hydrateSidechainRoutes,
}));

// Mock Transport
vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    transportStore: mocks.transportStore,
    tempoMapStore: mocks.tempoMapStore,
    timeSignatureMapStore: mocks.timeSignatureMapStore,
}));

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

        expect(mocks.hydrateSidechainRoutes).toHaveBeenCalledTimes(1);
    });
});

describe('setupProjectionBridge docId hint', () => {
    beforeEach(() => vi.clearAllMocks());

    function subscribeAndGetCallback(): (docId?: string) => void {
        setupProjectionBridge();
        expect(mocks.onChange).toHaveBeenCalledTimes(1);
        return mocks.onChange.mock.calls[0][0] as (docId?: string) => void;
    }

    it('re-hydrates on a root-doc change', () => {
        const onChangeCallback = subscribeAndGetCallback();
        onChangeCallback('root');
        expect(mocks.trackStore.hydrate).toHaveBeenCalledTimes(1);
        expect(mocks.projectStore.hydrate).toHaveBeenCalledTimes(1);
        expect(mocks.hydrateSidechainRoutes).toHaveBeenCalledTimes(1);
    });

    it('re-hydrates on a bulk op (undefined hint)', () => {
        const onChangeCallback = subscribeAndGetCallback();
        onChangeCallback(undefined);
        expect(mocks.trackStore.hydrate).toHaveBeenCalledTimes(1);
        expect(mocks.projectStore.hydrate).toHaveBeenCalledTimes(1);
    });

    it('skips the full re-hydrate for a non-root doc (branch / __branches__) change', () => {
        const onChangeCallback = subscribeAndGetCallback();
        onChangeCallback('branch_abc123');
        onChangeCallback('__branches__');
        expect(mocks.trackStore.hydrate).not.toHaveBeenCalled();
        expect(mocks.projectStore.hydrate).not.toHaveBeenCalled();
        expect(mocks.hydrateSidechainRoutes).not.toHaveBeenCalled();
    });
});
