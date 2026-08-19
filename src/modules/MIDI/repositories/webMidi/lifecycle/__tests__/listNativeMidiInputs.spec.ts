import { beforeEach, describe, expect, it, vi } from 'vitest';

const desktopInvokeMock = vi.hoisted(() => vi.fn<(command: string) => Promise<unknown>>());

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: () => true,
    desktopInvoke: desktopInvokeMock,
}));

import { listNativeMidiInputs } from '../listNativeMidiInputs';
import { resolveNativeMidiPort } from '../resolveNativeMidiPort';

describe('listNativeMidiInputs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('identifies a port by its name, so the id survives a change of enumeration order', async () => {
        desktopInvokeMock.mockResolvedValue([
            { index: 0, name: 'Built-in' },
            { index: 1, name: 'Launchkey' },
        ]);

        const before = await listNativeMidiInputs();

        // Same two devices, replugged in the other order.
        desktopInvokeMock.mockResolvedValue([
            { index: 0, name: 'Launchkey' },
            { index: 1, name: 'Built-in' },
        ]);

        const after = await listNativeMidiInputs();

        expect(before.map((port) => port.id)).toEqual(['Built-in', 'Launchkey']);
        expect(after.find((port) => port.id === 'Launchkey')?.portIndex).toBe(0);
        expect(before.find((port) => port.id === 'Launchkey')?.portIndex).toBe(1);
    });

    it('qualifies only the ports whose names collide', async () => {
        desktopInvokeMock.mockResolvedValue([
            { index: 0, name: 'MPK Mini' },
            { index: 1, name: 'Built-in' },
            { index: 2, name: 'MPK Mini' },
        ]);

        const ports = await listNativeMidiInputs();

        // Nothing but the order separates two units of the same controller, so
        // those fall back to an ordinal-qualified id; the unique one must not.
        expect(ports.map((port) => port.id)).toEqual(['MPK Mini #0', 'Built-in', 'MPK Mini #1']);
        expect(ports[2]?.portIndex).toBe(2);
    });

    it('keeps colliding ids stable when an unrelated device leaves', async () => {
        // Qualified by the global enumeration index, unplugging the Built-in —
        // a device the user never touched — would renumber "MPK Mini #2" to
        // "#1" and strand the saved selection on the other unit.
        desktopInvokeMock.mockResolvedValue([
            { index: 0, name: 'MPK Mini' },
            { index: 1, name: 'Built-in' },
            { index: 2, name: 'MPK Mini' },
        ]);
        const before = await listNativeMidiInputs();

        desktopInvokeMock.mockResolvedValue([
            { index: 0, name: 'MPK Mini' },
            { index: 1, name: 'MPK Mini' },
        ]);
        const after = await listNativeMidiInputs();

        expect(before.filter((port) => port.name === 'MPK Mini').map((port) => port.id)).toEqual(
            after.map((port) => port.id)
        );
    });

    it('rejects a payload that is not a device list', async () => {
        desktopInvokeMock.mockResolvedValue([{ name: 'Built-in' }]);

        await expect(listNativeMidiInputs()).rejects.toThrow(TypeError);
    });
});

describe('resolveNativeMidiPort', () => {
    const port = (id: string, name: string, portIndex: number) => ({ id, name, portIndex });

    it('resolves an exact id match', () => {
        const ports = [port('MPK Mini #0', 'MPK Mini', 0), port('MPK Mini #1', 'MPK Mini', 1)];

        expect(resolveNativeMidiPort(ports, 'MPK Mini #1')).toBe(ports[1]);
    });

    it('resolves a qualified id to the lone survivor of its name', () => {
        // Saved while two units were plugged in; only one remains, so its id
        // dropped the qualifier. The name still identifies it unambiguously.
        const ports = [port('Built-in', 'Built-in', 0), port('MPK Mini', 'MPK Mini', 1)];

        expect(resolveNativeMidiPort(ports, 'MPK Mini #1')).toBe(ports[1]);
    });

    it('refuses to guess between identical units', () => {
        // Saved unqualified while one unit was present; two are now. Picking
        // either is the misgrab the stable id exists to prevent.
        const ports = [port('MPK Mini #0', 'MPK Mini', 0), port('MPK Mini #1', 'MPK Mini', 1)];

        expect(resolveNativeMidiPort(ports, 'MPK Mini')).toBeUndefined();
    });

    it('resolves a legacy bare index to nothing', () => {
        const ports = [port('Built-in', 'Built-in', 0), port('Launchkey', 'Launchkey', 1)];

        expect(resolveNativeMidiPort(ports, '1')).toBeUndefined();
    });
});
