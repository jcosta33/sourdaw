import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTrackForPlugin } from '../pluginBrowserActions/createTrackForPlugin';

const addTrack = vi.fn().mockReturnValue(null);
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...await importOriginal<typeof import('#/modules/Arrangement/useCases')>(),
    addTrack: (...args: any[]) => addTrack(...args),
}));

const addExternalDevice = vi.fn();
vi.mock('#/modules/DeviceBrowser/useCases', async (importOriginal) => ({
    ...await importOriginal<typeof import('#/modules/DeviceBrowser/useCases')>(),
    addExternalDevice: (...args: any[]) => addExternalDevice(...args),
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
