import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDetectSongStructure } from './handleDetectSongStructure';

vi.mock('#/modules/Arrangement', () => ({
    detectAndApplySongStructure: vi.fn(),
}));

vi.mock('#/helpers/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

import { detectAndApplySongStructure } from '#/modules/Arrangement';
import { notifyUser } from '#/helpers/Notification/notifyUser';

describe('handleDetectSongStructure', () => {
    beforeEach(() => {
        vi.mocked(detectAndApplySongStructure).mockReset();
        vi.mocked(notifyUser).mockReset();
    });

    it('notifies warning when detection returns no sections', async () => {
        vi.mocked(detectAndApplySongStructure).mockReturnValue([]);

        await handleDetectSongStructure.execute({
            type: 'detectSongStructure',
            payload: { trackId: 't1' },
        });

        expect(notifyUser).toHaveBeenCalledWith(
            'No clips found to analyze — add some clips first',
            'warning'
        );
    });

    it('notifies success with section names when detection finds sections', async () => {
        vi.mocked(detectAndApplySongStructure).mockReturnValue([
            // @ts-expect-error — partial Section for test
            { name: 'Intro' },
            // @ts-expect-error — partial Section for test
            { name: 'Verse' },
        ]);

        await handleDetectSongStructure.execute({
            type: 'detectSongStructure',
            payload: { trackId: 't1' },
        });

        expect(notifyUser).toHaveBeenCalledWith(
            'Detected 2 sections: Intro, Verse',
            'success'
        );
    });
});
