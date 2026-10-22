import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hardwareControllerStore } from '../../../stores/hardwareControllerStore';
import { importHardwareMappings } from '../importHardwareMappings';
import { importHardwareMappingsFile } from '../importHardwareMappingsFile';

const mocks = vi.hoisted(() => ({
    read: vi.fn<(file: File) => Promise<string>>(),
    notify: vi.fn(),
}));

vi.mock('../../../repositories/readHardwareMappingsFile', () => ({ readHardwareMappingsFile: mocks.read }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notify }));

const mappings = [{ id: 'play', controlType: 'button', controlIndex: 85, channel: 1, action: { type: 'transport' } }];
const json = JSON.stringify(mappings);

function pendingRead() {
    let resolve!: (value: string) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<string>((resolveRead, rejectRead) => {
        resolve = resolveRead;
        reject = rejectRead;
    });
    mocks.read.mockReturnValueOnce(promise);
    return { resolve, reject };
}

describe('importHardwareMappingsFile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hardwareControllerStore.set({
            connectedDevices: [{ id: 'input', name: 'Input', profileId: 'p1' }],
            profiles: [
                { id: 'p1', name: 'One', manufacturer: 'M', productId: ['one'], mappings: [] },
                { id: 'p2', name: 'Two', manufacturer: 'M', productId: ['two'], mappings: [] },
            ],
        });
    });

    it('reads the selected file and changes only the real captured profile', async () => {
        mocks.read.mockResolvedValueOnce(json);
        const before = hardwareControllerStore.value;
        const file = new File([json], 'mappings.json');
        expect(await importHardwareMappingsFile('p1', file, () => true)).toBe('imported');
        expect(mocks.read).toHaveBeenCalledWith(file);
        expect(hardwareControllerStore.value?.profiles[0]?.mappings).toEqual(mappings);
        expect(hardwareControllerStore.value?.profiles[1]).toBe(before?.profiles[1]);
        expect(hardwareControllerStore.value?.connectedDevices).toBe(before?.connectedDevices);
    });

    it('keeps the complete store intact when the parsed file is rejected', async () => {
        const before = hardwareControllerStore.value;
        mocks.read.mockResolvedValueOnce('{"not":"a mapping array"}');
        expect(await importHardwareMappingsFile('p1', new File([], 'bad.json'), () => true)).toBe('rejected');
        expect(hardwareControllerStore.value).toBe(before);
        expect(mocks.notify).toHaveBeenCalledWith(expect.stringContaining('valid controller mapping list'), 'error');
    });

    it('refuses an unknown profile without opening the file', async () => {
        const before = hardwareControllerStore.value;
        expect(await importHardwareMappingsFile('missing', new File([], 'map.json'), () => true)).toBe('rejected');
        expect(mocks.read).not.toHaveBeenCalled();
        expect(hardwareControllerStore.value).toBe(before);
        expect(mocks.notify).toHaveBeenCalledWith(expect.stringContaining('unknown profile "missing"'), 'error');
    });

    it('reports a current read error without changing mappings', async () => {
        const before = hardwareControllerStore.value;
        mocks.read.mockRejectedValueOnce(new Error('permission denied'));
        expect(await importHardwareMappingsFile('p1', new File([], 'map.json'), () => true)).toBe('rejected');
        expect(hardwareControllerStore.value).toBe(before);
        expect(mocks.notify).toHaveBeenCalledWith(expect.stringContaining('permission denied'), 'error');
    });

    it('rejects an oversized file before reading any bytes', async () => {
        const before = hardwareControllerStore.value;
        const file = new File([], 'large.json');
        Object.defineProperty(file, 'size', { value: 16 * 1024 * 1024 + 1 });
        expect(await importHardwareMappingsFile('p1', file, () => true)).toBe('rejected');
        expect(mocks.read).not.toHaveBeenCalled();
        expect(hardwareControllerStore.value).toBe(before);
        expect(mocks.notify).toHaveBeenCalledWith(expect.stringContaining('16 MiB'), 'error');
    });

    it('admits the exact file limit and a valid mapping file larger than one MiB', async () => {
        const large = JSON.stringify([{ ...mappings[0], action: { type: 'parameter', target: 'x'.repeat(1024 * 1024) } }]);
        const file = new File([large], 'large-valid.json');
        Object.defineProperty(file, 'size', { value: 16 * 1024 * 1024 });
        mocks.read.mockResolvedValueOnce(large);
        expect(await importHardwareMappingsFile('p1', file, () => true)).toBe('imported');
        expect(mocks.read).toHaveBeenCalledWith(file);
        expect(hardwareControllerStore.value?.profiles[0]?.mappings[0]?.action.target).toHaveLength(1024 * 1024);
    });

    it.each(['selection changed', 'view closed'])('cancels a pending read after %s', async () => {
        const read = pendingRead();
        const before = hardwareControllerStore.value;
        let current = true;
        const result = importHardwareMappingsFile('p1', new File([], 'map.json'), () => current);
        current = false;
        read.resolve(json);
        expect(await result).toBe('cancelled');
        expect(hardwareControllerStore.value).toBe(before);
        expect(mocks.notify).not.toHaveBeenCalled();
    });

    it('does not let an older file overwrite a newer import for the same profile', async () => {
        const read = pendingRead();
        const result = importHardwareMappingsFile('p1', new File([], 'old.json'), () => true);
        importHardwareMappings('p1', JSON.stringify([{ ...mappings[0], controlIndex: 86 }]));
        const successor = hardwareControllerStore.value;
        read.resolve(json);
        expect(await result).toBe('cancelled');
        expect(hardwareControllerStore.value).toBe(successor);
        expect(hardwareControllerStore.value?.profiles[0]?.mappings[0]?.controlIndex).toBe(86);
    });

    it('does not import into a replacement profile that reuses the same id', async () => {
        const read = pendingRead();
        const result = importHardwareMappingsFile('p1', new File([], 'old.json'), () => true);
        const state = hardwareControllerStore.value!;
        hardwareControllerStore.set({ ...state, profiles: state.profiles.map((profile) => ({ ...profile })) });
        const successor = hardwareControllerStore.value;
        read.resolve(json);
        expect(await result).toBe('cancelled');
        expect(hardwareControllerStore.value).toBe(successor);
    });

    it('suppresses late read errors after cancellation', async () => {
        const read = pendingRead();
        let current = true;
        const result = importHardwareMappingsFile('p1', new File([], 'map.json'), () => current);
        current = false;
        read.reject(new Error('late failure'));
        expect(await result).toBe('cancelled');
        expect(mocks.notify).not.toHaveBeenCalled();
    });
});
