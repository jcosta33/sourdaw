import { describe, it, expect, vi } from 'vitest';

import { desktopInvoke } from '#/utils/desktopBridge';

import { startDictation } from '../startDictation';

vi.mock('#/utils/desktopBridge', () => ({
    desktopInvoke: vi.fn().mockResolvedValue(undefined),
}));

describe('startDictation (voiceNativeAdapter)', () => {
    it('invokes start_dictation command', async () => {
        await startDictation();
        expect(desktopInvoke).toHaveBeenCalledWith('start_dictation');
    });
});
