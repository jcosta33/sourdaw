import { describe, it, expect, vi } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { polyphonicAudioToMidi } from './polyphonicAudioToMidi';
import { type Logger } from '#/helpers/Logger/Logger';

vi.mock('#/modules/Arrangement/useCases/getAllTracks', () => ({
    getAllTracks: vi.fn(() => []),
}));

describe('polyphonicAudioToMidi', () => {
    it('should return null and warn when clip is not found', async () => {
        const logger = createMock<Logger>();
        injectDependencies(polyphonicAudioToMidi, { logger });

        const result = await polyphonicAudioToMidi({ clipId: 'missing-clip' });

        expect(result).toBeNull();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Clip not found'));
    });
});
