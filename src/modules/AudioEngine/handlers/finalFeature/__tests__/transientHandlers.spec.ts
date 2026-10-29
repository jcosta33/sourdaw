import { describe, expect, it, vi, beforeEach } from 'vitest';

import { quantizeTransients } from '#/modules/ElasticAudio/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { handleQuantizeTransients } from '../handleQuantizeTransients';

vi.mock('#/modules/ElasticAudio/useCases', () => ({
    quantizeTransients: vi.fn(),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

describe('handleQuantizeTransients', () => {
    beforeEach(() => vi.clearAllMocks());

    it.each([
        ['CLIP_NOT_FOUND', 'Clip not found'],
        ['CLIP_NOT_AUDIO', 'Quantize only works on audio clips'],
        ['NO_MARKERS', 'No transients detected — run Detect Transients first'],
    ] as const)('notifies the mapped error message on reason %s', (reason, message) => {
        vi.mocked(quantizeTransients).mockReturnValue({ ok: false, reason });
        handleQuantizeTransients.execute({ type: 'quantizeTransients', payload: { clipId: 'c1' } });
        expect(notifyUser).toHaveBeenCalledWith(message, 'error');
    });

    it('notifies the success summary with the moved count', () => {
        vi.mocked(quantizeTransients).mockReturnValue({ ok: true, moved: 7 });
        handleQuantizeTransients.execute({ type: 'quantizeTransients', payload: { clipId: 'c1' } });
        expect(quantizeTransients).toHaveBeenCalledWith('c1');
        expect(notifyUser).toHaveBeenCalledWith('Quantized 7 transients to the grid', 'success');
    });

    it('is undoable and describes itself', () => {
        expect(handleQuantizeTransients.undoable).toBe(true);
        expect(handleQuantizeTransients.describe({} as never).label).toBe('Quantize to Grid (Elastic Audio)');
    });
});
