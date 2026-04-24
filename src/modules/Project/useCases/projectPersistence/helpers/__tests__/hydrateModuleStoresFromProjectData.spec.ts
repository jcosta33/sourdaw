import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ProjectData } from '../../../../models/ProjectData';
import { hydrateModuleStoresFromProjectData } from '../hydrateModuleStoresFromProjectData';

const mocks = vi.hoisted(() => ({
    trackStoreSet: vi.fn(),
    markerStoreSet: vi.fn(),
    automationStoreSet: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...actual,
        trackStore: { set: mocks.trackStoreSet },
        markerStore: { set: mocks.markerStoreSet },
    };
});

vi.mock('#/modules/Automation/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Automation/stores')>();
    return {
        ...actual,
        automationStore: { set: mocks.automationStoreSet },
    };
});

describe('hydrateModuleStoresFromProjectData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('hydrates arrangement tracks when present', () => {
        const data = {
            version: 1,
            arrangement: { tracks: [] },
            automation: { lanes: [] },
        } as unknown as ProjectData;

        hydrateModuleStoresFromProjectData(data);

        expect(mocks.trackStoreSet).toHaveBeenCalled();
    });

    it('hydrates automation lanes when present', () => {
        const data = {
            version: 1,
            arrangement: { tracks: [] },
            automation: { lanes: [] },
        } as unknown as ProjectData;

        hydrateModuleStoresFromProjectData(data);

        expect(mocks.automationStoreSet).toHaveBeenCalledWith({ lanes: [] });
    });

    it('hydrates markers when present', () => {
        const data = {
            version: 1,
            arrangement: { tracks: [] },
            automation: { lanes: [] },
            markers: [{ id: 'm1', beat: 0, name: 'Start', color: 'red' }],
        } as unknown as ProjectData;

        hydrateModuleStoresFromProjectData(data);

        expect(mocks.markerStoreSet).toHaveBeenCalled();
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
});
