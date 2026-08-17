import { Profiler, type ProfilerOnRenderCallback } from 'react';

import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { modulationStore, modulationRuntimeStore } from '#/modules/Automation/stores';

import { DeviceParameterControl } from '../DeviceParameterControl';

import type { DeviceParameterView } from '../../../../models/PluginDescriptorViewTypes';
import type { Device } from '../../../../models/TrackViewTypes';

// This file deliberately does NOT mock `#/infra/store/useStore`,
// `#/infra/store/useStoreSelector`, or `#/modules/Automation/stores` — the
// point is to exercise the real subscription wiring so a render-count probe
// on `modulationRuntimeStore` updates is meaningful (audit M5).
//
// The probe is a `<Profiler onRender>` around the control, not a call count
// on a mocked child: React (and, in the shipped build, the React Compiler)
// can memoize a child's *props* into an unchanged element and skip calling
// it even when the parent's function body re-ran — which would hide the
// exact cost this fix removes. `useSyncExternalStore`'s equality check runs
// *before* React schedules any work on the fiber, so `onRender` firing is
// the only reliable signal that `DeviceParameterControl` itself re-executed.

vi.mock('#/components/daw/DawCompactSelect', () => ({
    DawCompactSelect: () => <select data-testid="compact-select" />,
}));

vi.mock('#/components/ui/bipolar-slider', () => ({
    BipolarSlider: () => <input data-testid="bipolar-slider" />,
}));

vi.mock('#/modules/ControlSurface/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/ControlSurface/presentations/views')>()),
    MidiLearnButton: () => <button data-testid="midi-learn-btn">Learn</button>,
    MidiLearnRotaryKnob: (props: { modulations?: Array<{ amount: number }> }) => (
        <button data-testid="rotary-knob" data-modulations={JSON.stringify(props.modulations ?? null)}>
            Knob
        </button>
    ),
}));

describe('DeviceParameterControl modulation subscription (audit M5)', () => {
    const device: Device = {
        id: 'device-1',
        name: 'Test Device',
        type: 'effect',
        bypassed: false,
        parameterValues: { gain: 0.5 },
    };

    const param: DeviceParameterView = {
        id: 'gain',
        deviceId: 'device-1',
        name: 'Gain',
        type: 'float',
        value: 0.5,
        defaultValue: 0.5,
        minValue: 0,
        maxValue: 1,
        unit: '',
        automatable: true,
        hasAutomation: false,
    };

    let renderCount: number;
    const onRender: ProfilerOnRenderCallback = () => {
        renderCount += 1;
    };

    beforeEach(() => {
        renderCount = 0;
        modulationStore.set({
            modulators: [
                {
                    id: 'mod-related',
                    name: 'Related LFO',
                    trackId: 'track-1',
                    kind: 'lfo',
                    config: { kind: 'lfo', waveform: 'sine', rate: 1, sync: true, phase: 0, depth: 1 },
                    mappings: [
                        { targetTrackId: 'track-1', targetDeviceId: 'device-1', targetParamId: 'gain', amount: 1 },
                    ],
                    enabled: true,
                },
                {
                    id: 'mod-unrelated',
                    name: 'Unrelated LFO',
                    trackId: 'track-1',
                    kind: 'lfo',
                    config: { kind: 'lfo', waveform: 'sine', rate: 1, sync: true, phase: 0, depth: 1 },
                    mappings: [
                        {
                            targetTrackId: 'track-1',
                            targetDeviceId: 'device-1',
                            targetParamId: 'other-param',
                            amount: 1,
                        },
                    ],
                    enabled: true,
                },
            ],
        });
        modulationRuntimeStore.set({ runtimeValues: { 'mod-related': 0, 'mod-unrelated': 0 } });
    });

    it('does not re-render when a runtime tick updates a modulator not mapped to this parameter', () => {
        render(
            <Profiler id="probe" onRender={onRender}>
                <DeviceParameterControl param={param} device={device} trackId="track-1" />
            </Profiler>
        );
        const rendersAfterMount = renderCount;
        expect(rendersAfterMount).toBeGreaterThan(0);

        act(() => {
            modulationRuntimeStore.set({ runtimeValues: { 'mod-related': 0, 'mod-unrelated': 0.8 } });
        });

        expect(renderCount).toBe(rendersAfterMount);
    });

    it('re-renders and updates the modulation amount when the mapped modulator ticks', () => {
        const { getByTestId } = render(
            <Profiler id="probe" onRender={onRender}>
                <DeviceParameterControl param={param} device={device} trackId="track-1" />
            </Profiler>
        );
        const rendersAfterMount = renderCount;
        expect(getByTestId('rotary-knob').dataset.modulations).toBe('null');

        act(() => {
            modulationRuntimeStore.set({ runtimeValues: { 'mod-related': 0.6, 'mod-unrelated': 0 } });
        });

        expect(renderCount).toBeGreaterThan(rendersAfterMount);
        expect(JSON.parse(getByTestId('rotary-knob').dataset.modulations!)).toEqual([
            { id: 'Gain', amount: 0.6, color: 'var(--color-accent-cyan)' },
        ]);
    });
});
