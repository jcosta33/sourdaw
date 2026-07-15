import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { proofStore, getProofState, type ProofState } from '../../../stores/proofStore';
import { bridges, type ProofAudioBridge } from '../../../useCases/proofParamBridge/helpers';
import { loadProofPatchWithAudio } from '../../../useCases/proofParamBridge/loadProofPatchWithAudio';
import { PROOF_PRESETS } from '../../../useCases/proofPresets';
import { ProofPanel } from '../ProofPanel';

// getAudioSampleRate reads the live AudioContext, which jsdom does not provide.
// Mock it so the latency readout assertion can pin a known, non-44100 rate.
const sampleRateMock = vi.fn<[], number>(() => 48_000);
const { persistDevicePatchMock, persistedProjectPatches } = vi.hoisted(() => {
    const persistedProjectPatches = new Map<string, Record<string, unknown>>();
    return {
        persistedProjectPatches,
        persistDevicePatchMock: vi.fn((deviceId: string, patch: Record<string, unknown>): void => {
            persistedProjectPatches.set(deviceId, {
                ...persistedProjectPatches.get(deviceId),
                ...patch,
            });
        }),
    };
});
vi.mock('#/modules/AudioEngine/useCases', () => ({
    getAudioSampleRate: () => sampleRateMock(),
    getMasterAnalyser: () => null,
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    persistDevicePatch: persistDevicePatchMock,
}));

// persistDeviceParam writes into the Arrangement track store; isolate this view
// test from that cross-module write.
vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    persistDeviceParam: vi.fn(),
}));

const DEVICE_ID = 'proof-test-device';
const OTHER_DEVICE_ID = 'proof-test-device-b';

type RotaryEndGesture = (knob: HTMLElement, unmount: () => void) => void;

const EQ_ROTARY_ENDINGS: Array<readonly [string, RotaryEndGesture]> = [
    ['pointerup', (knob: HTMLElement, _unmount: () => void) => fireEvent.pointerUp(knob, { pointerId: 16 })],
    ['pointercancel', (knob: HTMLElement, _unmount: () => void) => fireEvent.pointerCancel(knob, { pointerId: 16 })],
    [
        'lost pointer capture',
        (knob: HTMLElement, _unmount: () => void) => fireEvent.lostPointerCapture(knob, { pointerId: 16 }),
    ],
    ['unmount', (_knob: HTMLElement, unmount: () => void) => unmount()],
];

const EQ_ROTARY_REPLACEMENT_CASES = EQ_ROTARY_ENDINGS.flatMap(([end, endGesture]) => [
    ['frequency', end, 0, endGesture] as const,
    ['gain', end, 1, endGesture] as const,
    ['Q', end, 2, endGesture] as const,
]);

type GestureEnding = (element: HTMLElement, pointerId: number, unmount: () => void) => void;

const CURVE_KNOB_ENDINGS: Array<readonly [string, GestureEnding]> = [
    ['pointerup', (element, pointerId) => fireEvent.pointerUp(element, { pointerId })],
    ['pointercancel', (element, pointerId) => fireEvent.pointerCancel(element, { pointerId })],
    ['lost pointer capture', (element, pointerId) => fireEvent.lostPointerCapture(element, { pointerId })],
    ['unmount', (_element, _pointerId, unmount) => unmount()],
];

const CURVE_KNOB_OVERLAP_CASES = CURVE_KNOB_ENDINGS.flatMap(([end, endGesture]) =>
    (['frequency', 'gain'] as const).flatMap((field) =>
        (['curve', 'knob'] as const).map((winner) => [field, winner, end, endGesture] as const)
    )
);

type ProofRotaryShape = readonly [
    label: string,
    uiLevel: ProofState['uiLevel'],
    knobIndex: number,
    replacement: (patch: ProofState['patch']) => ProofState['patch'],
];

const replaceProofPatch = (label: string, patch: ProofState['patch']): ProofState['patch'] => ({
    ...patch,
    name: `replacement-${label}`,
    presetId: `replacement-${label}`,
});

const PROOF_ROTARY_SHAPES: readonly ProofRotaryShape[] = [
    ['scalar', 3, 56, (patch) => replaceProofPatch('scalar', patch)],
    ['indexed band', 3, 25, (patch) => replaceProofPatch('indexed-band', patch)],
    ['top-level panel', 1, 1, (patch) => replaceProofPatch('top-level-panel', patch)],
    ['route', 4, 1, (patch) => replaceProofPatch('route', patch)],
];

const PROOF_ROTARY_REPLACEMENT_CASES = EQ_ROTARY_ENDINGS.flatMap(([end, endGesture]) =>
    PROOF_ROTARY_SHAPES.map(
        ([shape, uiLevel, knobIndex, replacement]) => [shape, end, uiLevel, knobIndex, replacement, endGesture] as const
    )
);

function makeBridge(): ProofAudioBridge & {
    setParam: ReturnType<typeof vi.fn>;
    reorderModules: ReturnType<typeof vi.fn>;
    resetIntegrated: ReturnType<typeof vi.fn>;
} {
    return {
        setParam: vi.fn(),
        reorderModules: vi.fn(),
        resetIntegrated: vi.fn(),
    };
}

function seedState(overrides: Partial<ProofState> = {}): void {
    proofStore.set({
        [DEVICE_ID]: { ...getProofState(DEVICE_ID), ...overrides },
    });
}

beforeEach(() => {
    sampleRateMock.mockReturnValue(48_000);
    persistedProjectPatches.clear();
    bridges.clear();
    proofStore.set({});
});

afterEach(() => {
    bridges.clear();
    proofStore.set({});
    vi.clearAllMocks();
});

describe('ProofPanel', () => {
    it('renders the panel for the given device without crashing', () => {
        render(<ProofPanel deviceId={DEVICE_ID} />);
        expect(screen.getByText('Mission')).toBeInTheDocument();

        const compareToggle = screen.getByRole('button', { name: 'A/B compare' });
        expect(compareToggle).toHaveAttribute('aria-pressed', String(getProofState(DEVICE_ID).abBypass));
    });

    it.each([
        {
            uiLevel: 1,
            expectedNames: ['Mission limiter ceiling', 'Master limiter ceiling'],
        },
        {
            uiLevel: 2,
            expectedNames: [
                'Dynamics Threshold',
                'Imager Width',
                'Exciter Drive',
                'Limiter Ceiling',
                'Master limiter ceiling',
            ],
        },
        {
            uiLevel: 3,
            expectedNames: [
                'EQ Low Cut frequency',
                'Dynamics Sub threshold',
                'Imager Sub width',
                'Exciter Sub drive',
                'Limiter ceiling',
                'Master limiter ceiling',
            ],
        },
        {
            uiLevel: 4,
            expectedNames: ['Input gain', 'Output gain', 'Master limiter ceiling'],
        },
    ])('gives level $uiLevel controls stable, distinct accessible names', ({ uiLevel, expectedNames }) => {
        seedState({ uiLevel });
        render(<ProofPanel deviceId={DEVICE_ID} />);

        const names = screen.getAllByRole('slider').map((control) => control.getAttribute('aria-label'));

        expect(names).toEqual(expect.arrayContaining(expectedNames));
        expect(names.every((name) => name !== null && name !== 'Parameter control')).toBe(true);
        expect(new Set(names).size).toBe(names.length);

        if (uiLevel === 2) {
            const moduleButtons = [
                ['EQ module', 'eqBypassed'],
                ['Dynamics module', 'dynBypassed'],
                ['Imager module', 'imgBypassed'],
                ['Exciter module', 'excBypassed'],
                ['Limiter module', 'limBypassed'],
            ] as const;
            const patch = getProofState(DEVICE_ID).patch;
            for (const [name, key] of moduleButtons) {
                expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', String(!patch[key]));
            }
        }
    });

    it('persists a target selection atomically and updates the store', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        seedState();

        render(<ProofPanel deviceId={DEVICE_ID} />);

        // Level-1 target buttons read e.g. "Broadcast (-23 LUFS)".
        fireEvent.click(screen.getByText('Broadcast (-23 LUFS)'));

        expect(getProofState(DEVICE_ID).patch.target).toBe('broadcast');
        expect(getProofState(DEVICE_ID).patch.targetLufs).toBe(-23);
        expect(persistDevicePatchMock).toHaveBeenCalledTimes(1);
        expect(persistDevicePatchMock).toHaveBeenCalledWith(DEVICE_ID, {
            target_mode: 3,
            target_lufs: -23,
        });
        expect(bridge.setParam).not.toHaveBeenCalled();
    });

    it('keeps preset identity and persistence quiet when selecting the active target', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        const preset = PROOF_PRESETS.find((candidate) => candidate.id === 'streaming')!;
        seedState({ patch: preset.patch });

        render(<ProofPanel deviceId={DEVICE_ID} />);
        fireEvent.click(screen.getByText('Streaming (-14 LUFS)'));

        expect(getProofState(DEVICE_ID).patch.presetId).toBe('streaming');
        expect(persistDevicePatchMock).not.toHaveBeenCalled();
        expect(bridge.setParam).not.toHaveBeenCalled();
    });

    it('finalizes a rotary preview before persisting an interrupted target selection', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        seedState({ uiLevel: 3 });

        render(<ProofPanel deviceId={DEVICE_ID} />);

        const knob = screen.getByRole('slider', { name: 'EQ Low Cut frequency' });
        const initialFrequency = getProofState(DEVICE_ID).patch.eqBands[0]?.freq;

        fireEvent.pointerDown(knob, { button: 0, pointerId: 61, clientY: 100 });
        fireEvent.pointerMove(knob, { pointerId: 61, clientY: 70 });

        const previewFrequency = getProofState(DEVICE_ID).patch.eqBands[0]?.freq;
        expect(previewFrequency).not.toBe(initialFrequency);
        expect(persistDevicePatchMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Broadcast' }));

        expect(persistDevicePatchMock).toHaveBeenCalledTimes(2);
        expect(persistDevicePatchMock).toHaveBeenNthCalledWith(
            1,
            DEVICE_ID,
            expect.objectContaining({ eq_band0_freq: previewFrequency })
        );
        expect(persistDevicePatchMock).toHaveBeenNthCalledWith(2, DEVICE_ID, {
            target_mode: 3,
            target_lufs: -23,
        });
        const [paramPersistOrder, targetPersistOrder] = persistDevicePatchMock.mock.invocationCallOrder;
        expect(paramPersistOrder).toBeLessThan(targetPersistOrder);

        fireEvent.pointerUp(knob, { pointerId: 61 });

        expect(persistDevicePatchMock).toHaveBeenCalledTimes(2);
        expect(getProofState(DEVICE_ID).patch.eqBands[0]?.freq).toBe(previewFrequency);
        expect(getProofState(DEVICE_ID).patch.target).toBe('broadcast');
    });

    it('finalizes an EQ curve preview before persisting an interrupted target selection', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        seedState({ uiLevel: 3 });

        const { container } = render(<ProofPanel deviceId={DEVICE_ID} />);
        const canvas = container.querySelector<HTMLCanvasElement>(
            'canvas[aria-label="8-band parametric EQ frequency response"]'
        );
        if (!canvas) {
            throw new Error('Expected the Level 3 EQ curve canvas');
        }
        const initialBand = getProofState(DEVICE_ID).patch.eqBands[2];
        if (!initialBand) {
            throw new Error('Expected EQ band 2');
        }
        const point = {
            x: (Math.log10(initialBand.freq / 20) / Math.log10(20000 / 20)) * 500,
            y: 60 - (initialBand.gain / 18) * 60,
        };

        fireEvent.pointerDown(canvas, {
            button: 0,
            clientX: point.x,
            clientY: point.y,
            pointerId: 62,
        });
        fireEvent.pointerMove(canvas, {
            clientX: point.x + 15,
            clientY: point.y - 20,
            pointerId: 62,
        });

        const previewBand = getProofState(DEVICE_ID).patch.eqBands[2];
        expect(previewBand?.freq).not.toBe(initialBand.freq);
        expect(previewBand?.gain).not.toBe(initialBand.gain);
        expect(persistDevicePatchMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Broadcast' }));

        expect(persistDevicePatchMock).toHaveBeenCalledTimes(2);
        expect(persistDevicePatchMock).toHaveBeenNthCalledWith(
            1,
            DEVICE_ID,
            expect.objectContaining({
                eq_band2_freq: previewBand?.freq,
                eq_band2_gain: previewBand?.gain,
            })
        );
        expect(persistDevicePatchMock).toHaveBeenNthCalledWith(2, DEVICE_ID, {
            target_mode: 3,
            target_lufs: -23,
        });
        const [paramPersistOrder, targetPersistOrder] = persistDevicePatchMock.mock.invocationCallOrder;
        expect(paramPersistOrder).toBeLessThan(targetPersistOrder);

        fireEvent.pointerUp(canvas, { pointerId: 62 });

        expect(persistDevicePatchMock).toHaveBeenCalledTimes(2);
        expect(getProofState(DEVICE_ID).patch.eqBands[2]?.freq).toBe(previewBand?.freq);
        expect(getProofState(DEVICE_ID).patch.eqBands[2]?.gain).toBe(previewBand?.gain);
        expect(getProofState(DEVICE_ID).patch.target).toBe('broadcast');
    });

    it('cancels stale rotary authority when the panel switches devices with an identical patch snapshot', () => {
        const bridgeA = makeBridge();
        const bridgeB = makeBridge();
        bridges.set(DEVICE_ID, bridgeA);
        bridges.set(OTHER_DEVICE_ID, bridgeB);
        seedState({ uiLevel: 4 });

        const { rerender } = render(<ProofPanel deviceId={DEVICE_ID} />);
        const staleKnob = screen.getByRole('slider', { name: 'Input gain' });
        const initialGain = getProofState(DEVICE_ID).patch.inputGain;

        fireEvent.pointerDown(staleKnob, { button: 0, pointerId: 66, clientY: 100 });
        fireEvent.pointerMove(staleKnob, { pointerId: 66, clientY: 70 });

        const previewPatch = getProofState(DEVICE_ID).patch;
        expect(previewPatch.inputGain).not.toBe(initialGain);
        expect(bridgeA.setParam).toHaveBeenCalledTimes(1);
        expect(persistDevicePatchMock).not.toHaveBeenCalled();

        act(() => {
            proofStore.set({
                ...(proofStore.value ?? {}),
                [OTHER_DEVICE_ID]: {
                    ...getProofState(OTHER_DEVICE_ID),
                    uiLevel: 4,
                    patch: { ...previewPatch },
                },
            });
        });
        expect(getProofState(OTHER_DEVICE_ID).patch).toEqual(previewPatch);
        expect(getProofState(OTHER_DEVICE_ID).patch).not.toBe(previewPatch);
        rerender(<ProofPanel deviceId={OTHER_DEVICE_ID} />);

        fireEvent.pointerUp(staleKnob, { pointerId: 66 });

        expect(persistDevicePatchMock).not.toHaveBeenCalled();
        expect(persistedProjectPatches.has(DEVICE_ID)).toBe(false);
        expect(persistedProjectPatches.has(OTHER_DEVICE_ID)).toBe(false);
        expect(bridgeA.setParam).toHaveBeenCalledTimes(1);
        expect(bridgeB.setParam).not.toHaveBeenCalled();

        const freshKnob = screen.getByRole('slider', { name: 'Input gain' });
        const initialDeviceBGain = getProofState(OTHER_DEVICE_ID).patch.inputGain;
        fireEvent.pointerDown(freshKnob, { button: 0, pointerId: 67, clientY: 100 });
        fireEvent.pointerMove(freshKnob, { pointerId: 67, clientY: 70 });
        const finalDeviceBGain = getProofState(OTHER_DEVICE_ID).patch.inputGain;
        fireEvent.pointerUp(freshKnob, { pointerId: 67 });

        expect(finalDeviceBGain).not.toBe(initialDeviceBGain);
        expect(persistDevicePatchMock).toHaveBeenCalledOnce();
        expect(persistDevicePatchMock).toHaveBeenCalledWith(OTHER_DEVICE_ID, {
            input_gain: finalDeviceBGain,
        });
        expect(bridgeA.setParam).toHaveBeenCalledTimes(1);
        expect(bridgeB.setParam).toHaveBeenCalledOnce();
        expect(bridgeB.setParam).toHaveBeenCalledWith('input_gain', finalDeviceBGain);
        expect(persistedProjectPatches.get(OTHER_DEVICE_ID)).toEqual({
            input_gain: finalDeviceBGain,
        });
    });

    it('finalizes a Level 2 rotary preview before a module bypass commit', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        seedState({ uiLevel: 2 });

        render(<ProofPanel deviceId={DEVICE_ID} />);

        const knob = screen.getByRole('slider', { name: 'Limiter Ceiling' });
        const initialCeiling = getProofState(DEVICE_ID).patch.limCeiling;

        fireEvent.pointerDown(knob, { button: 0, pointerId: 63, clientY: 100 });
        fireEvent.pointerMove(knob, { pointerId: 63, clientY: 70 });

        const previewCeiling = getProofState(DEVICE_ID).patch.limCeiling;
        expect(previewCeiling).not.toBe(initialCeiling);
        expect(persistDevicePatchMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'EQ module' }));

        expect(persistDevicePatchMock).toHaveBeenCalledTimes(2);
        expect(persistDevicePatchMock).toHaveBeenNthCalledWith(1, DEVICE_ID, {
            lim_ceiling: previewCeiling,
        });
        expect(persistDevicePatchMock).toHaveBeenNthCalledWith(2, DEVICE_ID, {
            eq_bypass: 1,
        });
        expect(bridge.setParam).toHaveBeenCalledTimes(2);
        expect(bridge.setParam).toHaveBeenNthCalledWith(1, 'lim_ceiling', previewCeiling);
        expect(bridge.setParam).toHaveBeenNthCalledWith(2, 'eq_bypass', 1);
        expect(getProofState(DEVICE_ID).patch.limCeiling).toBe(previewCeiling);
        expect(getProofState(DEVICE_ID).patch.eqBypassed).toBe(true);

        fireEvent.pointerUp(knob, { pointerId: 63 });

        expect(persistDevicePatchMock).toHaveBeenCalledTimes(2);
        expect(bridge.setParam).toHaveBeenCalledTimes(2);
        expect(getProofState(DEVICE_ID).patch.limCeiling).toBe(previewCeiling);
        expect(getProofState(DEVICE_ID).patch.eqBypassed).toBe(true);
        expect(persistedProjectPatches.get(DEVICE_ID)).toMatchObject({
            lim_ceiling: previewCeiling,
            eq_bypass: 1,
        });
    });

    it('finalizes an EQ curve preview before a same-view granular commit', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        seedState({ uiLevel: 3 });

        const { container } = render(<ProofPanel deviceId={DEVICE_ID} />);
        const canvas = container.querySelector<HTMLCanvasElement>(
            'canvas[aria-label="8-band parametric EQ frequency response"]'
        );
        if (!canvas) {
            throw new Error('Expected the Level 3 EQ curve canvas');
        }
        const initialBand = getProofState(DEVICE_ID).patch.eqBands[2];
        if (!initialBand) {
            throw new Error('Expected EQ band 2');
        }
        const point = {
            x: (Math.log10(initialBand.freq / 20) / Math.log10(20000 / 20)) * 500,
            y: 60 - (initialBand.gain / 18) * 60,
        };

        fireEvent.pointerDown(canvas, {
            button: 0,
            clientX: point.x,
            clientY: point.y,
            pointerId: 64,
        });
        fireEvent.pointerMove(canvas, {
            clientX: point.x + 15,
            clientY: point.y - 20,
            pointerId: 64,
        });

        const previewBand = getProofState(DEVICE_ID).patch.eqBands[2];
        expect(previewBand?.freq).not.toBe(initialBand.freq);
        expect(previewBand?.gain).not.toBe(initialBand.gain);
        expect(persistDevicePatchMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'EQ module' }));

        expect(persistDevicePatchMock).toHaveBeenCalledTimes(2);
        expect(persistDevicePatchMock).toHaveBeenNthCalledWith(
            1,
            DEVICE_ID,
            expect.objectContaining({
                eq_band2_freq: previewBand?.freq,
                eq_band2_gain: previewBand?.gain,
            })
        );
        expect(persistDevicePatchMock).toHaveBeenNthCalledWith(2, DEVICE_ID, {
            eq_bypass: 1,
        });
        expect(bridge.setParam).toHaveBeenCalledTimes(3);
        expect(bridge.setParam).toHaveBeenNthCalledWith(1, 'eq_band2_freq', previewBand?.freq);
        expect(bridge.setParam).toHaveBeenNthCalledWith(2, 'eq_band2_gain', previewBand?.gain);
        expect(bridge.setParam).toHaveBeenNthCalledWith(3, 'eq_bypass', 1);
        expect(getProofState(DEVICE_ID).patch.eqBands[2]).toMatchObject({
            freq: previewBand?.freq,
            gain: previewBand?.gain,
        });
        expect(getProofState(DEVICE_ID).patch.eqBypassed).toBe(true);
        expect(persistedProjectPatches.get(DEVICE_ID)).toMatchObject({
            eq_band2_freq: previewBand?.freq,
            eq_band2_gain: previewBand?.gain,
            eq_bypass: 1,
        });

        fireEvent.pointerUp(canvas, { pointerId: 64 });

        expect(persistDevicePatchMock).toHaveBeenCalledTimes(2);
        expect(bridge.setParam).toHaveBeenCalledTimes(3);
        expect(getProofState(DEVICE_ID).patch.eqBands[2]).toMatchObject({
            freq: previewBand?.freq,
            gain: previewBand?.gain,
        });
        expect(getProofState(DEVICE_ID).patch.eqBypassed).toBe(true);
    });

    it('finalizes a Level 4 rotary preview before a chain reorder commit', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        seedState({ uiLevel: 4 });

        render(<ProofPanel deviceId={DEVICE_ID} />);

        const knob = screen.getByRole('slider', { name: 'Input gain' });
        const initialGain = getProofState(DEVICE_ID).patch.inputGain;

        fireEvent.pointerDown(knob, { button: 0, pointerId: 65, clientY: 100 });
        fireEvent.pointerMove(knob, { pointerId: 65, clientY: 70 });

        const previewGain = getProofState(DEVICE_ID).patch.inputGain;
        expect(previewGain).not.toBe(initialGain);
        expect(persistDevicePatchMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Move EQ later in the chain' }));

        const expectedOrder: [number, number, number, number, number] = [1, 0, 2, 3, 4];
        expect(persistDevicePatchMock).toHaveBeenCalledTimes(2);
        expect(persistDevicePatchMock).toHaveBeenNthCalledWith(1, DEVICE_ID, {
            input_gain: previewGain,
        });
        expect(persistDevicePatchMock).toHaveBeenNthCalledWith(2, DEVICE_ID, {
            chain_order_0: 1,
            chain_order_1: 0,
            chain_order_2: 2,
            chain_order_3: 3,
            chain_order_4: 4,
        });
        expect(bridge.setParam).toHaveBeenCalledTimes(1);
        expect(bridge.setParam).toHaveBeenCalledWith('input_gain', previewGain);
        expect(bridge.reorderModules).toHaveBeenCalledTimes(1);
        expect(bridge.reorderModules).toHaveBeenCalledWith(expectedOrder);
        expect(getProofState(DEVICE_ID).patch.inputGain).toBe(previewGain);
        expect(getProofState(DEVICE_ID).patch.chainOrder).toEqual(expectedOrder);

        fireEvent.pointerUp(knob, { pointerId: 65 });

        expect(persistDevicePatchMock).toHaveBeenCalledTimes(2);
        expect(bridge.setParam).toHaveBeenCalledTimes(1);
        expect(bridge.reorderModules).toHaveBeenCalledTimes(1);
        expect(getProofState(DEVICE_ID).patch.inputGain).toBe(previewGain);
        expect(getProofState(DEVICE_ID).patch.chainOrder).toEqual(expectedOrder);
        expect(persistedProjectPatches.get(DEVICE_ID)).toMatchObject({
            input_gain: previewGain,
            chain_order_0: 1,
            chain_order_1: 0,
            chain_order_2: 2,
            chain_order_3: 3,
            chain_order_4: 4,
        });
    });

    it('sends only fields that changed during repeated Level 2 Exciter moves', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        seedState({ uiLevel: 2 });

        const { container } = render(<ProofPanel deviceId={DEVICE_ID} />);
        const knobs = container.querySelectorAll<HTMLElement>('.cursor-ns-resize');
        expect(knobs).toHaveLength(5);
        const exciterKnob = knobs[2]!;

        fireEvent.pointerDown(exciterKnob, { button: 0, pointerId: 7, clientY: 100 });
        fireEvent.pointerMove(exciterKnob, { pointerId: 7, clientY: 90 });
        bridge.setParam.mockClear();
        fireEvent.pointerMove(exciterKnob, { pointerId: 7, clientY: 60 });

        expect(bridge.setParam).toHaveBeenCalledTimes(4);
        expect(bridge.setParam).toHaveBeenNthCalledWith(1, 'exc_band0_drive', expect.any(Number));
        expect(bridge.setParam).toHaveBeenNthCalledWith(2, 'exc_band1_drive', expect.any(Number));
        expect(bridge.setParam).toHaveBeenNthCalledWith(3, 'exc_band2_drive', expect.any(Number));
        expect(bridge.setParam).toHaveBeenNthCalledWith(4, 'exc_band3_drive', expect.any(Number));
        expect(persistDevicePatchMock).not.toHaveBeenCalled();

        fireEvent.pointerUp(exciterKnob, { pointerId: 7 });
        expect(persistDevicePatchMock).toHaveBeenCalledTimes(1);
    });

    it('persists an accepted transient edit when the panel unmounts during a drag', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        seedState({ uiLevel: 2 });

        const { container, unmount } = render(<ProofPanel deviceId={DEVICE_ID} />);
        const knobs = container.querySelectorAll<HTMLElement>('.cursor-ns-resize');
        expect(knobs).toHaveLength(5);
        const exciterKnob = knobs[2]!;

        fireEvent.pointerDown(exciterKnob, { button: 0, pointerId: 8, clientY: 100 });
        fireEvent.pointerMove(exciterKnob, { pointerId: 8, clientY: 80 });
        const transientValue = getProofState(DEVICE_ID).patch.excBands[0]?.drive;

        unmount();

        expect(persistDevicePatchMock).toHaveBeenCalledTimes(1);
        expect(persistDevicePatchMock).toHaveBeenCalledWith(
            DEVICE_ID,
            expect.objectContaining({ exc_band0_drive: transientValue })
        );
    });

    it('persists an accepted EQ drag when the active level tears down', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        seedState({ uiLevel: 3 });

        const { container, unmount } = render(<ProofPanel deviceId={DEVICE_ID} />);
        const canvas = container.querySelector<HTMLCanvasElement>(
            'canvas[aria-label="8-band parametric EQ frequency response"]'
        );
        if (!canvas) {
            throw new Error('Expected the Level 3 EQ curve canvas');
        }
        const peakX = (Math.log10(250 / 20) / Math.log10(20000 / 20)) * 500;

        fireEvent.pointerDown(canvas, { clientX: peakX, clientY: 60, pointerId: 14 });
        fireEvent.pointerMove(canvas, { clientX: peakX + 10, clientY: 30, pointerId: 14 });
        const transientBand = getProofState(DEVICE_ID).patch.eqBands[2];

        expect(persistDevicePatchMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /Shape/ }));

        expect(persistDevicePatchMock).toHaveBeenCalledTimes(1);
        expect(persistDevicePatchMock).toHaveBeenCalledWith(
            DEVICE_ID,
            expect.objectContaining({
                eq_band2_freq: transientBand?.freq,
                eq_band2_gain: transientBand?.gain,
            })
        );

        unmount();
        expect(persistDevicePatchMock).toHaveBeenCalledTimes(1);
    });

    it('does not finalize an EQ drag after a preset replacement', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        seedState({ uiLevel: 3 });

        const { container } = render(<ProofPanel deviceId={DEVICE_ID} />);
        const canvas = container.querySelector<HTMLCanvasElement>(
            'canvas[aria-label="8-band parametric EQ frequency response"]'
        );
        if (!canvas) {
            throw new Error('Expected the Level 3 EQ curve canvas');
        }
        const peakX = (Math.log10(250 / 20) / Math.log10(20000 / 20)) * 500;

        fireEvent.pointerDown(canvas, { clientX: peakX, clientY: 60, pointerId: 15 });
        fireEvent.pointerMove(canvas, { clientX: peakX + 10, clientY: 30, pointerId: 15 });
        fireEvent.click(screen.getByRole('button', { name: /Streaming Master/ }));

        expect(getProofState(DEVICE_ID).patch.presetId).toBe('streaming');
        expect(persistDevicePatchMock).toHaveBeenCalledTimes(1);

        fireEvent.pointerUp(canvas, { pointerId: 15 });

        expect(getProofState(DEVICE_ID).patch.presetId).toBe('streaming');
        expect(persistDevicePatchMock).toHaveBeenCalledTimes(1);
    });

    it('lets a newer section gesture supersede an EQ curve without a stale finalization', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        seedState({ uiLevel: 3 });

        const { container, unmount } = render(<ProofPanel deviceId={DEVICE_ID} />);
        const canvas = container.querySelector<HTMLCanvasElement>(
            'canvas[aria-label="8-band parametric EQ frequency response"]'
        );
        if (!canvas) {
            throw new Error('Expected the Level 3 EQ curve canvas');
        }
        const knobs = container.querySelectorAll<HTMLElement>('.cursor-ns-resize');
        const dynamicsCrossover = knobs.item(24);
        if (!dynamicsCrossover) {
            throw new Error('Expected the first Dynamics crossover knob');
        }
        const peakX = (Math.log10(250 / 20) / Math.log10(20000 / 20)) * 500;

        fireEvent.pointerDown(canvas, { clientX: peakX, clientY: 60, pointerId: 21 });
        fireEvent.pointerMove(canvas, { clientX: peakX + 10, clientY: 30, pointerId: 21 });
        const curveBand = getProofState(DEVICE_ID).patch.eqBands[2];

        fireEvent.pointerDown(dynamicsCrossover, { button: 0, pointerId: 22, clientY: 100 });
        fireEvent.pointerMove(dynamicsCrossover, { pointerId: 22, clientY: 80 });
        const crossoverValue = getProofState(DEVICE_ID).patch.dynCrossoverFreqs[0];
        expect(persistDevicePatchMock).toHaveBeenCalledTimes(1);
        expect(persistDevicePatchMock).toHaveBeenCalledWith(
            DEVICE_ID,
            expect.objectContaining({
                eq_band2_freq: curveBand?.freq,
                eq_band2_gain: curveBand?.gain,
            })
        );

        try {
            fireEvent.pointerUp(canvas, { pointerId: 21 });

            expect(persistDevicePatchMock).toHaveBeenCalledTimes(1);

            fireEvent.pointerUp(dynamicsCrossover, { pointerId: 22 });

            expect(persistDevicePatchMock).toHaveBeenCalledTimes(2);
            expect(getProofState(DEVICE_ID).patch.eqBands[2]).toMatchObject({
                freq: curveBand?.freq,
                gain: curveBand?.gain,
            });
            expect(getProofState(DEVICE_ID).patch.dynCrossoverFreqs[0]).toBe(crossoverValue);
            expect(persistDevicePatchMock).toHaveBeenCalledWith(
                DEVICE_ID,
                expect.objectContaining({
                    dyn_xover0: crossoverValue,
                })
            );
        } finally {
            unmount();
        }
    });

    it('keeps a superseded curve preview while the newer other-band knob commits', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        seedState({ uiLevel: 3 });

        const { container, unmount } = render(<ProofPanel deviceId={DEVICE_ID} />);
        const canvas = container.querySelector<HTMLCanvasElement>(
            'canvas[aria-label="8-band parametric EQ frequency response"]'
        );
        if (!canvas) {
            throw new Error('Expected the Level 3 EQ curve canvas');
        }
        const knobs = container.querySelectorAll<HTMLElement>('.cursor-ns-resize');
        const otherEqGain = knobs.item(10);
        if (!otherEqGain) {
            throw new Error('Expected the next EQ band gain knob');
        }
        const peakX = (Math.log10(250 / 20) / Math.log10(20000 / 20)) * 500;

        fireEvent.pointerDown(canvas, { clientX: peakX, clientY: 60, pointerId: 23 });
        fireEvent.pointerMove(canvas, { clientX: peakX + 10, clientY: 30, pointerId: 23 });
        const curveBand = getProofState(DEVICE_ID).patch.eqBands[2];

        fireEvent.pointerDown(otherEqGain, { button: 0, pointerId: 24, clientY: 100 });
        fireEvent.pointerMove(otherEqGain, { pointerId: 24, clientY: 80 });
        const otherBand = getProofState(DEVICE_ID).patch.eqBands[3];
        expect(persistDevicePatchMock).toHaveBeenCalledTimes(1);
        expect(persistDevicePatchMock).toHaveBeenCalledWith(
            DEVICE_ID,
            expect.objectContaining({
                eq_band2_freq: curveBand?.freq,
                eq_band2_gain: curveBand?.gain,
            })
        );

        try {
            fireEvent.pointerUp(canvas, { pointerId: 23 });

            expect(persistDevicePatchMock).toHaveBeenCalledTimes(1);

            fireEvent.pointerUp(otherEqGain, { pointerId: 24 });

            expect(persistDevicePatchMock).toHaveBeenCalledTimes(2);
            expect(getProofState(DEVICE_ID).patch.eqBands[2]).toMatchObject({
                freq: curveBand?.freq,
                gain: curveBand?.gain,
            });
            expect(getProofState(DEVICE_ID).patch.eqBands[3]?.gain).toBe(otherBand?.gain);
            expect(persistDevicePatchMock).toHaveBeenCalledWith(
                DEVICE_ID,
                expect.objectContaining({
                    eq_band2_freq: curveBand?.freq,
                    eq_band2_gain: curveBand?.gain,
                    eq_band3_gain: otherBand?.gain,
                })
            );
        } finally {
            unmount();
        }
    });

    it('keeps a newer rotary gesture current after finalizing a factory-preset drag', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        const factoryPreset = PROOF_PRESETS.find((preset) => preset.id === 'streaming');
        if (!factoryPreset) {
            throw new Error('Expected the Streaming Master factory preset');
        }
        seedState({ uiLevel: 3, patch: factoryPreset.patch });

        const { container, unmount } = render(<ProofPanel deviceId={DEVICE_ID} />);
        const knobs = container.querySelectorAll<HTMLElement>('.cursor-ns-resize');
        expect(knobs.length).toBeGreaterThan(10);
        const firstKnob = knobs.item(6);
        const secondKnob = knobs.item(10);

        fireEvent.pointerDown(firstKnob, { button: 0, pointerId: 41, clientY: 100 });
        fireEvent.pointerMove(firstKnob, { pointerId: 41, clientY: 80 });
        const firstTransientPatch = getProofState(DEVICE_ID).patch;
        expect(firstTransientPatch.presetId).toBe('streaming');
        expect(persistDevicePatchMock).not.toHaveBeenCalled();

        const secondStartGain = getProofState(DEVICE_ID).patch.eqBands[3]?.gain;
        fireEvent.pointerDown(secondKnob, { button: 0, pointerId: 42, clientY: 100 });

        expect(persistDevicePatchMock).toHaveBeenCalledTimes(1);
        expect(persistDevicePatchMock).toHaveBeenNthCalledWith(
            1,
            DEVICE_ID,
            expect.objectContaining({ eq_band2_freq: firstTransientPatch.eqBands[2]?.freq })
        );

        fireEvent.pointerMove(secondKnob, { pointerId: 42, clientY: 80 });
        const secondTransientPatch = getProofState(DEVICE_ID).patch;
        expect(secondTransientPatch.eqBands[3]?.gain).not.toBe(secondStartGain);
        expect(persistDevicePatchMock).toHaveBeenCalledTimes(1);

        fireEvent.pointerUp(secondKnob, { pointerId: 42 });

        expect(persistDevicePatchMock).toHaveBeenCalledTimes(2);
        expect(persistDevicePatchMock).toHaveBeenNthCalledWith(
            2,
            DEVICE_ID,
            expect.objectContaining({ eq_band3_gain: secondTransientPatch.eqBands[3]?.gain })
        );
        expect(getProofState(DEVICE_ID).patch.eqBands[3]?.gain).toBe(secondTransientPatch.eqBands[3]?.gain);
        expect(getProofState(DEVICE_ID).patch.presetId).toBeUndefined();

        fireEvent.pointerUp(firstKnob, { pointerId: 41 });

        expect(persistDevicePatchMock).toHaveBeenCalledTimes(2);
        expect(getProofState(DEVICE_ID).patch.eqBands[3]?.gain).toBe(secondTransientPatch.eqBands[3]?.gain);

        unmount();
    });

    it.each(CURVE_KNOB_OVERLAP_CASES)(
        'serializes curve and same-band %s knob gestures when %s wins and the loser ends via %s',
        (field, winner, _end, endGesture) => {
            const bridge = makeBridge();
            bridges.set(DEVICE_ID, bridge);
            seedState({ uiLevel: 3 });

            const { container, unmount } = render(<ProofPanel deviceId={DEVICE_ID} />);
            const canvas = container.querySelector<HTMLCanvasElement>(
                'canvas[aria-label="8-band parametric EQ frequency response"]'
            );
            if (!canvas) {
                throw new Error('Expected the Level 3 EQ curve canvas');
            }
            const knobs = container.querySelectorAll<HTMLElement>('.cursor-ns-resize');
            const knob = knobs.item(field === 'frequency' ? 6 : 7);
            if (!knob) {
                throw new Error(`Expected the EQ band 2 ${field} knob`);
            }

            const curvePointerId = 31;
            const knobPointerId = 32;
            const getBand2Point = (): { x: number; y: number } => {
                const band = getProofState(DEVICE_ID).patch.eqBands[2];
                if (!band) {
                    throw new Error('Expected EQ band 2');
                }
                return {
                    x: (Math.log10(band.freq / 20) / Math.log10(20000 / 20)) * 500,
                    y: 60 - (band.gain / 18) * 60,
                };
            };

            const startCurveGesture = (): void => {
                const point = getBand2Point();
                fireEvent.pointerDown(canvas, {
                    button: 0,
                    clientX: point.x,
                    clientY: point.y,
                    pointerId: curvePointerId,
                });
                fireEvent.pointerMove(canvas, {
                    clientX: point.x + 10,
                    clientY: point.y - 30,
                    pointerId: curvePointerId,
                });
            };

            const startKnobGesture = (): void => {
                fireEvent.pointerDown(knob, { button: 0, pointerId: knobPointerId, clientY: 100 });
                fireEvent.pointerMove(knob, { pointerId: knobPointerId, clientY: 80 });
            };

            if (winner === 'curve') {
                startKnobGesture();
                startCurveGesture();
            } else {
                startCurveGesture();
                startKnobGesture();
            }

            const loser = winner === 'curve' ? knob : canvas;
            const loserPointerId = winner === 'curve' ? knobPointerId : curvePointerId;
            const winningElement = winner === 'curve' ? canvas : knob;
            const winningPointerId = winner === 'curve' ? curvePointerId : knobPointerId;

            if (winner === 'curve') {
                const point = getBand2Point();
                fireEvent.pointerMove(winningElement, {
                    pointerId: winningPointerId,
                    clientX: point.x + 15,
                    clientY: point.y - 25,
                });
            } else {
                fireEvent.pointerMove(winningElement, { pointerId: winningPointerId, clientY: 65 });
            }

            const expectedBand = getProofState(DEVICE_ID).patch.eqBands[2];
            if (!expectedBand) {
                throw new Error('Expected the winning EQ band 2 edit');
            }
            expect(persistDevicePatchMock).toHaveBeenCalledTimes(1);
            const transientEngineWriteCount = bridge.setParam.mock.calls.length;
            if (winner === 'curve') {
                fireEvent.pointerMove(loser, { pointerId: loserPointerId, clientY: 40 });
            } else {
                const point = getBand2Point();
                fireEvent.pointerMove(loser, {
                    pointerId: loserPointerId,
                    clientX: point.x + 20,
                    clientY: point.y - 20,
                });
            }

            expect(getProofState(DEVICE_ID).patch.eqBands[2]).toMatchObject({
                freq: expectedBand.freq,
                gain: expectedBand.gain,
            });
            expect(bridge.setParam).toHaveBeenCalledTimes(transientEngineWriteCount);

            endGesture(loser, loserPointerId, unmount);

            if (_end !== 'unmount') {
                fireEvent.pointerUp(winningElement, { pointerId: winningPointerId });
            }

            expect(getProofState(DEVICE_ID).patch.eqBands[2]).toMatchObject({
                freq: expectedBand.freq,
                gain: expectedBand.gain,
            });
            expect(persistDevicePatchMock).toHaveBeenCalledTimes(2);
            expect(persistDevicePatchMock).toHaveBeenCalledWith(
                DEVICE_ID,
                expect.objectContaining({
                    eq_band2_freq: expectedBand.freq,
                    eq_band2_gain: expectedBand.gain,
                })
            );
            expect(bridge.setParam).toHaveBeenCalledTimes(transientEngineWriteCount);

            if (_end !== 'unmount') {
                unmount();
            }
        }
    );

    it.each(EQ_ROTARY_REPLACEMENT_CASES)(
        'preserves a replacement preset after a stale EQ %s drag via %s',
        (_field, _end, fieldIndex, endGesture) => {
            const bridge = makeBridge();
            bridges.set(DEVICE_ID, bridge);
            seedState({ uiLevel: 3 });

            const { container, unmount } = render(<ProofPanel deviceId={DEVICE_ID} />);
            const knobs = container.querySelectorAll<HTMLElement>('.cursor-ns-resize');
            const knob = knobs.item(6 + fieldIndex);
            if (!knob) {
                throw new Error(`Expected the EQ ${_field} knob`);
            }

            fireEvent.pointerDown(knob, { button: 0, pointerId: 16, clientY: 100 });
            fireEvent.pointerMove(knob, { pointerId: 16, clientY: 80 });
            expect(getProofState(DEVICE_ID).patch.presetId).toBeUndefined();

            fireEvent.click(screen.getByRole('button', { name: /Streaming Master/ }));

            expect(getProofState(DEVICE_ID).patch).toEqual(
                PROOF_PRESETS.find((preset) => preset.id === 'streaming')?.patch
            );
            expect(persistDevicePatchMock).toHaveBeenCalledTimes(1);

            endGesture(knob, unmount);

            expect(getProofState(DEVICE_ID).patch).toEqual(
                PROOF_PRESETS.find((preset) => preset.id === 'streaming')?.patch
            );
            expect(persistDevicePatchMock).toHaveBeenCalledTimes(1);
        }
    );

    it.each(PROOF_ROTARY_REPLACEMENT_CASES)(
        'preserves an authoritative replacement after a stale Proof %s drag via %s',
        (_shape, _end, uiLevel, knobIndex, replacement, endGesture) => {
            const bridge = makeBridge();
            bridges.set(DEVICE_ID, bridge);
            seedState({ uiLevel });

            const { container, unmount } = render(<ProofPanel deviceId={DEVICE_ID} />);
            const knobs = container.querySelectorAll<HTMLElement>('.cursor-ns-resize');
            const knob = knobs.item(knobIndex);
            if (!knob) {
                throw new Error(`Expected the ${_shape} Proof rotary`);
            }

            fireEvent.pointerDown(knob, { button: 0, pointerId: 16, clientY: 100 });
            fireEvent.pointerMove(knob, { pointerId: 16, clientY: 80 });
            const replacementPatch = replacement(getProofState(DEVICE_ID).patch);

            act(() => {
                loadProofPatchWithAudio({ deviceId: DEVICE_ID, patch: replacementPatch });
            });

            expect(getProofState(DEVICE_ID).patch).toEqual(replacementPatch);
            expect(persistDevicePatchMock).toHaveBeenCalledTimes(1);

            endGesture(knob, unmount);

            expect(getProofState(DEVICE_ID).patch).toEqual(replacementPatch);
            expect(persistDevicePatchMock).toHaveBeenCalledTimes(1);
        }
    );

    it.each([
        ['frequency', 0],
        ['gain', 1],
        ['Q', 2],
    ] as const)('finalizes an accepted EQ %s rotary drag exactly once', (_field, fieldIndex) => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        seedState({ uiLevel: 3 });

        const { container } = render(<ProofPanel deviceId={DEVICE_ID} />);
        const knobs = container.querySelectorAll<HTMLElement>('.cursor-ns-resize');
        const knob = knobs.item(6 + fieldIndex);
        if (!knob) {
            throw new Error(`Expected the EQ ${_field} knob`);
        }

        fireEvent.pointerDown(knob, { button: 0, pointerId: 17, clientY: 100 });
        fireEvent.pointerMove(knob, { pointerId: 17, clientY: 80 });
        expect(persistDevicePatchMock).not.toHaveBeenCalled();

        fireEvent.pointerUp(knob, { pointerId: 17 });

        expect(persistDevicePatchMock).toHaveBeenCalledTimes(1);
        expect(getProofState(DEVICE_ID).patch.presetId).toBeUndefined();
    });

    it('toggles A/B compare through the bridge and the store (no inline view-code store write)', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        seedState({ abBypass: false });

        render(<ProofPanel deviceId={DEVICE_ID} />);

        // Clicking the compare chip must route through setProofParam (engine) and
        // setProofAbBypass (store) — the prior implementation poked proofStore.set
        // inline from view code.
        fireEvent.click(screen.getByText('B / wet'));

        expect(bridge.setParam).toHaveBeenCalledWith('ab_bypass', 1);
        expect(getProofState(DEVICE_ID).abBypass).toBe(true);
    });

    // ── Fix 1: latency readout uses the real sample rate, not a hard-coded 44100 ──
    it('computes the latency readout from the engine sample rate', () => {
        sampleRateMock.mockReturnValue(48_000);
        seedState({ uiLevel: 4, latency: 480 });

        render(<ProofPanel deviceId={DEVICE_ID} />);

        // 480 samples / 48000 Hz = 10.0 ms. At the old hard-coded 44100 it would read 10.9 ms.
        expect(screen.getByText(/\(10\.0ms\)/)).toBeInTheDocument();
        expect(screen.queryByText(/\(10\.9ms\)/)).not.toBeInTheDocument();
    });

    // ── Fix 6: accessibility — reorder controls and a live order announcement ──
    it('exposes keyboard-labelled chain-reorder controls and a live order announcement', () => {
        seedState({ uiLevel: 4 });

        render(<ProofPanel deviceId={DEVICE_ID} />);

        expect(screen.getByLabelText('Move EQ later in the chain')).toBeInTheDocument();
        expect(screen.getByLabelText('Move Limiter earlier in the chain')).toBeInTheDocument();
        const status = screen.getByRole('status');
        expect(status).toHaveTextContent('Signal chain order: EQ, Dynamics, Imager, Exciter, Limiter');
    });

    // ── Fix 6: accessibility — inline tap meters ──
    it('exposes the inline tap meters as ARIA meters with current values', () => {
        seedState({
            uiLevel: 2,
            tapPeaks: [
                { peakL: -12, peakR: -10 },
                { peakL: -100, peakR: -100 },
                { peakL: -100, peakR: -100 },
                { peakL: -100, peakR: -100 },
                { peakL: -100, peakR: -100 },
                { peakL: -100, peakR: -100 },
            ],
        });

        render(<ProofPanel deviceId={DEVICE_ID} />);

        const inputMeter = screen.getByLabelText('IN peak left');
        expect(inputMeter).toHaveAttribute('role', 'meter');
        expect(inputMeter).toHaveAttribute('aria-valuenow', '-12');
        expect(inputMeter).toHaveAttribute('aria-valuemin', '-60');
        expect(inputMeter).toHaveAttribute('aria-valuemax', '0');
    });

    // ── Fix 6: accessibility — streaming loudness warning is an alert ──
    it('announces the streaming loudness warning as an alert', () => {
        seedState({ uiLevel: 1, integratedLufs: -8 }); // well above the -14 streaming target

        render(<ProofPanel deviceId={DEVICE_ID} />);

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(/turned down/);
    });

    it('uses the saved custom target for the loudness warning', () => {
        seedState({
            integratedLufs: -16,
            patch: { ...getProofState(DEVICE_ID).patch, target: 'custom', targetLufs: -18 },
        });

        render(<ProofPanel deviceId={DEVICE_ID} />);

        expect(screen.getByRole('alert')).toHaveTextContent('turned down by 2.0 dB');
    });

    it.each([3, 5] as const)('draws the saved custom target in Level %s loudness history', (uiLevel) => {
        const context = document.createElement('canvas').getContext('2d');
        if (!context) {
            throw new Error('Expected the test canvas context');
        }
        const fillText = vi.spyOn(context, 'fillText');

        try {
            seedState({
                uiLevel,
                patch: { ...getProofState(DEVICE_ID).patch, target: 'custom', targetLufs: -18 },
            });

            render(<ProofPanel deviceId={DEVICE_ID} />);

            expect(fillText).toHaveBeenCalledWith('-18 LUFS', expect.any(Number), expect.any(Number));
        } finally {
            fillText.mockRestore();
        }
    });

    // ── Fix 2: the dead EQ "Output Gain" stub knob is gone ──
    it('does not render the no-op EQ Output Gain knob in the shape view', () => {
        seedState({ uiLevel: 2 });

        render(<ProofPanel deviceId={DEVICE_ID} />);

        expect(screen.queryByText('Output Gain')).not.toBeInTheDocument();
    });

    it('routes Level 3 patch edits through owned patch persistence and engine sync', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        seedState({ uiLevel: 3 });

        render(<ProofPanel deviceId={DEVICE_ID} />);

        const limiterToggle = screen.getByRole('button', { name: 'Limiter module' });
        expect(limiterToggle).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(limiterToggle);

        expect(getProofState(DEVICE_ID).patch.limBypassed).toBe(true);
        expect(persistDevicePatchMock).toHaveBeenCalledWith(DEVICE_ID, { lim_bypass: 1 });
        expect(bridge.setParam).toHaveBeenCalledWith('lim_bypass', 1);
    });
});
