import { Profiler, type ProfilerOnRenderCallback } from 'react';

import { render, act, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { modulationDragPreviewStore, modulationStore, modulationRuntimeStore } from '#/modules/Automation/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: vi.fn(),
}));

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
        vi.mocked(executeUserAppAction).mockClear();
        modulationDragPreviewStore.set({ modulatorId: null });
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
        const initial = JSON.parse(getByTestId('rotary-knob').dataset.modulations!);
        expect(initial).toEqual([expect.objectContaining({ id: 'mod-related', amount: 1, activity: 0 })]);

        act(() => {
            modulationRuntimeStore.set({ runtimeValues: { 'mod-related': 0.6, 'mod-unrelated': 0 } });
        });

        expect(renderCount).toBeGreaterThan(rendersAfterMount);
        expect(JSON.parse(getByTestId('rotary-knob').dataset.modulations!)).toEqual([
            expect.objectContaining({
                id: 'mod-related',
                amount: 1,
                activity: 0.6,
                color: expect.stringContaining('oklch'),
            }),
        ]);
    });

    it('keeps two source colors distinct and stable when the mappings reorder', () => {
        const second = {
            // This ID hashes to the same palette slot as mod-related.
            id: 'mod-1',
            name: 'Second LFO',
            trackId: 'track-1',
            kind: 'lfo' as const,
            config: { kind: 'lfo' as const, waveform: 'sine' as const, rate: 1, sync: true, phase: 0, depth: 1 },
            mappings: [{ targetTrackId: 'track-1', targetDeviceId: 'device-1', targetParamId: 'gain', amount: -0.4 }],
            enabled: true,
        };
        const first = modulationStore.value!.modulators[0]!;
        act(() => modulationStore.set({ modulators: [first, second] }));
        const view = render(<DeviceParameterControl param={param} device={device} trackId="track-1" />);
        const before = JSON.parse(screen.getByTestId('rotary-knob').dataset.modulations!);
        expect(before).toHaveLength(2);
        expect(before[0].color).not.toBe(before[1].color);
        act(() => modulationStore.set({ modulators: [second, first] }));
        view.rerender(<DeviceParameterControl param={param} device={device} trackId="track-1" />);
        const after = JSON.parse(screen.getByTestId('rotary-knob').dataset.modulations!);
        expect(Object.fromEntries(after.map((halo: { id: string; color: string }) => [halo.id, halo.color]))).toEqual(
            Object.fromEntries(before.map((halo: { id: string; color: string }) => [halo.id, halo.color]))
        );
        view.unmount();
        render(<DeviceParameterControl param={param} device={device} trackId="track-1" />);
        const reloaded = JSON.parse(screen.getByTestId('rotary-knob').dataset.modulations!);
        expect(
            Object.fromEntries(reloaded.map((halo: { id: string; color: string }) => [halo.id, halo.color]))
        ).toEqual(Object.fromEntries(before.map((halo: { id: string; color: string }) => [halo.id, halo.color])));
    });

    it('previews a zero-runtime source over an unconnected knob, then commits only on drop', () => {
        const unmapped = modulationStore.value!.modulators.map((modulator) =>
            modulator.id === 'mod-related' ? { ...modulator, mappings: [] } : modulator
        );
        act(() => modulationStore.set({ modulators: unmapped }));
        const view = render(<DeviceParameterControl param={param} device={device} trackId="track-1" />);
        const target = screen.getByRole('region', { name: 'Modulation target for Gain' });
        expect(screen.getByTestId('rotary-knob').dataset.modulations).toBe('null');

        act(() => modulationDragPreviewStore.set({ modulatorId: 'mod-unrelated' }));
        fireEvent.dragEnter(target);
        expect(JSON.parse(screen.getByTestId('rotary-knob').dataset.modulations!)).toEqual([
            expect.objectContaining({ id: 'mod-unrelated', amount: 0.5, activity: 0, preview: true }),
        ]);
        expect(executeUserAppAction).not.toHaveBeenCalled();
        fireEvent.dragLeave(target);
        expect(screen.getByTestId('rotary-knob').dataset.modulations).toBe('null');
        fireEvent.dragEnter(target);
        act(() => modulationDragPreviewStore.set({ modulatorId: null }));
        expect(screen.getByTestId('rotary-knob').dataset.modulations).toBe('null');
        expect(executeUserAppAction).not.toHaveBeenCalled();
        act(() => modulationDragPreviewStore.set({ modulatorId: 'mod-unrelated' }));
        fireEvent.dragEnter(target);
        fireEvent.drop(target);
        expect(executeUserAppAction).toHaveBeenCalledTimes(1);
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'addMapping',
            payload: {
                modulatorId: 'mod-unrelated',
                mapping: {
                    targetTrackId: 'track-1',
                    targetDeviceId: 'device-1',
                    targetParamId: 'gain',
                    amount: 0.5,
                },
            },
        });
        // The source owns drag teardown. The target only owns hover and the command.
        expect(modulationDragPreviewStore.value?.modulatorId).toBe('mod-unrelated');
        act(() => modulationDragPreviewStore.set({ modulatorId: null }));
        expect(screen.getByTestId('rotary-knob').dataset.modulations).toBe('null');
        view.unmount();
    });
});
