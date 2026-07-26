import { describe, it, expect, vi, beforeEach } from 'vitest';

import { glutenMeterStore, updateGlutenMeters } from '#/modules/Gluten/stores';
import { createGrandBouleStore, createDefaultGrandBouleState } from '#/modules/GrandBoule/stores';
import { defaultTransportState } from '#/modules/Transport/useCases';

const mocks = vi.hoisted(() => ({
    resetArrangementStoresForProject: vi.fn(),
    transportStoreSet: vi.fn(),
    setMasterGainValue: vi.fn(),
    automationStoreSet: vi.fn(),
    midiStoreSet: vi.fn(),
    resetMidiStoreForProject: vi.fn(),
    hydrateGrooveTemplates: vi.fn(),
    tempoMapStoreSet: vi.fn(),
    timeSignatureMapStoreSet: vi.fn(),
    setSidechainRoutes: vi.fn(),
    grinderStoreSet: vi.fn(),
    grinderTelemetryStoreSet: vi.fn(),
    arrangementStoreSet: vi.fn(),
    hydrateYeastState: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    resetArrangementStoresForProject: mocks.resetArrangementStoresForProject,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return { ...actual, setMasterGainValue: mocks.setMasterGainValue };
});

vi.mock('#/modules/Automation/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Automation/stores')>();
    return { ...actual, automationStore: { set: mocks.automationStoreSet } };
});

vi.mock('#/modules/MIDI/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/MIDI/stores')>();
    return { ...actual, midiStore: { set: mocks.midiStoreSet } };
});

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/MIDI/useCases')>();
    return {
        ...actual,
        hydrateGrooveTemplates: mocks.hydrateGrooveTemplates,
        resetMidiStoreForProject: mocks.resetMidiStoreForProject,
    };
});

vi.mock('#/modules/Yeast/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Yeast/useCases')>();
    return { ...actual, hydrateYeastState: mocks.hydrateYeastState };
});

vi.mock('#/modules/Routing/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Routing/useCases')>();
    return { ...actual, setSidechainRoutes: mocks.setSidechainRoutes };
});

vi.mock('#/modules/Grinder/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Grinder/stores')>();
    return {
        ...actual,
        grinderStore: { set: mocks.grinderStoreSet },
        grinderTelemetryStore: { set: mocks.grinderTelemetryStoreSet },
    };
});

vi.mock('#/modules/Transport/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/stores')>();
    return {
        ...actual,
        transportStore: { set: mocks.transportStoreSet },
        tempoMapStore: { set: mocks.tempoMapStoreSet },
        timeSignatureMapStore: { set: mocks.timeSignatureMapStoreSet },
    };
});

vi.mock('../../../../stores/arrangementStore', () => ({
    arrangementStore: { set: mocks.arrangementStoreSet },
    defaultArrangementStoreState: {
        arrangements: [],
        activeArrangementId: 'default-arrangement',
    },
}));

import { resetModuleStoresToDefault } from '../resetModuleStoresToDefault';

describe('resetModuleStoresToDefault', () => {
    beforeEach(() => {
        mocks.resetArrangementStoresForProject.mockClear();
        mocks.transportStoreSet.mockClear();
        mocks.setMasterGainValue.mockClear();
        mocks.automationStoreSet.mockClear();
        mocks.midiStoreSet.mockClear();
        mocks.resetMidiStoreForProject.mockClear();
        mocks.hydrateGrooveTemplates.mockClear();
        mocks.tempoMapStoreSet.mockClear();
        mocks.timeSignatureMapStoreSet.mockClear();
        mocks.setSidechainRoutes.mockClear();
        mocks.grinderStoreSet.mockClear();
        mocks.grinderTelemetryStoreSet.mockClear();
        mocks.arrangementStoreSet.mockClear();
        mocks.hydrateYeastState.mockClear();
    });

    it('should reset arrangement, transport, automation, MIDI, and routing stores', () => {
        resetModuleStoresToDefault();

        expect(mocks.resetArrangementStoresForProject).toHaveBeenCalledTimes(1);
        expect(mocks.transportStoreSet).toHaveBeenCalledWith(defaultTransportState);
        expect(mocks.setMasterGainValue).toHaveBeenCalledWith(defaultTransportState.masterGain / 100);
        expect(mocks.automationStoreSet).toHaveBeenCalledWith({ lanes: [] });
        expect(mocks.resetMidiStoreForProject).toHaveBeenCalledWith({ generateProbabilitySeed: false });
        expect(mocks.tempoMapStoreSet).toHaveBeenCalledWith({ changes: [] });
        expect(mocks.timeSignatureMapStoreSet).toHaveBeenCalledWith({ changes: [] });
        expect(mocks.setSidechainRoutes).toHaveBeenCalledWith([]);
        expect(mocks.arrangementStoreSet).toHaveBeenCalledWith({
            arrangements: [],
            activeArrangementId: 'default-arrangement',
        });
        expect(mocks.hydrateGrooveTemplates).toHaveBeenCalledWith({ templates: [], assignments: [] });
        expect(mocks.hydrateYeastState).toHaveBeenCalledWith(undefined);
    });

    it('preserves collaborative groove CRDT truth before projecting a loaded document', () => {
        resetModuleStoresToDefault({ resetGrooveTemplates: false, resetYeastState: false });

        expect(mocks.hydrateGrooveTemplates).not.toHaveBeenCalled();
        expect(mocks.hydrateYeastState).not.toHaveBeenCalled();
    });

    it('does not queue a MIDI owner write before project-load hydration', () => {
        resetModuleStoresToDefault({ resetMidiState: false });

        expect(mocks.resetMidiStoreForProject).not.toHaveBeenCalled();
    });

    it('should clear per-device Grinder telemetry so prior-project meters do not linger', () => {
        resetModuleStoresToDefault();

        // grinderStore (persistent patch state) is cleared alongside the volatile
        // telemetry store — both are keyed per device instance and must not leak
        // across a New Project / project load.
        expect(mocks.grinderStoreSet).toHaveBeenCalledWith({});
        expect(mocks.grinderTelemetryStoreSet).toHaveBeenCalledWith({});
    });

    it('should clear per-device Gluten meter telemetry so prior-project meters do not linger', () => {
        // glutenMeterStore is NOT mocked here: it is the real split telemetry
        // store, keyed per device instance. Dirty a device the way a ticking
        // engine would, then assert the reset purges it. Before the fix the
        // reset omitted glutenMeterStore, so this slice survived into the next
        // project and a reopened panel for a reused deviceId showed stale meters.
        updateGlutenMeters('prior-project-device', { grDb: -7, inputDb: -20, outputDb: -13 });
        expect(glutenMeterStore.value?.['prior-project-device']?.grDb).toBe(-7);

        resetModuleStoresToDefault();

        expect(glutenMeterStore.value).toEqual({});
        expect(glutenMeterStore.value?.['prior-project-device']).toBeUndefined();
    });

    it('should clear per-device Grand Boule state so a prior project does not leak into a New Project', () => {
        // Grand Boule is NOT mocked here: it uses a Map of per-device store
        // instances, so the reset must reach every device's slice. Dirty a
        // non-default device the way a loaded project would.
        const store = createGrandBouleStore('prior-project-grand-boule');
        store.set({ ...createDefaultGrandBouleState(), temperament: 4 });
        expect(store.value?.temperament).toBe(4);

        resetModuleStoresToDefault();

        // Before the fix, resetModuleStoresToDefault only reset the 'default'
        // singleton, so this device's state survived into the next project.
        expect(store.value).toEqual(createDefaultGrandBouleState());
        expect(store.value?.temperament).toBe(0);
    });
});
