import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ProjectData } from '../../../../models/ProjectData';
import { hydrateModuleStoresFromProjectData } from '../hydrateModuleStoresFromProjectData';

const mocks = vi.hoisted(() => ({
    hydrateTracksForProject: vi.fn(),
    markerStoreSet: vi.fn(),
    automationStoreSet: vi.fn(),
    setSidechainRoutes: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...actual,
        markerStore: { set: mocks.markerStoreSet },
    };
});

vi.mock('#/modules/Arrangement/useCases', () => ({
    hydrateTracksForProject: mocks.hydrateTracksForProject,
}));

vi.mock('#/modules/Automation/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Automation/stores')>();
    return {
        ...actual,
        automationStore: { set: mocks.automationStoreSet },
    };
});

vi.mock('#/modules/Routing/useCases', () => ({
    setSidechainRoutes: mocks.setSidechainRoutes,
}));

describe('hydrateModuleStoresFromProjectData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('leaves arrangement tracks to the active-snapshot hydrator', () => {
        const data = {
            version: 1,
            arrangement: { tracks: [] },
            automation: { lanes: [] },
        } as unknown as ProjectData;

        hydrateModuleStoresFromProjectData(data);

        expect(mocks.hydrateTracksForProject).not.toHaveBeenCalled();
    });

    it('leaves automation lanes to the active-snapshot hydrator', () => {
        const data = {
            version: 1,
            arrangement: { tracks: [] },
            automation: { lanes: [] },
        } as unknown as ProjectData;

        hydrateModuleStoresFromProjectData(data);

        expect(mocks.automationStoreSet).not.toHaveBeenCalled();
    });

    it('leaves markers to the active-snapshot hydrator', () => {
        const data = {
            version: 1,
            arrangement: { tracks: [] },
            automation: { lanes: [] },
            markers: [{ id: 'm1', beat: 0, name: 'Start', color: 'red' }],
        } as unknown as ProjectData;

        hydrateModuleStoresFromProjectData(data);

        expect(mocks.markerStoreSet).not.toHaveBeenCalled();
    });

    it('does not call marker set when markers are absent', () => {
        const data = {
            version: 1,
            arrangement: { tracks: [] },
            automation: { lanes: [] },
        } as unknown as ProjectData;

        hydrateModuleStoresFromProjectData(data);

        expect(mocks.markerStoreSet).not.toHaveBeenCalled();
    });

    it('hydrates sidechain routes through the Routing owner', () => {
        const routes = [
            {
                id: 'route-1',
                sourceTrackId: 'source',
                targetTrackId: 'target',
                targetDeviceId: 'device',
                targetParameterId: 'threshold',
                gain: 1,
            },
        ];
        const data = {
            version: 1,
            arrangement: { tracks: [] },
            automation: { lanes: [] },
            sidechainRoutes: routes,
        } as unknown as ProjectData;

        hydrateModuleStoresFromProjectData(data);

        expect(mocks.setSidechainRoutes).toHaveBeenCalledWith(routes);
    });
});
