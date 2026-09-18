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

    it('passes the backend identity through unchanged, with the enumeration index as portIndex', async () => {
        desktopInvokeMock.mockResolvedValue([
            { index: 0, id: '254', name: 'Built-in' },
            { index: 1, id: '817', name: 'Launchkey' },
        ]);

        const ports = await listNativeMidiInputs();

        // The id is built native-side; this layer's job is to carry it verbatim
        // so a saved selection keeps meaning the same device.
        expect(ports).toEqual([
            { id: '254', name: 'Built-in', portIndex: 0 },
            { id: '817', name: 'Launchkey', portIndex: 1 },
        ]);
    });

    it('keeps same-named ports distinct under the backend ids that separate them', async () => {
        desktopInvokeMock.mockResolvedValue([
            { index: 0, id: '817', name: 'MPK Mini' },
            { index: 1, id: '254', name: 'MPK Mini' },
        ]);

        const ports = await listNativeMidiInputs();

        expect(ports.map((port) => port.id)).toEqual(['817', '254']);
        expect(ports.every((port) => port.name === 'MPK Mini')).toBe(true);
    });

    it('rejects a payload whose entries carry no id', async () => {
        // The pre-identity payload shape: without the guard, its absence would
        // cross as `id: undefined` and strand every saved selection.
        desktopInvokeMock.mockResolvedValue([{ index: 0, name: 'Built-in' }]);

        await expect(listNativeMidiInputs()).rejects.toThrow(TypeError);
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
