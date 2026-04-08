import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeAutoOrganizeProject } from './aiOrganizationHandlers';

describe('aiOrganizationHandlers injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeAutoOrganizeProject no-ops when track state is missing', async () => {
        const getTrackStoreState = vi.fn(() => null);
        const renameTrack = vi.fn();
        const setTrackColor = vi.fn();
        const groupTracks = vi.fn();
        injectDependencies(executeAutoOrganizeProject, {
            getTrackStoreState,
            renameTrack,
            setTrackColor,
            groupTracks,
        });

        await executeAutoOrganizeProject({
            type: 'autoOrganizeProject',
            payload: { tracks: [{ trackId: 't1', newName: 'A' }] },
        });

        expect(renameTrack).not.toHaveBeenCalled();
    });
});
