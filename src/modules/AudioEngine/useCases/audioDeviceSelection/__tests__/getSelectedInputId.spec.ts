import { describe, it, expect, beforeEach } from 'vitest';

import { getSelectedInputId } from '../getSelectedInputId';
import { audioDeviceStore } from '../helpers';

describe('getSelectedInputId', () => {
    beforeEach(() => {
        audioDeviceStore.set({
            selectedOutputId: null,
            selectedInputId: null,
        });
    });

    it('should return null when no input is selected', () => {
        expect(getSelectedInputId()).toBeNull();
    });

    it('should return the selected input id from the store', () => {
        audioDeviceStore.set({
            selectedOutputId: 'out',
            selectedInputId: 'in-usb',
        });

        expect(getSelectedInputId()).toBe('in-usb');
    });
});
