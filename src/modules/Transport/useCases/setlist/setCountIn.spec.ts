import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type SetlistState } from '#/modules/Transport/stores/setlistStore';
import { setCountIn } from './setCountIn';

describe('setCountIn', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('writes countInBars', () => {
        const set = vi.fn();
        const state: SetlistState = {
            name: 'S',
            items: [],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 0,
        };
        injectDependencies(setCountIn, {
            setlistStore: { value: state, set } as never,
        });
        setCountIn(4);
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ countInBars: 4 }));
    });
});
