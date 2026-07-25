import { beforeEach, describe, expect, it, vi } from 'vitest';

const midi_access = vi.hoisted(() => ({ value: null as { outputs: Map<string, { send: unknown }> } | null }));

vi.mock('../getMidiAccess', () => ({
    getMidiAccess: () => midi_access.value,
}));

const { sendPanicToMidiOutputs } = await import('../sendPanicToMidiOutputs');

type Send = (data: number[]) => void;

function make_output() {
    const send = vi.fn<Send>();
    return { send };
}

describe('sendPanicToMidiOutputs', () => {
    beforeEach(() => {
        midi_access.value = null;
    });

    it('sends All Sound Off, Reset All Controllers and All Notes Off on every channel', () => {
        const output = make_output();
        midi_access.value = { outputs: new Map([['out-1', output]]) };

        sendPanicToMidiOutputs();

        const sent = output.send.mock.calls.map(([data]) => data);
        expect(sent.length).toBe(16 * 3);
        // Channel 0 carries the status byte 0xB0; channel 9 carries 0xB9.
        expect(sent).toContainEqual([0xb0, 120, 0]);
        expect(sent).toContainEqual([0xb0, 121, 0]);
        expect(sent).toContainEqual([0xb0, 123, 0]);
        expect(sent).toContainEqual([0xb9, 123, 0]);
        expect(sent).toContainEqual([0xbf, 123, 0]);
    });

    it('reaches every connected output, not only the first', () => {
        // A hanging hardware voice can be on any of them, and which one is not
        // knowable from here (audit MD-6).
        const first = make_output();
        const second = make_output();
        midi_access.value = {
            outputs: new Map([
                ['out-1', first],
                ['out-2', second],
            ]),
        };

        sendPanicToMidiOutputs();

        expect(first.send.mock.calls.length).toBe(16 * 3);
        expect(second.send.mock.calls.length).toBe(16 * 3);
    });

    it('is a no-op when Web MIDI access was never granted', () => {
        expect(() => sendPanicToMidiOutputs()).not.toThrow();
    });

    it('is a no-op when access exists but no outputs are connected', () => {
        midi_access.value = { outputs: new Map() };

        expect(() => sendPanicToMidiOutputs()).not.toThrow();
    });
});
