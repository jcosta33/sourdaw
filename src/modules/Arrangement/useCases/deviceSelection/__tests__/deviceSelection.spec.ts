import { beforeEach, describe, expect, it } from 'vitest';

import { defaultDeviceSelectionState, deviceSelectionStore } from '../../../stores/deviceSelectionStore';
import { clearDeviceSelection } from '../clearDeviceSelection';
import { selectDevice } from '../selectDevice';

describe('device selection use cases', () => {
    beforeEach(() => {
        deviceSelectionStore.set(defaultDeviceSelectionState);
    });

    it('selectDevice makes the device the inspected one', () => {
        selectDevice('device-1');

        expect(deviceSelectionStore.value?.selectedDeviceId).toBe('device-1');
    });

    it('selectDevice replaces a previous selection', () => {
        selectDevice('device-1');
        selectDevice('device-2');

        expect(deviceSelectionStore.value?.selectedDeviceId).toBe('device-2');
    });

    it('clearDeviceSelection drops the selection', () => {
        selectDevice('device-1');

        clearDeviceSelection();

        expect(deviceSelectionStore.value?.selectedDeviceId).toBeNull();
    });
});
