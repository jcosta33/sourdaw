import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The layout reads live loudness readings through the AudioEngine use case;
// the spec drives that seam directly, the same way LufsMeterLayout.spec does
// for `getFaustMeterReading`. Everything else is real — in particular
// DeviceInspector with its real layout registrations, because the readout is
// only "visible" when `builtin-lufs-meter` resolves to this layout instead of
// the generic parameter list.
const readings = vi.hoisted(() => ({
    current: null as null | {
        momentary: number;
        shortTerm: number;
        integrated: number;
    },
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getBuiltinLufsMeterReading: vi.fn(() => readings.current),
}));

import { DeviceInspector } from '../../DeviceInspector';

import type { Device } from '../../../../../models/TrackViewTypes';

const DEVICE_ID = 'dev-builtin-lufs';

const makeDevice = (): Device => ({
    id: DEVICE_ID,
    name: 'LUFS Meter',
    type: 'builtin-lufs-meter',
    bypassed: false,
    parameterValues: { 'lufs-target': -14, 'lufs-window': 0 },
});

/** Fire one animation frame of the layout's rAF poll loop. */
const fireFrame = () =>
    act(() => {
        vi.advanceTimersByTime(16);
    });

describe('builtin LUFS Meter inspector readouts (#3740)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        readings.current = null;
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders the meter readouts and the target for the device', () => {
        readings.current = { momentary: -12.3, shortTerm: -18.7, integrated: -15.4 };

        render(<DeviceInspector device={makeDevice()} trackId="track-1" onBack={() => {}} />);
        fireFrame();

        expect(screen.getByTestId('builtin-lufs-reading-momentary').textContent).toContain('-12.3 LUFS');
        expect(screen.getByTestId('builtin-lufs-reading-shortTerm').textContent).toContain('-18.7 LUFS');
        expect(screen.getByTestId('builtin-lufs-reading-integrated').textContent).toContain('-15.4 LUFS');
        expect(screen.getByTestId('builtin-lufs-target').textContent).toContain('-14.0 LUFS');
    });

    it('updates the readouts when the engine reports a new measurement', () => {
        readings.current = { momentary: -12.3, shortTerm: -18.7, integrated: -15.4 };

        render(<DeviceInspector device={makeDevice()} trackId="track-1" onBack={() => {}} />);
        fireFrame();
        expect(screen.getByTestId('builtin-lufs-reading-momentary').textContent).toContain('-12.3 LUFS');

        readings.current = { momentary: -9.5, shortTerm: -18.7, integrated: -15.4 };
        act(() => {
            vi.advanceTimersByTime(120);
        });
        expect(screen.getByTestId('builtin-lufs-reading-momentary').textContent).toContain('-9.5 LUFS');
    });

    it('shows placeholders while the device has no reading yet', () => {
        render(<DeviceInspector device={makeDevice()} trackId="track-1" onBack={() => {}} />);
        fireFrame();

        expect(screen.getByTestId('builtin-lufs-reading-momentary').textContent).toContain('—');
        expect(screen.getByTestId('builtin-lufs-target').textContent).toContain('-14.0 LUFS');
    });
});
