import { describe, it, expect, vi } from 'vitest';
vi.mock('../../grandBouleEventBus', () => ({
    GrandBouleEventBus: { on: vi.fn(() => () => {}), emit: vi.fn() },
}));
import { onMidiPedalCc } from '../onMidiPedalCc';
describe('onMidiPedalCc', () => {
    it('is defined', () => {
        expect(onMidiPedalCc).toBeDefined();
    });
});
