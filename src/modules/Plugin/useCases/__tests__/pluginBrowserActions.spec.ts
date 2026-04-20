import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createTrackForPlugin } from '../pluginBrowserActions/createTrackForPlugin';

const addTrack = vi.fn().mockReturnValue(null);
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    addTrack: (input: { name: string; kind: 'audio' | 'midi' | 'group' | 'folder' | 'bus' | 'master' }) => addTrack(input),
}));

describe('createTrackForPlugin', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        addTrack.mockReturnValue(null);
    });

    it('returns null when addTrack fails', () => {
        expect(createTrackForPlugin('T', 'midi')).toBeNull();
    });
});
