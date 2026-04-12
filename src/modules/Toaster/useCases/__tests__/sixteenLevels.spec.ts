import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { trigger16Level } from '../sixteenLevels';
import { triggerToasterPad } from '../triggerPad';

vi.mock('../triggerPad', () => ({
    triggerToasterPad: vi.fn(),
}));

describe('trigger16Level', () => {
    beforeEach(() => {
        Container.clear();
        vi.mocked(triggerToasterPad).mockClear();
    });

    it('does not trigger when 16 Levels mode is inactive', () => {
        trigger16Level(0);

        expect(triggerToasterPad).not.toHaveBeenCalled();
    });
});
