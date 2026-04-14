import { describe, it, expect, beforeEach } from 'vitest';
import { audioDeviceStore } from '../helpers';
import { getSelectedInputId } from '../getSelectedInputId';

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
