import { describe, it, expect, vi } from 'vitest';

import { tauriInvoke } from '#/utils/tauriBridge';

import { startDictation } from '../startDictation';

vi.mock('#/utils/tauriBridge', () => ({
    tauriInvoke: vi.fn().mockResolvedValue(undefined),
}));

describe('startDictation (voiceTauriAdapter)', () => {
    it('invokes start_dictation command', async () => {
        await startDictation();
        expect(tauriInvoke).toHaveBeenCalledWith('start_dictation');
    });
});
