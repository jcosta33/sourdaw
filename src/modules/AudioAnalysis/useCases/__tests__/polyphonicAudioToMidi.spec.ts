import { describe, it, expect, vi } from 'vitest';

import { polyphonicAudioToMidi } from '../polyphonicAudioToMidi';

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: vi.fn(() => []),
}));

const loggerWarnMock = vi.fn();

vi.mock('#/infra/logger/appLogger', () => ({
    logger: {
        warn: (...args: any[]) => loggerWarnMock(...args),
        info: vi.fn(),
        error: vi.fn(),
    },
}));

describe('polyphonicAudioToMidi', () => {
    it('should return null and warn when clip is not found', async () => {
        const result = await polyphonicAudioToMidi({ clipId: 'missing-clip' });

        expect(result).toBeNull();
        expect(loggerWarnMock).toHaveBeenCalledWith(expect.stringContaining('Clip not found'));
    });
});
