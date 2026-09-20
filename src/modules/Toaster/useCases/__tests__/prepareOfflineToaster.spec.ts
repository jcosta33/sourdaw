import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultKit } from '../../models/ToasterKit';
import { toToasterKitState } from '../../models/ToasterKitState';
import { defaultToasterState, toasterStore } from '../../stores/toasterStore';
import { captureOfflineToaster } from '../captureOfflineToaster';
import { prepareOfflineToaster } from '../prepareOfflineToaster';

describe('prepareOfflineToaster captured input', () => {
    afterEach(() => toasterStore.set({}));

    it('posts the captured kit after the same device id receives a replacement kit', () => {
        const kit = createDefaultKit();
        kit.masterGain = 0.31;
        toasterStore.set({ 'same-id': { ...defaultToasterState, kit } });
        const captured = captureOfflineToaster({ deviceId: 'same-id' });
        kit.masterGain = 0.92;
        toasterStore.set({ 'same-id': { ...defaultToasterState, kit: createDefaultKit() } });
        const postMessage = vi.fn();

        prepareOfflineToaster({ deviceId: 'same-id', port: { postMessage } as unknown as MessagePort, captured });

        const gain = postMessage.mock.calls
            .map(([message]) => message)
            .filter((message) => message.name === 'master_gain');
        expect(gain).toEqual([{ type: 'param', name: 'master_gain', value: 0.31 }]);
    });

    it('prefers supplied project state over both explicit and live kits without live writes', () => {
        toasterStore.set({ 'same-id': defaultToasterState });
        const before = structuredClone(toasterStore.value);
        const kit = createDefaultKit();
        kit.masterGain = 0.44;
        const captured = captureOfflineToaster({
            deviceId: 'same-id',
            deviceState: toToasterKitState(kit),
            kit: createDefaultKit(),
        });
        kit.masterGain = 0.93;
        const postMessage = vi.fn();

        prepareOfflineToaster({ deviceId: 'same-id', port: { postMessage } as unknown as MessagePort, captured });

        const gain = postMessage.mock.calls
            .map(([message]) => message)
            .filter((message) => message.name === 'master_gain');
        expect(gain).toEqual([{ type: 'param', name: 'master_gain', value: 0.44 }]);
        expect(toasterStore.value).toEqual(before);
    });
});
