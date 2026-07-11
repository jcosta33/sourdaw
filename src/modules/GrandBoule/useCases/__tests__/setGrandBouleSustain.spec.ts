import { describe, it, expect, vi } from 'vitest';
import { setGrandBouleSustain } from '../setGrandBouleSustain';
const mock_engine = new Proxy({}, { get: () => () => {} }) as never;
describe('setGrandBouleSustain', () => {
    it('updates store when state exists', () => {
        const set = vi.fn();
        setGrandBouleSustain({ store: { value: { pedals: { sustain: 0 } }, set }, engine: mock_engine, position: 0.5 } as never);
        expect(set).toHaveBeenCalledTimes(1);
    });
    it('does nothing when state is null', () => {
        const set = vi.fn();
        setGrandBouleSustain({ store: { value: null, set }, engine: mock_engine, position: 0.5 } as never);
        expect(set).not.toHaveBeenCalled();
    });
    it('clamps position to 0-1', () => {
        const set = vi.fn();
        setGrandBouleSustain({ store: { value: { pedals: {} }, set }, engine: mock_engine, position: 5 } as never);
        expect(set).toHaveBeenCalledTimes(1);
    });
});
