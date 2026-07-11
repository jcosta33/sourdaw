import { describe, it, expect, vi } from 'vitest';
import { setGrandBouleMasterGain } from '../setGrandBouleMasterGain';
const mock_engine = new Proxy({}, { get: () => () => {} }) as never;
describe('setGrandBouleMasterGain', () => {
    it('updates store when state exists', () => {
        const set = vi.fn();
        setGrandBouleMasterGain({ store: { value: { masterGain: 0.5 }, set }, engine: mock_engine, gain: 0.8 } as never);
        expect(set).toHaveBeenCalledTimes(1);
    });
    it('does nothing when state is null', () => {
        const set = vi.fn();
        setGrandBouleMasterGain({ store: { value: null, set }, engine: mock_engine, gain: 0.8 } as never);
        expect(set).not.toHaveBeenCalled();
    });
});
