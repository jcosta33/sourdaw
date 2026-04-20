import { describe, it, expect, vi } from 'vitest';

import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { onMidiNoteOff } from '../midiEventSubscribers/onMidiNoteOff';
import { onMidiNoteOn } from '../midiEventSubscribers/onMidiNoteOn';
import { onMidiPedalCc } from '../midiEventSubscribers/onMidiPedalCc';

type EventBusShape = {
    on: ReturnType<typeof vi.fn>;
};

describe('midiEventSubscribers', () => {
    it('should subscribe to midi.noteOn', () => {
        const eventBus = createMock<EventBusShape>();
        const unsubscribe = vi.fn();
        eventBus.on.mockReturnValue(unsubscribe);
        injectDependencies(onMidiNoteOn, { eventBus });

        const handler = vi.fn();
        expect(onMidiNoteOn(handler)).toBe(unsubscribe);
        expect(eventBus.on).toHaveBeenCalledWith('midi.noteOn', handler);
    });

    it('should subscribe to midi.noteOff', () => {
        const eventBus = createMock<EventBusShape>();
        const unsubscribe = vi.fn();
        eventBus.on.mockReturnValue(unsubscribe);
        injectDependencies(onMidiNoteOff, { eventBus });

        const handler = vi.fn();
        expect(onMidiNoteOff(handler)).toBe(unsubscribe);
        expect(eventBus.on).toHaveBeenCalledWith('midi.noteOff', handler);
    });

    it('should subscribe to midi.pedalCc', () => {
        const eventBus = createMock<EventBusShape>();
        const unsubscribe = vi.fn();
        eventBus.on.mockReturnValue(unsubscribe);
        injectDependencies(onMidiPedalCc, { eventBus });

        const handler = vi.fn();
        expect(onMidiPedalCc(handler)).toBe(unsubscribe);
        expect(eventBus.on).toHaveBeenCalledWith('midi.pedalCc', handler);
    });
});
