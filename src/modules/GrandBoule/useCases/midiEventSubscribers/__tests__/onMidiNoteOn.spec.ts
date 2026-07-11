import { describe, it, expect, vi } from 'vitest';
vi.mock('../../grandBouleEventBus', () => ({
    GrandBouleEventBus: { on: vi.fn(() => () => {}), emit: vi.fn() },
}));
import { onMidiNoteOn } from '../onMidiNoteOn';
describe('onMidiNoteOn', () => {
    it('is defined', () => {
        expect(onMidiNoteOn).toBeDefined();
    });
});
