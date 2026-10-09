import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    pendingPadSelectionStore,
    registerToasterDevice,
    resetToasterDeviceLifecycleState,
    toasterStore,
} from '../../../stores/toasterStore';
import { ToasterPanel } from '../ToasterPanel';

const DEVICE_ID = 'toaster-select-before-registration-1';

/**
 * A pad clicked while the instrument is still loading is held outside the
 * instance map, and the panel must read it from there. The specs that mock
 * `useStore` never let pending state reach the panel, and the mute and solo
 * wiring specs register the device before rendering, so only this spec observes
 * the panel showing a pad that was selected before its record existed.
 */
describe('Toaster panel shows a pad selected before the instrument registers', () => {
    beforeEach(() => {
        toasterStore.set({});
        resetToasterDeviceLifecycleState();
    });

    afterEach(() => {
        toasterStore.set({});
        resetToasterDeviceLifecycleState();
    });

    function padPressed(index: number): string | null {
        return screen.getByTestId(`toaster-pad-${index}`).getAttribute('aria-pressed');
    }

    it('presses the clicked pad while the device is unregistered', () => {
        render(<ToasterPanel deviceId={DEVICE_ID} />);

        fireEvent.click(screen.getByTestId('toaster-pad-1'));

        expect(pendingPadSelectionStore.value?.[DEVICE_ID]).toBe(1);
        expect(padPressed(1)).toBe('true');
        expect(padPressed(0)).toBe('false');
    });

    it('keeps the clicked pad pressed once the device registers', () => {
        render(<ToasterPanel deviceId={DEVICE_ID} />);
        fireEvent.click(screen.getByTestId('toaster-pad-1'));

        act(() => {
            registerToasterDevice(DEVICE_ID);
        });

        expect(toasterStore.value?.[DEVICE_ID]?.selectedPadIndex).toBe(1);
        expect(padPressed(1)).toBe('true');
        expect(padPressed(0)).toBe('false');
    });
});
