import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';
import { type ProjectData } from '../../../../models/ProjectData';

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

vi.mock('#/modules/Transport/stores/transportStore', () => ({
    transportStore: { set: mocks.transportStoreSet },
}));

vi.mock('#/modules/Transport/stores/tempoMapStore', () => ({
    tempoMapStore: { set: mocks.tempoMapStoreSet },
}));

vi.mock('#/modules/Transport/stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: { set: mocks.timeSignatureMapStoreSet },
}));

import { hydrateModuleStoresFromProjectData } from '../hydrateModuleStoresFromProjectData';

describe('hydrateModuleStoresFromProjectData', () => {
    beforeEach(() => {
        Object.values(mocks).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockClear());
    });

    it('should hydrate track and merged transport state', () => {
        const tracks = { tracks: [], selectedTrackId: null } as ProjectData['tracks'];
        const transport = { tempo: 99 } as ProjectData['transport'];
        const data = {
            version: 1,
            name: 'p',
            createdAt: 0,
            updatedAt: 0,
            tracks,
            transport,
            automation: { lanes: [] },
            midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
        } as ProjectData;

        hydrateModuleStoresFromProjectData(data);

        expect(mocks.trackStoreSet).toHaveBeenCalledWith(tracks);
        expect(mocks.transportStoreSet).toHaveBeenCalledWith({
            ...defaultTransportState,
            ...transport,
        });
    });

    it('should set optional stores only when present', () => {
        const data = {
            version: 1,
            name: 'p',
            createdAt: 0,
            updatedAt: 0,
            tracks: { tracks: [], selectedTrackId: null },
            transport: {} as ProjectData['transport'],
            automation: { lanes: [{ id: 'a' }] } as ProjectData['automation'],
            midi: { notesByClipId: { x: [] }, ccByClipId: {}, pitchBendByClipId: {} },
            tempoMap: { changes: [] },
            timeSignatureMap: { changes: [] },
            markers: { markers: [], sections: [] },
            takeLanes: { lanes: [] },
        } as ProjectData;

        hydrateModuleStoresFromProjectData(data);

        expect(mocks.automationStoreSet).toHaveBeenCalledWith(data.automation);
        expect(mocks.midiStoreSet).toHaveBeenCalledWith(data.midi);
        expect(mocks.tempoMapStoreSet).toHaveBeenCalledWith(data.tempoMap);
        expect(mocks.timeSignatureMapStoreSet).toHaveBeenCalledWith(data.timeSignatureMap);
        expect(mocks.markerStoreSet).toHaveBeenCalledWith(data.markers);
        expect(mocks.takeLaneStoreSet).toHaveBeenCalledWith(data.takeLanes);
    });

    it('should not call setSidechainRoutes when routes are absent or empty', () => {
        const base = {
            version: 1,
            name: 'p',
            createdAt: 0,
            updatedAt: 0,
            tracks: { tracks: [], selectedTrackId: null },
            transport: {} as ProjectData['transport'],
            automation: { lanes: [] },
            midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
        } as ProjectData;

        hydrateModuleStoresFromProjectData({ ...base });
        hydrateModuleStoresFromProjectData({ ...base, sidechainRoutes: [] });

        expect(mocks.setSidechainRoutes).not.toHaveBeenCalled();
    });

    it('should forward non-empty sidechain routes', () => {
        const routes = [{ sourceTrackId: 'a', targetTrackId: 'b', amount: 1 }] as ProjectData['sidechainRoutes'];
        const data = {
            version: 1,
            name: 'p',
            createdAt: 0,
            updatedAt: 0,
            tracks: { tracks: [], selectedTrackId: null },
            transport: {} as ProjectData['transport'],
            automation: { lanes: [] },
            midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            sidechainRoutes: routes,
        } as ProjectData;

        hydrateModuleStoresFromProjectData(data);

        expect(mocks.setSidechainRoutes).toHaveBeenCalledWith(routes);
    });
});
