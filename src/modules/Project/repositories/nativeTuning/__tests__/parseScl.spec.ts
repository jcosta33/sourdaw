import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopInvoke } from '#/utils/desktopBridge';

import { parseScl } from '../parseScl';

vi.mock('#/utils/desktopBridge', () => ({
    desktopInvoke: vi.fn(),
}));

describe('parseScl', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should invoke parse_scl with standard A4 root defaults', async () => {
        const nativeResult = {
            name: 'Bright twelve',
            description: 'A test tuning',
            frequencies: [220, 440, 880],
        };
        vi.mocked(desktopInvoke).mockResolvedValue(nativeResult);

        await expect(parseScl('! scl content')).resolves.toEqual(nativeResult);

        expect(desktopInvoke).toHaveBeenCalledWith('parse_scl', {
            content: '! scl content',
            rootNote: 69,
            rootFreq: 440,
        });
    });
});
