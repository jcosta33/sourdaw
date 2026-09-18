import { describe, it, expect, vi } from 'vitest';

import { desktopStopVoiceDictation } from '#/utils/desktopBridge';

import { stopDictation } from '../stopDictation';

vi.mock('#/utils/desktopBridge', () => ({
    desktopStopVoiceDictation: vi.fn().mockResolvedValue(undefined),
}));

describe('stopDictation (voiceNativeAdapter)', () => {
    it('stops only the acknowledged dictation session', async () => {
        await stopDictation('session-1');
        expect(desktopStopVoiceDictation).toHaveBeenCalledWith('session-1');
    });
});
