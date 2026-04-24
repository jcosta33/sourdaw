import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { getAudioTime } from '#/modules/AudioEngine/useCases';

import { startNoteRepeat, stopNoteRepeat } from '../noteRepeat';
import { triggerToasterPad } from '../triggerPad';

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getAudioTime: vi.fn(),
}));

vi.mock('../triggerPad', () => ({
    triggerToasterPad: vi.fn(),
}));

describe('startNoteRepeat', () => {
    beforeEach(() => {
        Container.clear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        stopNoteRepeat();
        vi.useRealTimers();
    });

    it('fires triggerToasterPad immediately with pad and velocity', () => {
        vi.mocked(getAudioTime).mockReturnValue(0);

        startNoteRepeat('d1', 3, 90, 120, '1/4');

        expect(triggerToasterPad).toHaveBeenCalledWith('d1', 3, 90);
    });
});
