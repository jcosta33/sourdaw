import { describe, it, expect, vi } from 'vitest';

import { desktopStartVoiceDictation } from '#/utils/desktopBridge';

import { startDictation } from '../startDictation';

vi.mock('#/utils/desktopBridge', () => ({
    desktopStartVoiceDictation: vi.fn().mockResolvedValue('session-1'),
}));

describe('startDictation (voiceNativeAdapter)', () => {
    it('uses the dedicated activation-gated dictation bridge', async () => {
        await startDictation('session-1');
        expect(desktopStartVoiceDictation).toHaveBeenCalledWith('session-1');
    });
});
