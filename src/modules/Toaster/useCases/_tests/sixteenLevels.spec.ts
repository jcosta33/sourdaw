import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { trigger16Level } from '../sixteenLevels';

describe('trigger16Level', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not trigger when 16 Levels mode is inactive', () => {
        const triggerToasterPad = vi.fn();
        injectDependencies(trigger16Level, {
            triggerToasterPad,
            getFirstToasterDeviceId: () => null,
            setToasterPadParam: vi.fn(),
        });

        trigger16Level(0);

        expect(triggerToasterPad).not.toHaveBeenCalled();
    });
});
