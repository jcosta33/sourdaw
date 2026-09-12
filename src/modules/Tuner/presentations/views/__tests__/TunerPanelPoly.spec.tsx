import { render, screen, act, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { updateDeviceParam } from '#/modules/AudioEngine/useCases';

// The real telemetry → display path: the real tuner store, the real
// useStoreSelector subscription, the real setDisplayMode use case, and the real
// TunerPanel. Only the two cross-module doors are faked — the Arrangement
// barrel (write-target resolution + a stand-in trackStore for the reference
// knob) and the AudioEngine engine-write door (updateDeviceParam, which in the
// live app posts the worklet param message). Pushing frames through
// updateTunerTelemetry stands in for the worklet message boundary exactly where
// the runtime sink hands telemetry over in production.

const { resolveEligibleDeviceWriteTarget } = vi.hoisted(() => ({
    resolveEligibleDeviceWriteTarget:
        vi.fn<(deviceId: string) => { status: 'eligible'; trackId: string; deviceId: string }>(),
}));

vi.mock('#/modules/Arrangement/stores', async () => {
    const { createStore } = await import('#/infra/store/createStore');
    return {
        trackStore: createStore<{ tracks: [] }>({ initialData: { tracks: [] } }),
        resolveEligibleDeviceWriteTarget,
    };
});

vi.mock('#/modules/AudioEngine/useCases', () => ({
    startFaustNote: vi.fn(),
    updateDeviceParam: vi.fn(),
    importScoringTuning: vi.fn(),
}));

import { tunerStore, updateTunerTelemetry } from '../../../stores/tunerStore';
import { TunerPanel } from '../TunerPanel';

const DEVICE_ID = 'device-poly';
// A rendered string readout: sign, one decimal, trailing c. Anchored so the
// guide card's "±2c" and the metric tiles cannot masquerade as string rows.
const CENTS_READOUT = /^[+-]\d+\.\dc$/;

/** Six sounding strings, all in tune — the "strummed all open strings" frame. */
function allOpenStrings(): Parameters<typeof updateTunerTelemetry>[1] {
    return {
        polyStrings: [0, 1, 2, 3, 4, 5].map((i) => ({ active: true, cents: 0, confidence: 0.9 - i * 0.05 })),
    };
}

describe('TunerPanel Poly display — engine telemetry to string rows', () => {
    let polyDisplay: HTMLElement;

    beforeEach(() => {
        vi.mocked(updateDeviceParam).mockClear();
        resolveEligibleDeviceWriteTarget.mockReset();
        resolveEligibleDeviceWriteTarget.mockImplementation((deviceId: string) => ({
            status: 'eligible',
            trackId: 'track-1',
            deviceId,
        }));
        tunerStore.set({});
    });

    function selectPolyMode(): void {
        render(<TunerPanel deviceId={DEVICE_ID} />);
        fireEvent.click(screen.getByRole('button', { name: 'Poly display mode' }));
        polyDisplay = screen.getByTestId('tuner-poly-display');
    }

    it('renders every string row at its silence state on a fresh Poly selection', () => {
        selectPolyMode();

        for (const label of ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']) {
            expect(within(polyDisplay).getByText(label)).toBeInTheDocument();
        }
        // No string has been detected: six em dashes, no cents readouts.
        expect(within(polyDisplay).getAllByText('—')).toHaveLength(6);
        expect(within(polyDisplay).queryByText(CENTS_READOUT)).not.toBeInTheDocument();
    });

    it('renders each sounding string with its cents offset after a full open chord', () => {
        selectPolyMode();
        act(() => {
            updateTunerTelemetry(DEVICE_ID, {
                polyStrings: [
                    { active: true, cents: 0, confidence: 0.9 },
                    { active: true, cents: 3.4, confidence: 0.85 },
                    { active: true, cents: -2.1, confidence: 0.8 },
                    { active: true, cents: 1.2, confidence: 0.75 },
                    { active: true, cents: -0.6, confidence: 0.7 },
                    { active: true, cents: 5.8, confidence: 0.65 },
                ],
            });
        });

        for (const readout of ['+0.0c', '+3.4c', '-2.1c', '+1.2c', '-0.6c', '+5.8c']) {
            expect(within(polyDisplay).getByText(readout)).toBeInTheDocument();
        }
        expect(within(polyDisplay).queryByText('—')).not.toBeInTheDocument();
    });

    it('updates a detuned string on its own row and settles on the latest frame', () => {
        selectPolyMode();
        act(() => {
            updateTunerTelemetry(DEVICE_ID, allOpenStrings());
        });
        expect(within(polyDisplay).getAllByText('+0.0c')).toHaveLength(6);

        act(() => {
            updateTunerTelemetry(DEVICE_ID, {
                polyStrings: [
                    { active: true, cents: 0, confidence: 0.9 },
                    { active: true, cents: -14.2, confidence: 0.8 },
                    { active: true, cents: 0, confidence: 0.8 },
                    { active: true, cents: 0, confidence: 0.8 },
                    { active: true, cents: 0, confidence: 0.8 },
                    { active: true, cents: 0, confidence: 0.8 },
                ],
            });
        });

        expect(within(polyDisplay).getByText('-14.2c')).toBeInTheDocument();
        expect(within(polyDisplay).getAllByText('+0.0c')).toHaveLength(5);
    });

    it('returns a released string to its silence state without touching the others', () => {
        selectPolyMode();
        act(() => {
            updateTunerTelemetry(DEVICE_ID, allOpenStrings());
        });

        act(() => {
            updateTunerTelemetry(DEVICE_ID, {
                polyStrings: [
                    { active: true, cents: 0, confidence: 0.9 },
                    { active: true, cents: 0, confidence: 0.85 },
                    { active: true, cents: 0, confidence: 0.8 },
                    { active: false, cents: 0, confidence: 0.02 },
                    { active: true, cents: 0, confidence: 0.7 },
                    { active: true, cents: 0, confidence: 0.65 },
                ],
            });
        });

        expect(within(polyDisplay).getAllByText('—')).toHaveLength(1);
        expect(within(polyDisplay).getAllByText('+0.0c')).toHaveLength(5);
    });

    it('clears every row when the publication goes quiet, as on device bypass', () => {
        // The worklet zeroes the slot on the bypass transition (covered at the
        // processor level in scoringProcessor.spec); to the panel that arrives
        // as a frame with no active strings.
        selectPolyMode();
        act(() => {
            updateTunerTelemetry(DEVICE_ID, allOpenStrings());
        });
        expect(within(polyDisplay).getAllByText('+0.0c')).toHaveLength(6);

        act(() => {
            updateTunerTelemetry(DEVICE_ID, { active: false, polyStrings: [] });
        });

        expect(within(polyDisplay).getAllByText('—')).toHaveLength(6);
        expect(within(polyDisplay).queryByText(CENTS_READOUT)).not.toBeInTheDocument();
    });

    it('drives the engine poly tracker off and back on across mode switches', () => {
        render(<TunerPanel deviceId={DEVICE_ID} />);

        fireEvent.click(screen.getByRole('button', { name: 'Poly display mode' }));
        fireEvent.click(screen.getByRole('button', { name: 'Needle display mode' }));
        fireEvent.click(screen.getByRole('button', { name: 'Poly display mode' }));

        // Entering Poly arms the guitar string set and the tracker; leaving
        // disarms the tracker; re-entering re-arms both.
        expect(vi.mocked(updateDeviceParam).mock.calls).toEqual([
            ['track-1', DEVICE_ID, 'instrument', 0],
            ['track-1', DEVICE_ID, 'poly', 1],
            ['track-1', DEVICE_ID, 'poly', 0],
            ['track-1', DEVICE_ID, 'instrument', 0],
            ['track-1', DEVICE_ID, 'poly', 1],
        ]);
        // The display is showing the poly rows again after the round trip.
        expect(screen.getByTestId('tuner-poly-display')).toBeInTheDocument();
    });

    it('reflects the selected mode through the real setDisplayMode use case', () => {
        render(<TunerPanel deviceId={DEVICE_ID} />);

        fireEvent.click(screen.getByRole('button', { name: 'Poly display mode' }));

        expect(screen.getByRole('button', { name: 'Poly display mode' })).toHaveAttribute('aria-pressed', 'true');
        expect(tunerStore.value?.[DEVICE_ID]?.mode).toBe('poly');
    });
});
