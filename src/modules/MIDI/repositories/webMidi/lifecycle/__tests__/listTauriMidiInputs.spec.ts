import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriInvokeMock = vi.hoisted(() => vi.fn<(command: string) => Promise<unknown>>());

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: () => true,
    tauriInvoke: tauriInvokeMock,
}));

import { listTauriMidiInputs } from '../listTauriMidiInputs';

describe('listTauriMidiInputs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('identifies a port by its name, so the id survives a change of enumeration order', async () => {
        tauriInvokeMock.mockResolvedValue([
            { index: 0, name: 'Built-in' },
            { index: 1, name: 'Launchkey' },
        ]);

        const before = await listTauriMidiInputs();

        // Same two devices, replugged in the other order.
        tauriInvokeMock.mockResolvedValue([
            { index: 0, name: 'Launchkey' },
            { index: 1, name: 'Built-in' },
        ]);

        const after = await listTauriMidiInputs();

        expect(before.map((port) => port.id)).toEqual(['Built-in', 'Launchkey']);
        expect(after.find((port) => port.id === 'Launchkey')?.portIndex).toBe(0);
        expect(before.find((port) => port.id === 'Launchkey')?.portIndex).toBe(1);
    });

    it('qualifies only the ports whose names collide', async () => {
        tauriInvokeMock.mockResolvedValue([
            { index: 0, name: 'MPK Mini' },
            { index: 1, name: 'Built-in' },
            { index: 2, name: 'MPK Mini' },
        ]);

        const ports = await listTauriMidiInputs();

        // Nothing but the order separates two units of the same controller, so
        // those fall back to an index-qualified id; the unique one must not.
        expect(ports.map((port) => port.id)).toEqual(['MPK Mini #0', 'Built-in', 'MPK Mini #2']);
    });

    it('rejects a payload that is not a device list', async () => {
        tauriInvokeMock.mockResolvedValue([{ name: 'Built-in' }]);

        await expect(listTauriMidiInputs()).rejects.toThrow(TypeError);
    });
});
