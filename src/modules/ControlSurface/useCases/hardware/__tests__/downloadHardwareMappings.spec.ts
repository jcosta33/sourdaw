import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hardwareControllerStore } from '../../../stores/hardwareControllerStore';
import { downloadHardwareMappings } from '../downloadHardwareMappings';

const mocks = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notify }));

function readBlob(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
    });
}

describe('downloadHardwareMappings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        hardwareControllerStore.set({
            connectedDevices: [],
            profiles: [{
                id: 'p1', name: 'One', manufacturer: 'M', productId: ['one'],
                mappings: [{ id: 'play', controlType: 'button', controlIndex: 85, channel: 1,
                    action: { type: 'transport', target: 'togglePlayback' } }],
            }],
        });
        vi.stubGlobal('URL', class extends URL {
            static createObjectURL = vi.fn(() => 'blob:mappings');
            static revokeObjectURL = vi.fn();
        });
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('downloads the actual selected profile as a portable bare mapping array', async () => {
        const before = hardwareControllerStore.value;
        expect(downloadHardwareMappings('p1')).toBe(true);
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
        const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0];
        if (!(blob instanceof Blob)) {
            throw new Error('Expected an actual exported Blob');
        }
        expect(blob.type).toBe('application/json');
        expect(JSON.parse(await readBlob(blob))).toEqual(before?.profiles[0]?.mappings);
        const anchor = document.querySelector<HTMLAnchorElement>('a[download="p1-mappings.json"]');
        expect(anchor?.href).toBe('blob:mappings');
        expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
        expect(hardwareControllerStore.value).toBe(before);
    });

    it('does not download a missing profile', () => {
        expect(downloadHardwareMappings('missing')).toBe(false);
        expect(URL.createObjectURL).not.toHaveBeenCalled();
        expect(mocks.notify).toHaveBeenCalledWith(expect.stringContaining('unknown profile'), 'error');
    });

    it('reports browser download failure without changing the profile', () => {
        const before = hardwareControllerStore.value;
        vi.mocked(URL.createObjectURL).mockImplementation(() => { throw new Error('download refused'); });
        expect(downloadHardwareMappings('p1')).toBe(false);
        expect(hardwareControllerStore.value).toBe(before);
        expect(mocks.notify).toHaveBeenCalledWith(expect.stringContaining('download refused'), 'error');
    });
});
