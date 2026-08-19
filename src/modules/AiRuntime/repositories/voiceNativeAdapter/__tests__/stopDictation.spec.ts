import { describe, it, expect, vi } from 'vitest';

import { desktopInvoke } from '#/utils/desktopBridge';

import { stopDictation } from '../stopDictation';

vi.mock('#/utils/desktopBridge', () => ({
    desktopInvoke: vi.fn().mockResolvedValue(undefined),
}));

describe('stopDictation (voiceNativeAdapter)', () => {
    it('invokes stop_dictation command', async () => {
        await stopDictation();
        expect(desktopInvoke).toHaveBeenCalledWith('stop_dictation');
    });
});
