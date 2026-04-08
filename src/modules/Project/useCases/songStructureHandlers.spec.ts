import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeDetectSongStructure } from './songStructureHandlers';

describe('executeDetectSongStructure', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('notifies warning when detection returns no sections', async () => {
        const notifyUser = vi.fn();
        const detectAndApplySongStructure = vi.fn(() => []);
        injectDependencies(executeDetectSongStructure, { detectAndApplySongStructure, notifyUser });

        await executeDetectSongStructure({ payload: {} });

        expect(notifyUser).toHaveBeenCalledWith(
            'No clips found to analyze — add some clips first',
            'warning'
        );
    });

    it('notifies success with section names when detection finds sections', async () => {
        const notifyUser = vi.fn();
        const detectAndApplySongStructure = vi.fn(() => [
            { name: 'Intro' },
            { name: 'Verse' },
        ]);
        injectDependencies(executeDetectSongStructure, { detectAndApplySongStructure, notifyUser });

        await executeDetectSongStructure({ payload: { trackId: 't1' } });

        expect(notifyUser).toHaveBeenCalledWith(
            'Detected 2 sections: Intro, Verse',
            'success'
        );
    });
});
