import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { spy } from '#/infra/di/testing/spy';
import { type Track, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';

import { DEFAULT_PATCH } from '../../../models/GrinderPatch';
import { grinderNeuralLibraryStore } from '../../../stores/grinderNeuralLibraryStore';
import { getGrinderState, grinderStore } from '../../../stores/grinderStore';
import { grinderParamBridgeDependencies } from '../../../useCases/grinderParamBridge/grinderParamBridgeDependencies';
import { loadGrinderPatchWithAudio } from '../../../useCases/grinderParamBridge/loadGrinderPatchWithAudio';
import { GrinderPanel } from '../GrinderPanel';

vi.mock('../../../useCases/importGrinderNeuralModels', () => ({
    importGrinderNeuralModels: vi.fn(async () => []),
}));

vi.mock('../../../useCases/restoreGrinderNeuralLibrary', () => ({
    restoreGrinderNeuralLibrary: vi.fn(async () => undefined),
}));

// These pre-existing cases exercise the complete advanced surface. Project-backed
// tier selection, admission and defaults are exercised without this fixture in
// GrinderDisclosure.integration.spec.tsx.
vi.mock('../../../models/GrinderDisclosure', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../models/GrinderDisclosure')>()),
    grinderDisclosureLevelFromState: () => 5,
}));

describe('GrinderPanel', () => {
    const device_id = 'test-device';

    function grinderTrack(parameterValues: Record<string, number>, trackId = 'track-1', deviceId = device_id): Track {
        return {
            ...createTrack({ id: trackId, name: 'Guitar', kind: 'audio' }),
            devices: [{ id: deviceId, name: 'Grinder', type: 'grinder', bypassed: false, parameterValues }],
        };
    }

    function setProjectTracks(tracks: Track[]): void {
        trackStore.set({ tracks, selectedTrackId: tracks[0]?.id ?? null, ghostClips: [] });
    }

    beforeEach(() => {
        grinderNeuralLibraryStore.set({
            hydrated: true,
            loading: false,
            importing: false,
            error: null,
            entries: [],
        });
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'lab',
                    gateEnabled: true,
                },
                basePatch: DEFAULT_PATCH,
            },
        });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

    it('should render an explicit gate enable toggle in the lab section', () => {
        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.getByRole('button', { name: 'Gate On' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('should render an enabled drive pedal as pressed when the stored patch enables it', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'drive',
                    prePedals: [
                        {
                            id: 'od1',
                            type: 'overdrive',
                            enabled: true,
                            params: { drive: 4.5, tone: 5.5, level: 6.8 },
                        },
                    ],
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.getByRole('button', { name: 'Overdrive' })).toHaveAttribute('aria-pressed', 'true');
        for (const parameter of ['Drive', 'Tone', 'Level']) {
            expect(screen.getByRole('slider', { name: `Overdrive ${parameter}` })).toBeInTheDocument();
        }
    });

    it('should show non-duplicated neural status content instead of a repeated mode guide', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'neural',
                    engineMode: 'capture',
                    neuralEnabled: true,
                    neuralModelName: 'Factory Voice A',
                    neuralModelFamily: 'NAM-compatible',
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.queryByText('Mode guide')).not.toBeInTheDocument();
        expect(screen.getByText('Signal path')).toBeInTheDocument();
        expect(
            screen.getByText(/selecting a library voice now swaps the active built-in capture profile/i)
        ).toBeInTheDocument();
    });

    it('should render the imported captures section in the Neural browser', () => {
        grinderNeuralLibraryStore.set({
            hydrated: true,
            loading: false,
            importing: false,
            error: null,
            entries: [],
        });
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'neural',
                    engineMode: 'capture',
                    neuralEnabled: true,
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.getByText('Imported captures')).toBeInTheDocument();
    });

    it('should keep a patch-only imported fallback visible when the reusable library entry is gone', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'neural',
                    engineMode: 'capture',
                    neuralEnabled: true,
                    neuralModelId: 'imported-tight-rhythm',
                    neuralModelName: 'Tight Rhythm',
                    neuralModelFamily: 'NAM import',
                    neuralModelSource: 'imported',
                    neuralPlacement: 'amp-capture',
                    neuralModelProfile: {
                        derivedFrom: 'nam',
                        sourceArchitecture: 'WaveNet',
                        sourceSampleRate: 48_000,
                        sourceWeightCount: 12,
                        preferredTier: 'standard',
                        inputDrive: 1.18,
                        asymmetry: 0.04,
                        outputTrim: 0.9,
                        contourMix: 0.22,
                        recurrentBias: 0.02,
                        convWeights: [
                            [0.1, 0.7, 0.2],
                            [0.09, 0.68, 0.23],
                            [0.12, 0.66, 0.2],
                            [0.11, 0.67, 0.19],
                            [0.08, 0.72, 0.16],
                            [0.07, 0.74, 0.15],
                            [0.13, 0.64, 0.19],
                            [0.1, 0.69, 0.18],
                            [0.09, 0.7, 0.17],
                            [0.11, 0.68, 0.17],
                        ],
                        model: null,
                        modelDigest: null,
                    },
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.getByText('Selected in this patch')).toBeInTheDocument();
    });

    it('should expose the current front-end pedal chain order in the drive section', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'drive',
                    prePedals: [
                        {
                            id: 'dist1',
                            type: 'distortion',
                            enabled: true,
                            params: { drive: 4.2, tone: 4.4, level: 6.0 },
                        },
                        {
                            id: 'od1',
                            type: 'overdrive',
                            enabled: true,
                            params: { drive: 2.8, tone: 5.2, level: 5.4 },
                        },
                    ],
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.getByText('Chain order')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /1 Distortion/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /2 Overdrive/i })).toBeInTheDocument();
    });

    it('should expose a direct room control in the cab section', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'cab',
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.getByText('Room')).toBeInTheDocument();
    });

    it('should expose cabinet voice, cabinet mode, and routing preset controls in the cab section', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'cab',
                    cabType: 'parametric',
                    cabIrId: '2x12-open',
                    routingMode: 'parallel',
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.getByText('Cab voice')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '2x12 Open' })).toBeInTheDocument();
        expect(screen.getByText('Cab mode')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Parametric' })).toBeInTheDocument();
        expect(screen.getByText('Routing preset')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Parallel' })).toBeInTheDocument();
    });

    it('should render mic 2 position controls only when mic 2 is enabled', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'cab',
                    mic2: { ...DEFAULT_PATCH.mic2, enabled: true },
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        const enabled_view = render(<GrinderPanel deviceId={device_id} />);
        expect(within(enabled_view.container).getByText('Mic 2')).toBeInTheDocument();
        for (const mic of ['Mic 1', 'Mic 2']) {
            for (const parameter of ['horizontal position', 'vertical position', 'distance']) {
                expect(
                    within(enabled_view.container).getByRole('slider', { name: `${mic} ${parameter}` })
                ).toBeInTheDocument();
            }
        }
        enabled_view.unmount();

        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'cab',
                    mic2: { ...DEFAULT_PATCH.mic2, enabled: false },
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        const disabled_view = render(<GrinderPanel deviceId={device_id} />);
        expect(within(disabled_view.container).queryByText('Mic 2')).not.toBeInTheDocument();
    });

    describe('cabinet edits', () => {
        const otherDeviceId = 'other-grinder';
        const otherPatch = { ...DEFAULT_PATCH, mic1: { ...DEFAULT_PATCH.mic1, positionX: 0.91 } };
        const outputs = spy<typeof grinderParamBridgeDependencies>();

        beforeEach(() => {
            outputs.updateDeviceParam.mockClear();
            injectDependencies(loadGrinderPatchWithAudio, {
                ...grinderParamBridgeDependencies,
                updateDeviceParam: outputs.updateDeviceParam,
                updateDevicePatch: outputs.updateDevicePatch,
                persistDeviceParam: outputs.persistDeviceParam,
            });
            setProjectTracks([
                grinderTrack({
                    mic1PositionX: 0.24,
                    mic1PositionY: 0.38,
                    mic1Distance: 0.46,
                    mic2Enabled: 1,
                    mic2PositionX: 0.62,
                    mic2PositionY: 0.73,
                    mic2Distance: 0.87,
                }),
                grinderTrack({ mic1PositionX: 0.91 }, 'track-2', otherDeviceId),
            ]);
            grinderStore.set({
                [device_id]: { patch: { ...DEFAULT_PATCH, uiSection: 'cab' }, basePatch: DEFAULT_PATCH },
                [otherDeviceId]: { patch: otherPatch, basePatch: DEFAULT_PATCH },
            });
        });

        afterEach(() => {
            Container.clear();
        });

        it('applies cabinet voice, mode and routing choices to the selected Grinder', () => {
            render(<GrinderPanel deviceId={device_id} />);
            const panel = within(screen.getByRole('region', { name: 'Grinder controls' }));

            const choices = [
                ['4x12 Tight', '1x12 Combo', 'cabIrSlot', 2],
                ['Both', 'Parametric', 'cabType', 1],
                ['Serial', 'Dual Amp', 'routingMode', 3],
            ] as const;

            for (const [previous, next, parameter, value] of choices) {
                const oldChoice = panel.getByRole('button', { name: previous, pressed: true });
                const newChoice = panel.getByRole('button', { name: next, pressed: false });
                outputs.updateDeviceParam.mockClear();
                fireEvent.click(newChoice);

                expect(newChoice).toHaveAttribute('aria-pressed', 'true');
                expect(oldChoice).toHaveAttribute('aria-pressed', 'false');
                expect(outputs.updateDeviceParam.mock.calls.filter(([, , key]) => key === parameter)).toEqual([
                    ['track-1', device_id, parameter, value],
                ]);
            }

            expect(getGrinderState(device_id).patch).toMatchObject({
                cabIrId: '1x12-combo',
                cabType: 'parametric',
                routingMode: 'dual-amp',
            });
            expect(getGrinderState(otherDeviceId).patch).toEqual(otherPatch);
        });

        it('routes each microphone knob to its own position or distance parameter', async () => {
            render(<GrinderPanel deviceId={device_id} />);
            const panel = within(screen.getByRole('region', { name: 'Grinder controls' }));
            const controls = [
                ['Mic 1 horizontal position', 'ArrowRight', 'mic1PositionX', 0.25],
                ['Mic 1 vertical position', 'ArrowLeft', 'mic1PositionY', 0.37],
                ['Mic 1 distance', 'ArrowRight', 'mic1Distance', 0.47],
                ['Mic 2 horizontal position', 'ArrowLeft', 'mic2PositionX', 0.61],
                ['Mic 2 vertical position', 'ArrowRight', 'mic2PositionY', 0.74],
                ['Mic 2 distance', 'ArrowLeft', 'mic2Distance', 0.86],
            ] as const;

            for (const [name, key, , value] of controls) {
                const knob = panel.getByRole('slider', { name });
                fireEvent.keyDown(knob, { key });
                expect(knob).toHaveAttribute('aria-valuenow', String(value));
            }

            await waitFor(() =>
                expect(outputs.updateDeviceParam.mock.calls).toEqual(
                    controls.map(([, , parameter, value]) => ['track-1', device_id, parameter, value])
                )
            );
            expect(getGrinderState(otherDeviceId).patch).toEqual(otherPatch);
        });
    });

    it('should display the shared compressor threshold default in the drive section', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'drive',
                    prePedals: [],
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        // The drive deck falls back to the shared default threshold (-24 dB), matching
        // what the audio sync sends to the worklet.
        expect(screen.getByText('-24.0 dB')).toBeInTheDocument();
    });

    it('should show snapshot recall controls when the patch contains stored snapshots', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    snapshots: [
                        { id: 'clean', name: 'Clean', paramOverrides: { gain: 3 }, bypassStates: { od1: false } },
                        { id: 'drive', name: 'Drive', paramOverrides: { gain: 7 }, bypassStates: { od1: true } },
                    ],
                    activeSnapshot: 1,
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.getByText('Snapshots')).toBeInTheDocument();
        const snapshots_section = screen.getByText('Snapshots').parentElement;

        expect(snapshots_section).not.toBeNull();
        expect(within(snapshots_section as HTMLElement).getByRole('button', { name: 'Clean' })).toBeInTheDocument();
        expect(within(snapshots_section as HTMLElement).getByRole('button', { name: 'Drive' })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
    });

    it('should disable the Import NAM trigger while the shared store reports an import in flight', () => {
        grinderNeuralLibraryStore.set({
            hydrated: true,
            loading: true,
            importing: true,
            error: null,
            entries: [],
        });
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'neural',
                    engineMode: 'capture',
                    neuralEnabled: true,
                },
                basePatch: DEFAULT_PATCH,
            },
        });

        const importing_view = render(<GrinderPanel deviceId={device_id} />);
        const importing_button = within(importing_view.container).getByRole('button', { name: 'Importing…' });
        expect(importing_button).toBeDisabled();
        importing_view.unmount();

        grinderNeuralLibraryStore.set({
            hydrated: true,
            loading: false,
            importing: false,
            error: null,
            entries: [],
        });

        const idle_view = render(<GrinderPanel deviceId={device_id} />);
        expect(within(idle_view.container).getByRole('button', { name: 'Import NAM' })).toBeEnabled();
    });

    it('labels the Gain parameter knob with an accessible name', () => {
        // The GrinderKnob helper renders the label as a sibling span; the knob
        // itself must carry the name too (not fall back to the generic
        // "Parameter control"), so each param knob is addressable. The Gain knob
        // lives in the amp section.
        grinderStore.set({
            [device_id]: {
                patch: { ...DEFAULT_PATCH, uiSection: 'amp' },
                basePatch: DEFAULT_PATCH,
            },
        });
        render(<GrinderPanel deviceId={device_id} />);
        expect(screen.getByRole('slider', { name: 'Gain' })).toBeInTheDocument();
    });

    it('reconciles a mounted control when project truth changes or removes its value', async () => {
        grinderStore.set({
            [device_id]: {
                patch: { ...DEFAULT_PATCH, uiSection: 'amp', gain: 8 },
                basePatch: DEFAULT_PATCH,
            },
        });
        setProjectTracks([grinderTrack({ gain: 8 })]);

        render(<GrinderPanel deviceId={device_id} />);
        const gain = screen.getByRole('slider', { name: 'Gain' });
        expect(gain).toHaveAttribute('aria-valuenow', '8');

        act(() => {
            setProjectTracks([grinderTrack({ gain: 9 }, 'duplicate-a'), grinderTrack({ gain: 1 }, 'duplicate-b')]);
        });
        expect(gain).toHaveAttribute('aria-valuenow', '8');

        const nestedProjectValues = { cabIrSlot: 1, neuralModelSlot: 2, mic1PositionX: 0.8, preCompressorEnabled: 1 };
        act(() => {
            setProjectTracks([grinderTrack({ gain: 99, channel: 1.5, ...nestedProjectValues })]);
        });
        await waitFor(() => expect(gain).toHaveAttribute('aria-valuenow', '10'));
        expect(grinderStore.value?.[device_id]?.patch).toMatchObject({
            channel: 1,
            cabIrId: '2x12-open',
            neuralModelId: 'vintage-stack-c',
            mic1: { positionX: 0.8 },
            prePedals: [{ type: 'compressor', enabled: true }],
        });

        act(() => setProjectTracks([grinderTrack({})]));
        await waitFor(() => expect(gain).toHaveAttribute('aria-valuenow', String(DEFAULT_PATCH.gain)));
    });

    it('filters presets without hiding the amp lineup or changing the active section', () => {
        render(<GrinderPanel deviceId={device_id} />);
        const browser = within(screen.getByRole('complementary'));
        expect(browser.getByRole('button', { name: /Sparkle Clean/ })).toBeInTheDocument();

        fireEvent.change(browser.getByRole('searchbox', { name: 'Search Grinder presets' }), {
            target: { value: 'rectifier heavy' },
        });

        expect(browser.getByRole('button', { name: /Rectifier Heavy/ })).toBeInTheDocument();
        expect(browser.queryByRole('button', { name: /Sparkle Clean/ })).not.toBeInTheDocument();
        expect(browser.getByRole('button', { name: /Custom/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Lab' })).toHaveAttribute('aria-pressed', 'true');
    });
});
