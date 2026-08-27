import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The layout reads live bargraph readings through the AudioEngine use case;
// the spec drives that seam directly, as TrackLevelIndicator.spec does for
// `getTrackAnalyser`. Everything else here is real — in particular
// DeviceInspector with its real layout registrations, because the defect this
// spec pins is that `faust-lufs-meter` resolved to the generic Faust
// instrument placeholder ("This instrument is loading...") instead of a meter.
const readings = vi.hoisted(() => new Map<string, number | null>());

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getFaustMeterReading: vi.fn(
        (deviceId: string, paramId: string): number | null => readings.get(`${deviceId}:${paramId}`) ?? null
    ),
}));

import { DeviceInspector } from '../../DeviceInspector';

import type { Device } from '../../../../../models/TrackViewTypes';

const DEVICE_ID = 'dev-lufs';

const makeDevice = (): Device => ({
    id: DEVICE_ID,
    name: 'LUFS Meter',
    type: 'faust-lufs-meter',
    bypassed: false,
    parameterValues: {},
});

/** Fire one animation frame of the layout's rAF poll loop. */
const fireFrame = () =>
    act(() => {
        vi.advanceTimersByTime(16);
    });

describe('LUFS Meter inspector readouts', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        readings.clear();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders both momentary and short-term readings for the device', () => {
        readings.set(`${DEVICE_ID}:momentary`, -12.3);
        readings.set(`${DEVICE_ID}:short_term`, -18.7);

        render(<DeviceInspector device={makeDevice()} trackId="track-1" onBack={() => {}} />);
        fireFrame();

        expect(screen.getByTestId('lufs-reading-momentary').textContent).toContain('-12.3 LUFS');
        expect(screen.getByTestId('lufs-reading-short_term').textContent).toContain('-18.7 LUFS');
        expect(screen.getByText('Momentary (LUFS)')).toBeTruthy();
        expect(screen.getByText('Short-Term (LUFS)')).toBeTruthy();
    });

    it('updates the rendered reading when the posted value changes', () => {
        readings.set(`${DEVICE_ID}:momentary`, -12.3);

        render(<DeviceInspector device={makeDevice()} trackId="track-1" onBack={() => {}} />);
        fireFrame();
        expect(screen.getByTestId('lufs-reading-momentary').textContent).toContain('-12.3 LUFS');

        // The DSP posts a new momentary loudness; the next poll must pick it up
        // (the React update is throttled to ~10 fps, so pass that window).
        readings.set(`${DEVICE_ID}:momentary`, -9.5);
        act(() => {
            vi.advanceTimersByTime(120);
        });

        expect(screen.getByTestId('lufs-reading-momentary').textContent).toContain('-9.5 LUFS');
    });

    it('distinguishes the silence floor from a device that has posted nothing', () => {
        readings.set(`${DEVICE_ID}:momentary`, -70);

        render(<DeviceInspector device={makeDevice()} trackId="track-1" onBack={() => {}} />);
        fireFrame();

        // -70 is the DSP's `lufs(ms)` floor, rendered as -∞ like the master
        // LUFS meter; a missing reading (short_term here) renders a dash.
        expect(screen.getByTestId('lufs-reading-momentary').textContent).toContain('-∞ LUFS');
        expect(screen.getByTestId('lufs-reading-short_term').textContent).toContain('—');
    });
});
