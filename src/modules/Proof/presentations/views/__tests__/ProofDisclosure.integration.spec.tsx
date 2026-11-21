import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    defaultTrackState,
    sanitizeTrackSnapshot,
    trackStore,
    type TrackStoreState,
} from '#/modules/Arrangement/stores';
import { getArrangementHandlers, getPluginById } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import {
    createAutomationLane,
    recordAutomationValue,
    setAutomationRecordingDependencies,
    startAutomationRecording,
    stopAutomationRecording,
} from '#/modules/Automation/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { captureUndoHistory, clearUndoHistory, executeUserAppAction, redo, undo } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { getProofState, proofStore, updateProofMeters } from '../../../stores/proofStore';
import { proofLimiterCeiling } from '../../../useCases/proofParamBridge/proofLimiterCeiling';
import { registerProofDevice } from '../../../useCases/proofParamBridge/registerProofDevice';
import { syncFullPatch } from '../../../useCases/proofParamBridge/syncFullPatch';
import { unregisterProofDevice } from '../../../useCases/proofParamBridge/unregisterProofDevice';
import { resetProofForProject } from '../../../useCases/resetProofForProject';
import { ProofPanel } from '../ProofPanel';

const audioEngine = vi.hoisted(() => ({ updateDeviceParam: vi.fn() }));

let recordingContext: AudioContext;

function getRecordingContext(): AudioContext {
    return recordingContext;
}

function getNoCompensationDelay(): number {
    return 0;
}

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: audioEngine.updateDeviceParam,
}));

function projectParameter(deviceId: string, parameter: string): number | undefined {
    return trackStore.value?.tracks.flatMap((track) => track.devices).find((device) => device.id === deviceId)
        ?.parameterValues?.[parameter];
}

function documentParameter(deviceId: string, parameter: string): number | undefined {
    return getCrdtDoc<{ tracks: Pick<TrackStoreState, 'tracks'> }>('root')
        ?.tracks.tracks.flatMap((track) => track.devices)
        .find((device) => device.id === deviceId)?.parameterValues?.[parameter];
}

async function pressProofSlider(
    name: string,
    initialValue: number,
    nextValue: number,
    parameter: string
): Promise<void> {
    const slider = screen.getByRole('slider', { name });
    expect(Number(slider.getAttribute('aria-valuenow'))).toBeCloseTo(initialValue, 12);
    audioEngine.updateDeviceParam.mockClear();
    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    await waitFor(() => {
        const observedValue = Number(slider.getAttribute('aria-valuenow'));
        expect(observedValue).toBeCloseTo(nextValue, 12);
        expect(projectParameter('a', parameter)).toBe(observedValue);
        expect(documentParameter('a', parameter)).toBe(observedValue);
        expect(audioEngine.updateDeviceParam.mock.calls.map((args) => args.slice(0, 4))).toContainEqual([
            'track',
            'a',
            parameter,
            observedValue,
        ]);
    });
}

async function selectTier(tier: string): Promise<void> {
    const group = screen.getByRole('group', { name: 'Effect control detail' });
    fireEvent.click(within(group).getByRole('button', { name: tier }));
    await waitFor(() =>
        expect(within(group).getByRole('button', { name: tier })).toHaveAttribute('aria-pressed', 'true')
    );
}

function beginCeilingDrag(slider: HTMLElement): void {
    Object.defineProperties(slider, {
        setPointerCapture: { configurable: true, value: vi.fn() },
        releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientY: 100 });
}

function beginMasterCeilingPreview(): HTMLElement {
    const ceiling = screen.getByRole('slider', { name: 'Master limiter ceiling' });
    beginCeilingDrag(ceiling);
    fireEvent.pointerMove(ceiling, { pointerId: 1, clientY: 130 });
    expect(getProofState('a').patch.limCeiling).toBeLessThan(-1);
    return ceiling;
}

describe('Proof cumulative disclosure in project truth', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Proof disclosure view');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        clearUndoHistory();
        registerHandlerMap(getArrangementHandlers());
        audioEngine.updateDeviceParam.mockClear();
        automationStore.set({ lanes: [] });
        transportStore.set(defaultTransportState);
        proofStore.set({ a: getProofState('a'), b: getProofState('b') });
        trackStore.set({
            ...defaultTrackState,
            tracks: sanitizeTrackSnapshot({
                tracks: [
                    {
                        id: 'track',
                        name: 'Mastering',
                        kind: 'audio',
                        devices: [
                            { id: 'a', name: 'Proof A', type: 'proof', bypassed: false, parameterValues: {} },
                            { id: 'b', name: 'Proof B', type: 'proof', bypassed: false, parameterValues: {} },
                        ],
                    },
                ],
            }).tracks,
        });
        flushAutomergeStorageWrites();
    });
    afterEach(() => {
        cleanup();
        unregisterProofDevice('a');
        stopAutomationRecording();
        transportStore.set(defaultTransportState);
        resetProofForProject();
        clearHandlerRegistry();
        trackStore.set({ ...defaultTrackState, tracks: [] });
        flushAutomergeStorageWrites();
        removeCrdtDoc('root');
        configureAutomergeStoragePort(null);
    });

    it('uses the shared five named tiers with Play selected', () => {
        render(<ProofPanel deviceId="a" />);
        const group = screen.getByRole('group', { name: 'Effect control detail' });
        expect(
            within(group)
                .getAllByRole('button')
                .map((button) => button.textContent)
        ).toEqual(['play', 'shape', 'build', 'route', 'lab']);
        expect(within(group).getByRole('button', { name: 'play' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('retains every earlier control region at each higher tier and preserves the patch', async () => {
        render(<ProofPanel deviceId="a" />);
        const patch = getProofState('a').patch;
        for (const [selected, tier] of ['play', 'shape', 'build', 'route', 'lab'].entries()) {
            await selectTier(tier);
            for (const [floor, name] of ['Play', 'Shape', 'Build', 'Route', 'Lab'].entries()) {
                if (floor <= selected) {
                    const region = screen.getByRole('region', { name: `${name} controls` });
                    expect(region).toBeVisible();
                    if (name === 'Lab') {
                        expect(within(region).getByLabelText('Loudness history graph')).toBeVisible();
                    } else {
                        const controls = [
                            'Mission limiter ceiling',
                            'Imager Width',
                            'EQ Low Cut frequency',
                            'Input gain',
                        ];
                        const control = controls[floor];
                        if (!control) {
                            throw new Error(`Missing control proof for ${name}`);
                        }
                        expect(within(region).getByRole('slider', { name: control })).toBeVisible();
                    }
                } else {
                    expect(screen.queryByRole('region', { name: `${name} controls` })).toBeNull();
                }
            }
            expect(screen.getByRole('slider', { name: 'Mission limiter ceiling' })).toBeVisible();
            expect(getProofState('a').patch).toBe(patch);
        }
    });

    it('restores independent saved choices after the panel and session store are recreated', async () => {
        const panel = render(<ProofPanel deviceId="a" />);
        await selectTier('lab');
        panel.rerender(<ProofPanel deviceId="b" />);
        await selectTier('shape');
        panel.unmount();
        act(() => proofStore.set({}));
        const restored = render(<ProofPanel deviceId="a" />);
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'lab' })).toHaveAttribute('aria-pressed', 'true')
        );
        expect(screen.getByRole('region', { name: 'Lab controls' })).toBeVisible();
        restored.rerender(<ProofPanel deviceId="b" />);
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'shape' })).toHaveAttribute('aria-pressed', 'true')
        );
        expect(screen.queryByRole('region', { name: 'Build controls' })).toBeNull();
        expect(screen.getByRole('region', { name: 'Play controls' })).toBeVisible();
    });

    it('shows restored sound parameters without an audio bridge and after cache resets', async () => {
        const project = trackStore.value;
        if (!project) {
            throw new Error('Expected the Proof fixture project');
        }
        trackStore.set({
            ...project,
            tracks: project.tracks.map((track) => ({
                ...track,
                devices: track.devices.map((device) => {
                    if (device.id !== 'a') {
                        return device;
                    }
                    return {
                        ...device,
                        parameterValues: { lim_ceiling: -1.1 },
                        deviceState: { version: 1, data: { disclosureTier: 'lab' } },
                    };
                }),
            })),
        });
        flushAutomergeStorageWrites();
        proofStore.set({});
        render(<ProofPanel deviceId="a" />);

        expect(screen.getByRole('button', { name: /^lab$/ })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('slider', { name: /^Mission limiter ceiling$/ })).toHaveAttribute(
            'aria-valuenow',
            '-1.1'
        );
        await selectTier('play');
        act(() => proofStore.set({}));
        expect(screen.getByRole('button', { name: /^play$/ })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('slider', { name: /^Mission limiter ceiling$/ })).toHaveAttribute(
            'aria-valuenow',
            '-1.1'
        );
    });

    it('re-projects the saved choice after a module-cache reset while the panel stays mounted', async () => {
        render(<ProofPanel deviceId="a" />);
        await selectTier('lab');
        // Project loading resets this cache independently of project truth
        // (resetModuleStoresToDefault); a retained panel must read the saved tier.
        act(() => proofStore.set({}));
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'lab' })).toHaveAttribute('aria-pressed', 'true')
        );
    });

    it('projects a legacy numeric choice without replacing sound or meter values', () => {
        render(<ProofPanel deviceId="a" />);
        // Compare against initialization, before the subsequent metadata projection.
        const instance = getProofState('a');
        act(() =>
            trackStore.set({
                ...trackStore.value!,
                tracks: trackStore.value!.tracks.map((track) => ({
                    ...track,
                    devices: track.devices.map((device) =>
                        device.id === 'a' ? { ...device, deviceState: { version: 1, data: { uiLevel: 4 } } } : device
                    ),
                })),
            })
        );
        expect(screen.getByRole('button', { name: 'route' })).toHaveAttribute('aria-pressed', 'true');
        expect(getProofState('a').patch).toBe(instance.patch);
        expect(getProofState('a').tapPeaks).toBe(instance.tapPeaks);
    });

    it('announces one loudness warning at every tier', async () => {
        updateProofMeters('a', { ...getProofState('a'), integratedLufs: -4 });
        render(<ProofPanel deviceId="a" />);
        for (const tier of ['play', 'shape', 'build', 'route', 'lab']) {
            await selectTier(tier);
            expect(screen.getAllByRole('alert')).toHaveLength(1);
            expect(screen.getByRole('alert')).toHaveTextContent(/LUFS/);
        }
    });

    it('keeps A/B compare runtime-only through the rendered wet/dry round-trip', async () => {
        // Covers the runtime-only wet/dry round-trip. The retained Proof panel
        // E2E continues to exercise application mount, device routing and saved
        // disclosure integration.
        render(<ProofPanel deviceId="a" />);
        const compare = screen.getByRole('button', { name: 'A/B compare' });

        expect(compare).toHaveAttribute('aria-pressed', 'false');
        expect(compare).toHaveTextContent('B / wet');
        expect(getProofState('a').abBypass).toBe(false);

        fireEvent.click(compare);
        await waitFor(() => {
            expect(compare).toHaveAttribute('aria-pressed', 'true');
            expect(compare).toHaveTextContent('A / dry');
            expect(getProofState('a').abBypass).toBe(true);
        });

        fireEvent.click(compare);
        await waitFor(() => {
            expect(compare).toHaveAttribute('aria-pressed', 'false');
            expect(compare).toHaveTextContent('B / wet');
            expect(getProofState('a').abBypass).toBe(false);
        });

        expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues).toEqual({});
        expect(
            getCrdtDoc<{ tracks: Pick<TrackStoreState, 'tracks'> }>('root')?.tracks.tracks[0]?.devices[0]
                ?.parameterValues
        ).toEqual({});
    });

    it('routes every Build module toggle to its own patch and persisted parameter', async () => {
        // Covers each Build module's on/off patch and persisted parameter. The
        // application-level add/open/state witness remains in the Proof panel E2E.
        render(<ProofPanel deviceId="a" />);
        await selectTier('build');

        const modules = [
            { label: 'EQ', key: 'eqBypassed', parameter: 'eq_bypass', initial: false },
            { label: 'Dynamics', key: 'dynBypassed', parameter: 'dyn_bypass', initial: false },
            { label: 'Imager', key: 'imgBypassed', parameter: 'img_bypass', initial: false },
            { label: 'Exciter', key: 'excBypassed', parameter: 'exc_bypass', initial: true },
            { label: 'Limiter', key: 'limBypassed', parameter: 'lim_bypass', initial: false },
        ] as const;
        const buildControls = screen.getByRole('region', { name: 'Build controls' });

        for (const module of modules) {
            const toggle = within(buildControls).getByRole('button', { name: `${module.label} module` });
            const initialPatch = getProofState('a').patch;
            const initialParameters = trackStore.value?.tracks[0]?.devices[0]?.parameterValues;
            expect(initialPatch[module.key]).toBe(module.initial);
            expect(toggle).toHaveAttribute('aria-pressed', String(!module.initial));
            expect(toggle).toHaveTextContent(module.initial ? 'OFF' : 'ON');

            const bypassed = !module.initial;
            fireEvent.click(toggle);
            await waitFor(() => {
                expect(getProofState('a').patch[module.key]).toBe(bypassed);
                expect(toggle).toHaveAttribute('aria-pressed', String(!bypassed));
                expect(toggle).toHaveTextContent(bypassed ? 'OFF' : 'ON');
                expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues?.[module.parameter]).toBe(
                    bypassed ? 1 : 0
                );
            });

            const currentPatch = getProofState('a').patch;
            for (const other of modules) {
                expect(currentPatch[other.key]).toBe(other.key === module.key ? bypassed : initialPatch[other.key]);
            }
            const currentParameters = trackStore.value?.tracks[0]?.devices[0]?.parameterValues;
            expect(currentParameters).toMatchObject({ ...initialParameters, [module.parameter]: bypassed ? 1 : 0 });
            expect(trackStore.value?.tracks[0]?.devices[1]?.parameterValues).toEqual({});

            fireEvent.click(toggle);
            await waitFor(() => {
                expect(getProofState('a').patch[module.key]).toBe(module.initial);
                expect(toggle).toHaveAttribute('aria-pressed', String(!module.initial));
                expect(toggle).toHaveTextContent(module.initial ? 'OFF' : 'ON');
                expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues?.[module.parameter]).toBe(
                    module.initial ? 1 : 0
                );
            });
            const restoredPatch = getProofState('a').patch;
            for (const other of modules) {
                expect(restoredPatch[other.key]).toBe(initialPatch[other.key]);
            }
        }
    });

    it('updates the Build Dynamics Sub threshold and ratio controls independently', async () => {
        // Covers the first Dynamics-band threshold and ratio keyboard values
        // through the real ProofDynSection.
        render(<ProofPanel deviceId="a" />);
        await selectTier('build');

        const initial = getProofState('a').patch;
        await pressProofSlider('Dynamics Sub threshold', -20, -19.5, 'dyn_band0_threshold');
        expect(getProofState('a').patch.dynBands[0]?.threshold).toBe(-19.5);
        expect(getProofState('a').patch.dynBands[0]?.ratio).toBe(initial.dynBands[0]?.ratio);
        expect(projectParameter('b', 'dyn_band0_threshold')).toBeUndefined();

        await pressProofSlider('Dynamics Sub ratio', 2, 2.5, 'dyn_band0_ratio');
        expect(getProofState('a').patch.dynBands[0]?.ratio).toBe(2.5);
        expect(getProofState('a').patch.dynBands[0]?.threshold).toBe(-19.5);
        expect(getProofState('a').patch.dynBands[1]).toEqual(initial.dynBands[1]);
    });

    it('updates the Build EQ Low Cut gain and frequency independently', async () => {
        // Covers the Low Cut gain and frequency keyboard values through the
        // real ProofEqSection.
        render(<ProofPanel deviceId="a" />);
        await selectTier('build');

        const initial = getProofState('a').patch;
        await pressProofSlider('EQ Low Cut gain', 0, 0.5, 'eq_band0_gain');
        expect(getProofState('a').patch.eqBands[0]?.gain).toBe(0.5);
        expect(projectParameter('b', 'eq_band0_gain')).toBeUndefined();

        await pressProofSlider('EQ Low Cut frequency', 30, 31, 'eq_band0_freq');
        expect(getProofState('a').patch.eqBands[0]?.freq).toBe(31);
        expect(getProofState('a').patch.eqBands[0]?.gain).toBe(0.5);
        expect(getProofState('a').patch.eqBands[1]).toEqual(initial.eqBands[1]);
    });

    it('updates the Low-Mid width and Hi-Mid drive with linked bands intact', async () => {
        // Covers the Low-Mid width and Hi-Mid drive writes through the real
        // controls; no audio output is claimed.
        render(<ProofPanel deviceId="a" />);
        await selectTier('build');

        const initial = getProofState('a').patch;
        await pressProofSlider('Imager Low-Mid width', 0.8, 0.81, 'img_width1');
        expect(getProofState('a').patch.imgBandWidth).toEqual([0, 0.81, 1, 1.3]);
        expect(projectParameter('b', 'img_width1')).toBeUndefined();

        await pressProofSlider('Exciter Hi-Mid drive', 0.2, 0.21, 'exc_band2_drive');
        expect(getProofState('a').patch.excBands[2]?.drive).toBe(0.21);
        expect(getProofState('a').patch.excBands[2]?.enabled).toBe(initial.excBands[2]?.enabled);
        expect(getProofState('a').patch.excBands[0]).toEqual(initial.excBands[0]);
    });

    it.each([undefined, -1, -3])('replays a held ceiling from prior value %s on the same panel', async (previous) => {
        const initialParams: Record<string, number> = previous === undefined ? {} : { lim_ceiling: previous };
        const state = trackStore.value;
        if (!state) {
            throw new Error('Missing the Proof fixture project');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => ({
                ...track,
                automationMode: 'touch',
                devices: track.devices.map((device) =>
                    device.id === 'a' ? { ...device, parameterValues: initialParams } : device
                ),
            })),
        });
        flushAutomergeStorageWrites();
        await executeUserAppAction({
            type: 'setDeviceParameter',
            payload: { deviceId: 'b', paramId: 'lim_ceiling', value: -4 },
        });
        const before = captureUndoHistory();
        expect(before.past).toHaveLength(1);
        render(<ProofPanel deviceId="a" />);
        await selectTier('build');
        const ceiling = screen.getByRole('slider', { name: /^Master limiter ceiling$/ });
        const sliders = [
            ceiling,
            screen.getByRole('slider', { name: /^Mission limiter ceiling$/ }),
            screen.getByRole('slider', { name: /^Limiter ceiling$/ }),
        ];
        const assertDisplay = (value: number): void => {
            for (const slider of sliders) {
                expect(Number(slider.getAttribute('aria-valuenow'))).toBeCloseTo(value, 12);
            }
        };
        const assertCanonical = (value: number | undefined): void => {
            const projected = trackStore.value?.tracks[0]?.devices;
            const raw = getCrdtDoc<{ tracks: Pick<TrackStoreState, 'tracks'> }>('root')?.tracks.tracks[0]?.devices;
            for (const devices of [projected, raw]) {
                const params = devices?.find((device) => device.id === 'a')?.parameterValues;
                if (!params) {
                    throw new Error('Missing the addressed Proof parameter row');
                }
                expect(Object.hasOwn(params, 'lim_ceiling')).toBe(value !== undefined);
                expect(params).toEqual(value === undefined ? {} : { lim_ceiling: value });
                expect(devices?.find((device) => device.id === 'b')?.parameterValues).toEqual({ lim_ceiling: -4 });
            }
        };
        const descriptorDefault = getPluginById('proof')?.parameters.find(
            ({ id }) => id === 'lim_ceiling'
        )?.defaultValue;
        expect(descriptorDefault).toBe(-1);
        assertDisplay(previous ?? -1);
        assertCanonical(previous);
        const ceilingLane = createAutomationLane('track', 'a:lim_ceiling', 'Ceiling', -12, 0);
        const sentinelLane = createAutomationLane('track', 'b:input_gain', 'Other device input');
        automationStore.set({ lanes: [ceilingLane, sentinelLane] });
        const context = new AudioContext();
        recordingContext = context;
        setAutomationRecordingDependencies({
            getAudioContext: getRecordingContext,
            getCompensationDelay: getNoCompensationDelay,
        });
        transportStore.set({ ...defaultTransportState, isPlaying: true });
        startAutomationRecording();
        recordAutomationValue('track', 'b:input_gain', 0.7, 1);
        audioEngine.updateDeviceParam.mockClear();
        beginCeilingDrag(ceiling);
        function preview(clientY: number, precedingValue: number): number {
            fireEvent.pointerMove(ceiling, { pointerId: 1, clientY });
            const sample = getProofState('a').patch.limCeiling;
            expect(sample).toBeLessThan(precedingValue);
            assertDisplay(sample);
            assertCanonical(previous);
            expect(captureUndoHistory()).toEqual(before);
            return sample;
        }
        const firstSample = preview(110, previous ?? -1);
        await act(() =>
            executeUserAppAction(
                {
                    type: 'renameTrack',
                    payload: { trackId: 'track', name: 'Renamed while held' },
                },
                { skipUndo: true }
            )
        );
        expect(trackStore.value?.tracks[0]?.name).toBe('Renamed while held');
        assertDisplay(firstSample);
        const lastSample = preview(130, firstSample);
        expect(audioEngine.updateDeviceParam.mock.calls.map((args) => args.slice(0, 3))).toEqual([
            ['track', 'a', 'lim_ceiling'],
            ['track', 'a', 'lim_ceiling'],
        ]);
        audioEngine.updateDeviceParam.mockClear();
        fireEvent.pointerUp(ceiling, { pointerId: 1 });
        await waitFor(() => expect(captureUndoHistory().past).toHaveLength(before.past.length + 1));
        expect(captureUndoHistory().past[0]).toEqual(before.past[0]);
        expect(captureUndoHistory().past.at(-1)).toMatchObject({
            kind: 'action',
            action: {
                type: 'setDeviceParameter',
                payload: {
                    deviceId: 'a',
                    paramId: 'lim_ceiling',
                    value: lastSample,
                    automationRecordingPolicy: 'suppressed',
                },
            },
        });
        assertCanonical(lastSample);
        assertDisplay(lastSample);
        expect(audioEngine.updateDeviceParam.mock.calls.map((args) => args.slice(0, 4))).toEqual([
            ['track', 'a', 'lim_ceiling', lastSample],
        ]);

        audioEngine.updateDeviceParam.mockClear();
        await act(() => undo());
        assertCanonical(previous);
        assertDisplay(previous ?? -1);
        expect(captureUndoHistory().past).toEqual(before.past);
        expect(audioEngine.updateDeviceParam.mock.calls.map((args) => args.slice(0, 4))).toEqual([
            ['track', 'a', 'lim_ceiling', previous ?? -1],
        ]);

        audioEngine.updateDeviceParam.mockClear();
        await act(() => redo());
        assertCanonical(lastSample);
        assertDisplay(lastSample);
        expect(captureUndoHistory().past).toHaveLength(before.past.length + 1);
        expect(audioEngine.updateDeviceParam.mock.calls.map((args) => args.slice(0, 4))).toEqual([
            ['track', 'a', 'lim_ceiling', lastSample],
        ]);
        act(() => stopAutomationRecording());
        expect(automationStore.value?.lanes.map(({ parameterId, points }) => ({ parameterId, points }))).toEqual([
            { parameterId: 'a:lim_ceiling', points: [] },
            { parameterId: 'b:input_gain', points: [{ beat: 1, value: 0.7, curve: 'linear', tension: 0 }] },
        ]);
    });

    it('carries a held ceiling into its first runtime registration and replays its one history entry', async () => {
        render(<ProofPanel deviceId="a" />);
        const ceiling = beginMasterCeilingPreview();
        const preview = getProofState('a').patch.limCeiling;
        const baselineHistory = captureUndoHistory();
        const previewWrite = audioEngine.updateDeviceParam.mock.calls.at(-1);
        expect(previewWrite).toEqual(['track', 'a', 'lim_ceiling', preview, expect.any(Symbol)]);
        expect(documentParameter('a', 'lim_ceiling')).toBeUndefined();
        audioEngine.updateDeviceParam.mockClear();

        act(() => {
            registerProofDevice({ deviceId: 'a', bridge: { reorderModules: vi.fn(), resetIntegrated: vi.fn() } });
            syncFullPatch('a');
        });
        const mountedWhileHeld = Number(ceiling.getAttribute('aria-valuenow'));
        const registrationWrite = audioEngine.updateDeviceParam.mock.calls.find(([, , key]) => key === 'lim_ceiling');
        expect(documentParameter('a', 'lim_ceiling')).toBeUndefined();
        expect(captureUndoHistory()).toEqual(baselineHistory);

        fireEvent.pointerUp(ceiling, { pointerId: 1 });
        await waitFor(() => expect(documentParameter('a', 'lim_ceiling')).toBe(preview));
        expect(projectParameter('a', 'lim_ceiling')).toBe(preview);
        expect(captureUndoHistory().past).toHaveLength(baselineHistory.past.length + 1);
        expect(mountedWhileHeld).toBe(preview);
        expect(registrationWrite).toEqual(previewWrite);
        expect(Number(ceiling.getAttribute('aria-valuenow'))).toBe(preview);

        await act(() => undo());
        expect(documentParameter('a', 'lim_ceiling')).toBeUndefined();
        expect(projectParameter('a', 'lim_ceiling')).toBeUndefined();
        expect(ceiling).toHaveAttribute('aria-valuenow', '-1');
        await act(() => redo());
        expect(documentParameter('a', 'lim_ceiling')).toBe(preview);
        expect(projectParameter('a', 'lim_ceiling')).toBe(preview);
        expect(Number(ceiling.getAttribute('aria-valuenow'))).toBe(preview);
    });

    it('retires an old ceiling drag when a registered Proof bridge is replaced', async () => {
        registerProofDevice({ deviceId: 'a', bridge: { reorderModules: vi.fn(), resetIntegrated: vi.fn() } });
        render(<ProofPanel deviceId="a" />);
        const ceiling = beginMasterCeilingPreview();
        act(() => {
            registerProofDevice({ deviceId: 'a', bridge: { reorderModules: vi.fn(), resetIntegrated: vi.fn() } });
            syncFullPatch('a');
        });
        expect(ceiling).toHaveAttribute('aria-valuenow', '-1');
        audioEngine.updateDeviceParam.mockClear();
        await act(async () => {
            fireEvent.pointerUp(ceiling, { pointerId: 1 });
        });
        expect(audioEngine.updateDeviceParam).not.toHaveBeenCalled();
        expect(documentParameter('a', 'lim_ceiling')).toBeUndefined();
        expect(projectParameter('a', 'lim_ceiling')).toBeUndefined();
        expect(captureUndoHistory().past).toEqual([]);
    });

    it('settles successive ceiling releases before the bypass write waiting on them', async () => {
        render(<ProofPanel deviceId="a" />);
        await selectTier('shape');
        const entered = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const barrier = transactSnapshot(async () => {
            entered.resolve();
            await held.promise;
        });
        await entered.promise;
        const writes: (number | undefined)[] = [];
        const unsubscribe = trackStore.subscribe(() => {
            if (projectParameter('a', 'eq_bypass') === 1) {
                writes.push(projectParameter('a', 'lim_ceiling'));
            }
        });
        try {
            const ceiling = beginMasterCeilingPreview();
            const first = getProofState('a').patch.limCeiling;
            fireEvent.pointerUp(ceiling, { pointerId: 1 });
            fireEvent.keyDown(ceiling, { key: 'Home' });
            fireEvent.click(screen.getByRole('button', { name: 'EQ module' }));
            expect(projectParameter('a', 'eq_bypass')).toBeUndefined();
            expect(captureUndoHistory().past).toEqual([]);
            held.resolve();
            await barrier;
            await waitFor(() => expect(documentParameter('a', 'eq_bypass')).toBe(1));
            expect(writes[0]).toBe(-12);
            expect(captureUndoHistory().past).toMatchObject([
                { action: { type: 'setDeviceParameter', payload: { paramId: 'lim_ceiling', value: first } } },
                { action: { type: 'setDeviceParameter', payload: { paramId: 'lim_ceiling', value: -12 } } },
            ]);
        } finally {
            held.resolve();
            await barrier;
            unsubscribe();
        }
    });

    it('refuses the held release and its waiting bypass when the owner freezes during admission', async () => {
        render(<ProofPanel deviceId="a" />);
        await selectTier('shape');
        const entered = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const barrier = transactSnapshot(async (snapshotTransaction) => {
            entered.resolve();
            await held.promise;
            mutateCrdtDoc<{ tracks: TrackStoreState }>({
                id: 'root',
                snapshotTransaction,
                changeFn: (doc) => {
                    const track = doc.tracks.tracks[0];
                    if (!track) {
                        throw new Error('Missing the Proof owner');
                    }
                    track.frozen = true;
                },
            });
            trackStore.hydrate();
        });
        await entered.promise;
        try {
            const ceiling = beginMasterCeilingPreview();
            fireEvent.click(screen.getByRole('button', { name: 'EQ module' }));
            const settlement = proofLimiterCeiling.settlement('a');
            if (!settlement) {
                throw new Error('Expected the limiter action to wait on the open snapshot');
            }
            await act(async () => {
                held.resolve();
                await barrier;
                await settlement.done;
            });
            fireEvent.pointerUp(ceiling, { pointerId: 1 });
            expect(trackStore.value?.tracks[0]?.frozen).toBe(true);
            expect(projectParameter('a', 'lim_ceiling')).toBeUndefined();
            expect(documentParameter('a', 'eq_bypass')).toBeUndefined();
            expect(captureUndoHistory().past).toEqual([]);
            expect(ceiling).toHaveAttribute('aria-valuenow', '-1');
        } finally {
            held.resolve();
            await barrier;
        }
    });

    it('restores just the held preview when the mounted panel switches devices', () => {
        const panel = render(<ProofPanel deviceId="a" />);
        const ceiling = beginMasterCeilingPreview();
        panel.rerender(<ProofPanel deviceId="b" />);
        fireEvent.pointerUp(ceiling, { pointerId: 1 });
        expect(getProofState('a').patch.limCeiling).toBe(-1);
        expect(getProofState('b').patch.limCeiling).toBe(-1);
        expect(captureUndoHistory().past).toEqual([]);
        expect(documentParameter('a', 'lim_ceiling')).toBeUndefined();
        expect(documentParameter('b', 'lim_ceiling')).toBeUndefined();
    });

    it('settles a held ceiling once when its panel closes', async () => {
        const panel = render(<ProofPanel deviceId="a" />);
        beginMasterCeilingPreview();
        const preview = getProofState('a').patch.limCeiling;
        panel.unmount();
        await waitFor(() => expect(captureUndoHistory().past).toHaveLength(1));
        expect(documentParameter('a', 'lim_ceiling')).toBe(preview);
    });

    it('writes the Check, Mission, and Build limiter ceiling surfaces through their rendered controls', async () => {
        // Covers the Check and Build limiter-ceiling widget surfaces. Keep the
        // Mission E2E as the application-level browser keyboard witness.
        render(<ProofPanel deviceId="a" />);

        await pressProofSlider('Master limiter ceiling', -1, -0.9, 'lim_ceiling');
        expect(getProofState('a').patch.limCeiling).toBeCloseTo(-0.9, 12);
        expect(projectParameter('b', 'lim_ceiling')).toBeUndefined();

        await selectTier('play');
        await pressProofSlider('Mission limiter ceiling', -0.9, -0.8, 'lim_ceiling');
        expect(getProofState('a').patch.limCeiling).toBeCloseTo(-0.8, 12);

        await selectTier('build');
        await pressProofSlider('Limiter ceiling', -0.8, -0.7, 'lim_ceiling');
        expect(getProofState('a').patch.limCeiling).toBeCloseTo(-0.7, 12);
        expect(documentParameter('b', 'lim_ceiling')).toBeUndefined();
    });
});
