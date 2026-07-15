import { describe, it, expect, vi, beforeEach } from 'vitest';

import { glutenMeterStore, updateGlutenMeters } from '#/modules/Gluten/stores';
import { createGrandBouleStore, createDefaultGrandBouleState } from '#/modules/GrandBoule/stores';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';

const mocks = vi.hoisted(() => ({
    resetArrangementStoresForProject: vi.fn(),
    transportStoreSet: vi.fn(),
    automationStoreSet: vi.fn(),
    midiStoreSet: vi.fn(),
    tempoMapStoreSet: vi.fn(),
    timeSignatureMapStoreSet: vi.fn(),
    setSidechainRoutes: vi.fn(),
    grinderStoreSet: vi.fn(),
    grinderTelemetryStoreSet: vi.fn(),
    arrangementStoreSet: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    resetArrangementStoresForProject: mocks.resetArrangementStoresForProject,
}));

vi.mock('#/modules/Automation/stores/automationStore', () => ({
    automationStore: { set: mocks.automationStoreSet },
}));

vi.mock('#/modules/MIDI/stores/midiStore', () => ({
    midiStore: { set: mocks.midiStoreSet },
}));

vi.mock('#/modules/Routing/useCases/sidechain/setSidechainRoutes', () => ({
    setSidechainRoutes: mocks.setSidechainRoutes,
}));

vi.mock('#/modules/Grinder/stores/grinderStore', () => ({
    grinderStore: { set: mocks.grinderStoreSet },
}));

vi.mock('#/modules/Grinder/stores/grinderTelemetryStore', () => ({
    grinderTelemetryStore: { set: mocks.grinderTelemetryStoreSet },
}));

vi.mock('#/modules/Transport/stores/transportStore', () => ({
    transportStore: { set: mocks.transportStoreSet },
}));

vi.mock('#/modules/Transport/stores/tempoMapStore', () => ({
    tempoMapStore: { set: mocks.tempoMapStoreSet },
}));

vi.mock('#/modules/Transport/stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: { set: mocks.timeSignatureMapStoreSet },
}));

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
        mocks.automationStoreSet.mockClear();
        mocks.midiStoreSet.mockClear();
        mocks.tempoMapStoreSet.mockClear();
        mocks.timeSignatureMapStoreSet.mockClear();
        mocks.setSidechainRoutes.mockClear();
        mocks.grinderStoreSet.mockClear();
        mocks.grinderTelemetryStoreSet.mockClear();
        mocks.arrangementStoreSet.mockClear();
    });

    it('should reset arrangement, transport, automation, MIDI, and routing stores', () => {
        resetModuleStoresToDefault();

        expect(mocks.resetArrangementStoresForProject).toHaveBeenCalledTimes(1);
        expect(mocks.transportStoreSet).toHaveBeenCalledWith(defaultTransportState);
        expect(mocks.automationStoreSet).toHaveBeenCalledWith({ lanes: [] });
        expect(mocks.midiStoreSet).toHaveBeenCalledWith({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        expect(mocks.tempoMapStoreSet).toHaveBeenCalledWith({ changes: [] });
        expect(mocks.timeSignatureMapStoreSet).toHaveBeenCalledWith({ changes: [] });
        expect(mocks.setSidechainRoutes).toHaveBeenCalledWith([]);
        expect(mocks.arrangementStoreSet).toHaveBeenCalledWith({
            arrangements: [],
            activeArrangementId: 'default-arrangement',
        });
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
