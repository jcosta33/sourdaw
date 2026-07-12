import { describe, it, expect, vi } from 'vitest';

vi.mock('../../grandBouleEventBus', () => ({
    GrandBouleEventBus: { on: vi.fn(() => () => {}), emit: vi.fn() },
}));
import { onMidiNoteOff } from '../onMidiNoteOff';

describe('onMidiNoteOff', () => {
    it('is defined', () => {
        expect(onMidiNoteOff).toBeDefined();
    });
});
