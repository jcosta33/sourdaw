import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState } from '#/modules/Transport/models/TransportState';

const mocks = vi.hoisted(() => ({
    trackStoreSet: vi.fn(),
    transportStoreSet: vi.fn(),
    automationStoreSet: vi.fn(),
    midiStoreSet: vi.fn(),
    tempoMapStoreSet: vi.fn(),
    timeSignatureMapStoreSet: vi.fn(),
    markerStoreSet: vi.fn(),
    takeLaneStoreSet: vi.fn(),
    setSidechainRoutes: vi.fn(),
    grinderStoreSet: vi.fn(),
    grinderTelemetryStoreSet: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: { set: mocks.trackStoreSet },
}));

vi.mock('#/modules/Arrangement/stores/markerStore', () => ({
    markerStore: { set: mocks.markerStoreSet },
}));

vi.mock('#/modules/Arrangement/stores/takeLaneStore', () => ({
    takeLaneStore: { set: mocks.takeLaneStoreSet },
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

import { resetModuleStoresToDefault } from '../resetModuleStoresToDefault';

describe('resetModuleStoresToDefault', () => {
    beforeEach(() => {
        mocks.trackStoreSet.mockClear();
        mocks.transportStoreSet.mockClear();
        mocks.automationStoreSet.mockClear();
        mocks.midiStoreSet.mockClear();
        mocks.tempoMapStoreSet.mockClear();
        mocks.timeSignatureMapStoreSet.mockClear();
        mocks.markerStoreSet.mockClear();
        mocks.takeLaneStoreSet.mockClear();
        mocks.setSidechainRoutes.mockClear();
        mocks.grinderStoreSet.mockClear();
        mocks.grinderTelemetryStoreSet.mockClear();
    });

    it('should reset arrangement, transport, automation, MIDI, and routing stores', () => {
        resetModuleStoresToDefault();

        expect(mocks.trackStoreSet).toHaveBeenCalledWith({ tracks: [], selectedTrackId: null });
        expect(mocks.transportStoreSet).toHaveBeenCalledWith(defaultTransportState);
        expect(mocks.automationStoreSet).toHaveBeenCalledWith({ lanes: [] });
        expect(mocks.midiStoreSet).toHaveBeenCalledWith({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        expect(mocks.tempoMapStoreSet).toHaveBeenCalledWith({ changes: [] });
        expect(mocks.timeSignatureMapStoreSet).toHaveBeenCalledWith({ changes: [] });
        expect(mocks.markerStoreSet).toHaveBeenCalledWith({ markers: [], sections: [] });
        expect(mocks.takeLaneStoreSet).toHaveBeenCalledWith({ lanes: [] });
        expect(mocks.setSidechainRoutes).toHaveBeenCalledWith([]);
    });

    it('should clear per-device Grinder telemetry so prior-project meters do not linger', () => {
        resetModuleStoresToDefault();

        // grinderStore (persistent patch state) is cleared alongside the volatile
        // telemetry store — both are keyed per device instance and must not leak
        // across a New Project / project load.
        expect(mocks.grinderStoreSet).toHaveBeenCalledWith({});
        expect(mocks.grinderTelemetryStoreSet).toHaveBeenCalledWith({});
    });
});
