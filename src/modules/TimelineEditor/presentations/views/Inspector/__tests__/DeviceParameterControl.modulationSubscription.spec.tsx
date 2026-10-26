import { Profiler, type ProfilerOnRenderCallback } from 'react';

import { render, act, fireEvent, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { modulationDragPreviewStore, modulationStore, modulationRuntimeStore } from '#/modules/Automation/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectTransitionAuthority } from '#/modules/Project/useCases';

const mockProjectCurrent = vi.hoisted(() => ({ value: true }));
const mockProjectGeneration = vi.hoisted(() => ({ value: 0 }));
const mockSetDeviceParameter = vi.hoisted(() => vi.fn());

vi.mock('#/modules/Project/useCases', () => ({
    captureProjectTransitionAuthority: () => {
        const generation = mockProjectGeneration.value;
        return { isCurrent: () => mockProjectCurrent.value && generation === mockProjectGeneration.value };
    },
}));
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    setDeviceParameter: mockSetDeviceParameter,
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: vi.fn(),
}));

function setDragPreview(modulatorId: string | null): void {
    modulationDragPreviewStore.set({
        modulatorId,
        projectAuthority: modulatorId === null ? null : captureProjectTransitionAuthority(),
    });
}

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
    MidiLearnRotaryKnob: (props: { modulations?: Array<{ amount: number }>; onChange: (value: number) => void }) => (
        <button
            data-testid="rotary-knob"
            data-modulations={JSON.stringify(props.modulations ?? null)}
            onClick={() => props.onChange(0.75)}
        >
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
        mockSetDeviceParameter.mockClear();
        mockProjectCurrent.value = true;
        mockProjectGeneration.value = 0;
        setDragPreview(null);
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

    it('keeps colliding source colors across targets, hover, and the accepted mapping', () => {
        const related = modulationStore.value!.modulators[0]!;
        const colliding = {
            ...related,
            id: 'mod-1',
            mappings: [{ targetTrackId: 'track-1', targetDeviceId: 'device-1', targetParamId: 'rate', amount: -0.4 }],
        };
        act(() => modulationStore.set({ modulators: [related, colliding] }));
        const rateParam = { ...param, id: 'rate', name: 'Rate' };
        render(
            <>
                <DeviceParameterControl param={param} device={device} trackId="track-1" />
                <DeviceParameterControl param={rateParam} device={device} trackId="track-1" />
            </>
        );
        const gainTarget = screen.getByRole('region', { name: 'Modulation target for Gain' });
        const rateTarget = screen.getByRole('region', { name: 'Modulation target for Rate' });
        const halosAt = (target: HTMLElement) =>
            JSON.parse(within(target).getByTestId('rotary-knob').dataset.modulations!) as Array<{
                id: string;
                amount: number;
                color: string;
                activity: number;
                preview?: boolean;
            }>;
        const relatedBefore = halosAt(gainTarget)[0]!;
        const collidingOnRate = halosAt(rateTarget)[0]!;
        expect(relatedBefore.id).toBe('mod-related');
        expect(collidingOnRate.id).toBe('mod-1');

        act(() => setDragPreview('mod-1'));
        fireEvent.dragEnter(gainTarget);
        const preview = halosAt(gainTarget);
        expect(preview.map((halo) => halo.id)).toEqual(['mod-related', 'mod-1']);
        expect(preview[0]).toEqual(relatedBefore);
        expect(preview[1]).toEqual({
            id: 'mod-1',
            amount: 0.5,
            activity: 0,
            color: collidingOnRate.color,
            preview: true,
        });
        expect(relatedBefore.color).not.toBe(collidingOnRate.color);

        fireEvent.drop(gainTarget);
        expect(executeUserAppAction).toHaveBeenCalledTimes(1);
        const [action, options] = vi.mocked(executeUserAppAction).mock.calls[0]!;
        const acceptedMapping = {
            targetTrackId: 'track-1',
            targetDeviceId: 'device-1',
            targetParamId: 'gain',
            amount: 0.5,
        };
        expect(action).toEqual({
            type: 'addMapping',
            payload: {
                modulatorId: 'mod-1',
                mapping: acceptedMapping,
            },
        });
        expect((options as { shouldExecute: () => boolean }).shouldExecute()).toBe(true);
        act(() =>
            modulationStore.set({
                modulators: [related, { ...colliding, mappings: [...colliding.mappings, acceptedMapping] }],
            })
        );
        const committed = halosAt(gainTarget);
        expect(committed.map((halo) => halo.id)).toEqual(['mod-1', 'mod-related']);
        expect(committed.find((halo) => halo.id === 'mod-related')?.color).toBe(relatedBefore.color);
        expect(committed.find((halo) => halo.id === 'mod-1')?.color).toBe(collidingOnRate.color);
        expect(halosAt(rateTarget)[0]?.color).toBe(collidingOnRate.color);
    });

    it('gives every admitted halo a distinct effective color after the preset palette is exhausted', () => {
        const sources = Array.from({ length: 71 }, (_, index) => ({
            ...modulationStore.value!.modulators[0]!,
            id: `mod-${String(index).padStart(4, '0')}`,
        }));
        act(() => modulationStore.set({ modulators: sources }));
        const view = render(<DeviceParameterControl param={param} device={device} trackId="track-1" />);
        const before = JSON.parse(screen.getByTestId('rotary-knob').dataset.modulations!) as Array<{
            id: string;
            color: string;
        }>;
        expect(before).toHaveLength(71);
        expect(new Set(before.map((halo) => halo.color)).size).toBe(71);
        expect(before.find((halo) => halo.id === 'mod-0036')?.color).not.toBe(
            before.find((halo) => halo.id === 'mod-0070')?.color
        );
        act(() => modulationStore.set({ modulators: sources.toReversed() }));
        view.rerender(<DeviceParameterControl param={param} device={device} trackId="track-1" />);
        const after = JSON.parse(screen.getByTestId('rotary-knob').dataset.modulations!) as typeof before;
        expect(Object.fromEntries(after.map((halo) => [halo.id, halo.color]))).toEqual(
            Object.fromEntries(before.map((halo) => [halo.id, halo.color]))
        );
    });

    it('does not reuse a drag entered for another target, even when the same control instance survives', () => {
        act(() =>
            modulationStore.set({
                modulators: modulationStore.value!.modulators.map((mod) => ({ ...mod, mappings: [] })),
            })
        );
        act(() => setDragPreview('mod-related'));
        const view = render(<DeviceParameterControl param={param} device={device} trackId="track-1" />);
        const target = screen.getByRole('region', { name: 'Modulation target for Gain' });
        fireEvent.dragEnter(target);
        expect(JSON.parse(screen.getByTestId('rotary-knob').dataset.modulations!)).toEqual([
            expect.objectContaining({ id: 'mod-related', preview: true }),
        ]);
        view.rerender(<DeviceParameterControl param={param} device={device} trackId="track-2" />);
        expect(screen.getByTestId('rotary-knob').dataset.modulations).toBe('null');
        fireEvent.drop(target);
        expect(executeUserAppAction).not.toHaveBeenCalled();
        view.rerender(<DeviceParameterControl param={param} device={device} trackId="track-1" />);
        fireEvent.drop(target);
        expect(executeUserAppAction).not.toHaveBeenCalled();
        fireEvent.dragEnter(target);
        fireEvent.drop(target);
        expect(executeUserAppAction).toHaveBeenCalledTimes(1);
        expect(executeUserAppAction).toHaveBeenCalledWith(
            expect.objectContaining({
                payload: expect.objectContaining({ mapping: expect.objectContaining({ targetTrackId: 'track-1' }) }),
            }),
            expect.objectContaining({ shouldExecute: expect.any(Function) })
        );
        const shouldExecute = vi.mocked(executeUserAppAction).mock.calls[0]![1] as { shouldExecute: () => boolean };
        expect(shouldExecute.shouldExecute()).toBe(true);
        view.rerender(<DeviceParameterControl param={param} device={device} trackId="track-2" />);
        expect(shouldExecute.shouldExecute()).toBe(false);
        view.rerender(<DeviceParameterControl param={param} device={device} trackId="track-1" />);
        expect(shouldExecute.shouldExecute()).toBe(false);
    });

    it('refuses a drop and a queued action when project authority expires', () => {
        act(() =>
            modulationStore.set({
                modulators: modulationStore.value!.modulators.map((mod) => ({ ...mod, mappings: [] })),
            })
        );
        act(() => setDragPreview('mod-related'));
        const view = render(<DeviceParameterControl param={param} device={device} trackId="track-1" />);
        const target = screen.getByRole('region', { name: 'Modulation target for Gain' });
        fireEvent.dragEnter(target);
        mockProjectCurrent.value = false;
        fireEvent.drop(target);
        expect(executeUserAppAction).not.toHaveBeenCalled();
        mockProjectCurrent.value = true;
        fireEvent.dragEnter(target);
        fireEvent.drop(target);
        expect(executeUserAppAction).toHaveBeenCalledTimes(1);
        const shouldExecute = vi.mocked(executeUserAppAction).mock.calls[0]![1] as { shouldExecute: () => boolean };
        mockProjectCurrent.value = false;
        expect(shouldExecute.shouldExecute()).toBe(false);
        view.unmount();
    });

    it('rejects a drag that began before a project replacement with reused target identities', () => {
        act(() =>
            modulationStore.set({
                modulators: modulationStore.value!.modulators.map((mod) => ({ ...mod, mappings: [] })),
            })
        );
        // Keep the authority captured at source dragstart, then replace the project before target entry.
        act(() => setDragPreview('mod-related'));
        mockProjectGeneration.value += 1;

        render(<DeviceParameterControl param={param} device={device} trackId="track-1" />);
        const target = screen.getByRole('region', { name: 'Modulation target for Gain' });
        fireEvent.dragEnter(target);
        fireEvent.drop(target);

        expect(executeUserAppAction).not.toHaveBeenCalled();
    });

    it('refuses a queued mapping after the source disappears or the control unmounts', () => {
        act(() =>
            modulationStore.set({
                modulators: modulationStore.value!.modulators.map((mod) => ({ ...mod, mappings: [] })),
            })
        );
        act(() => setDragPreview('mod-related'));
        const view = render(<DeviceParameterControl param={param} device={device} trackId="track-1" />);
        const target = screen.getByRole('region', { name: 'Modulation target for Gain' });
        fireEvent.dragEnter(target);
        fireEvent.drop(target);
        const shouldExecute = vi.mocked(executeUserAppAction).mock.calls[0]![1] as { shouldExecute: () => boolean };
        expect(shouldExecute.shouldExecute()).toBe(true);
        act(() =>
            modulationStore.set({
                modulators: modulationStore.value!.modulators.filter((mod) => mod.id !== 'mod-related'),
            })
        );
        expect(shouldExecute.shouldExecute()).toBe(false);
        view.unmount();
        expect(shouldExecute.shouldExecute()).toBe(false);
    });

    it('does not announce or draw a stored mapping that the engine rejects as ineligible', () => {
        render(<DeviceParameterControl param={{ ...param, automatable: false }} device={device} trackId="track-1" />);
        expect(screen.queryByRole('region', { name: 'Modulation target for Gain' })).not.toBeInTheDocument();
        expect(screen.getByTestId('rotary-knob').dataset.modulations).toBe('null');
        fireEvent.click(screen.getByTestId('rotary-knob'));
        expect(mockSetDeviceParameter).toHaveBeenCalledWith('device-1', 'gain', 0.75);
    });

    it('previews a zero-runtime source over an unconnected knob, then commits only on drop', () => {
        const unmapped = modulationStore.value!.modulators.map((modulator) =>
            modulator.id === 'mod-related' ? { ...modulator, mappings: [] } : modulator
        );
        act(() => modulationStore.set({ modulators: unmapped }));
        const view = render(<DeviceParameterControl param={param} device={device} trackId="track-1" />);
        const target = screen.getByRole('region', { name: 'Modulation target for Gain' });
        expect(screen.getByTestId('rotary-knob').dataset.modulations).toBe('null');

        act(() => setDragPreview('mod-unrelated'));
        fireEvent.dragEnter(target);
        expect(JSON.parse(screen.getByTestId('rotary-knob').dataset.modulations!)).toEqual([
            expect.objectContaining({ id: 'mod-unrelated', amount: 0.5, activity: 0, preview: true }),
        ]);
        expect(executeUserAppAction).not.toHaveBeenCalled();
        fireEvent.dragLeave(target);
        expect(screen.getByTestId('rotary-knob').dataset.modulations).toBe('null');
        fireEvent.dragEnter(target);
        act(() => setDragPreview(null));
        expect(screen.getByTestId('rotary-knob').dataset.modulations).toBe('null');
        expect(executeUserAppAction).not.toHaveBeenCalled();
        act(() => setDragPreview('mod-unrelated'));
        fireEvent.drop(target);
        expect(executeUserAppAction).not.toHaveBeenCalled();
        fireEvent.dragEnter(target);
        fireEvent.drop(target);
        expect(executeUserAppAction).toHaveBeenCalledTimes(1);
        expect(executeUserAppAction).toHaveBeenCalledWith(
            {
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
            },
            { shouldExecute: expect.any(Function) }
        );
        // The source owns drag teardown. The target only owns hover and the command.
        expect(modulationDragPreviewStore.value?.modulatorId).toBe('mod-unrelated');
        act(() => setDragPreview(null));
        expect(screen.getByTestId('rotary-knob').dataset.modulations).toBe('null');
        view.unmount();
    });
});
