import { describe, it, expect, vi } from 'vitest';
import { stopDictation } from '../stopDictation';
import { tauriInvoke } from '#/utils/tauriBridge';

vi.mock('#/utils/tauriBridge', () => ({
    tauriInvoke: vi.fn().mockResolvedValue(undefined),
}));

describe('stopDictation (voiceTauriAdapter)', () => {
    it('invokes stop_dictation command', async () => {
        await stopDictation();
        expect(tauriInvoke).toHaveBeenCalledWith('stop_dictation');
    });
});
