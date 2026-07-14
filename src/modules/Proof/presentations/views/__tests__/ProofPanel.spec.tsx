import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { proofStore, getProofState, type ProofState } from '../../../stores/proofStore';
import { bridges, type ProofAudioBridge } from '../../../useCases/proofParamBridge/helpers';
import { ProofPanel } from '../ProofPanel';

// getAudioSampleRate reads the live AudioContext, which jsdom does not provide.
// Mock it so the latency readout assertion can pin a known, non-44100 rate.
const sampleRateMock = vi.fn<[], number>(() => 48_000);
const { persistDevicePatchMock } = vi.hoisted(() => ({ persistDevicePatchMock: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    getAudioSampleRate: () => sampleRateMock(),
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
    });

    it('forwards a target selection to the audio bridge and the store', () => {
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

        const moduleToggles = screen.getAllByRole('button', { name: 'ON' });
        fireEvent.click(moduleToggles.at(-1)!);

        expect(getProofState(DEVICE_ID).patch.limBypassed).toBe(true);
        expect(persistDevicePatchMock).toHaveBeenCalledWith(DEVICE_ID, { lim_bypass: 1 });
        expect(bridge.setParam).toHaveBeenCalledWith('lim_bypass', 1);
    });
});
