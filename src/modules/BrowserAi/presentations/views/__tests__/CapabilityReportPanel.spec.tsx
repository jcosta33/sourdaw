import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type CapabilityReport } from '../../../models/CapabilityReport';
import { capabilityStore } from '../../../stores/capabilityStore';
import { CapabilityReportPanel } from '../CapabilityReportPanel';

const mocks = vi.hoisted(() => ({
    detectCapabilities: vi.fn(),
}));

vi.mock('../../../useCases/detectCapabilities', () => ({
    detectCapabilities: mocks.detectCapabilities,
}));

const SUPPORTED_REPORT: CapabilityReport = {
    capability: 'supported',
    webGpu: { status: 'supported' },
    webGpuTier: 'webgpu-fast',
    crossOriginIsolated: true,
    workerAvailable: true,
    opfsAvailable: true,
    inference: {
        status: 'measured',
        modelId: 'kokoro-82m-q8',
        executionProviders: ['webgpu', 'wasm'],
        audioSeconds: 4,
        elapsedSeconds: 2.5,
        realtimeFactor: 1.6,
    },
    detectedAt: 1_803_556_800_000,
};

const REFRESH_ARGS = { forceRefresh: true, measureInference: true };

describe('CapabilityReportPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capabilityStore.set({ phase: 'idle' });
    });

    it('should render the idle empty state and trigger a forced refresh on click', () => {
        render(<CapabilityReportPanel />);

        expect(screen.getByText('No capabilities detected')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Detect Capabilities' }));

        expect(mocks.detectCapabilities).toHaveBeenCalledWith(REFRESH_ARGS);
    });

    it('should render the detecting state', () => {
        capabilityStore.set({ phase: 'detecting' });

        render(<CapabilityReportPanel />);

        expect(screen.getByText('Detecting…')).toBeInTheDocument();
    });

    it('should render the error state and retry on click', () => {
        capabilityStore.set({ phase: 'error', message: 'benchmark timed out' });

        render(<CapabilityReportPanel />);

        expect(screen.getByText('Detection Failed')).toBeInTheDocument();
        expect(screen.getByText('Capability detection failed: benchmark timed out')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

        expect(mocks.detectCapabilities).toHaveBeenCalledWith(REFRESH_ARGS);
    });

    it.each([
        ['missing-surface', 'WebGPU is not exposed by this runtime'],
        ['adapter-unavailable', 'No core WebGPU adapter is available'],
        ['fallback-adapter', 'Only a software WebGPU fallback adapter is available'],
        ['device-unavailable', 'The WebGPU adapter could not create a device'],
        ['probe-failed', 'The WebGPU usability check could not complete'],
    ] as const)('should show the explicit WebGPU admission failure: %s', (reason, expected) => {
        capabilityStore.set({
            phase: 'done',
            report: {
                ...SUPPORTED_REPORT,
                capability: 'unsupported-browser',
                webGpu: { status: 'unavailable', reason },
            },
        });

        render(<CapabilityReportPanel />);

        expect(screen.getByText('Browser AI Unavailable')).toBeInTheDocument();
        expect(screen.getByText(expected)).toBeInTheDocument();
        expect(screen.getByText('Unsupported')).toBeInTheDocument();
    });

    it.each([
        ['workerAvailable', 'Web Workers are unavailable in this runtime'],
        ['crossOriginIsolated', 'Cross-origin isolation is not active in this runtime'],
        ['opfsAvailable', 'Origin-private model storage is unavailable in this runtime'],
    ] as const)('should show the explicit required capability failure: %s', (capability, expected) => {
        capabilityStore.set({
            phase: 'done',
            report: {
                ...SUPPORTED_REPORT,
                capability: 'unsupported-browser',
                [capability]: false,
            },
        });

        render(<CapabilityReportPanel />);

        expect(screen.getByText('Browser AI Unavailable')).toBeInTheDocument();
        expect(screen.getByText(expected)).toBeInTheDocument();
        expect(screen.getByText('Unsupported')).toBeInTheDocument();
    });

    it('should render full readouts for a supported report with a fast WebGPU tier', () => {
        capabilityStore.set({ phase: 'done', report: SUPPORTED_REPORT });

        render(<CapabilityReportPanel />);

        expect(screen.getByRole('status', { name: 'Browser AI capabilities' })).toBeInTheDocument();
        expect(screen.getByText('Fast (WebGPU)')).toBeInTheDocument();
        expect(screen.getByText('1.60× real time')).toBeInTheDocument();
        expect(screen.getByText('kokoro-82m-q8 · webgpu → wasm')).toBeInTheDocument();
        expect(screen.getAllByText('Available')).toHaveLength(4);
        expect(screen.getByText('Cross-Origin Isolation')).toBeInTheDocument();
        expect(screen.getByText('Web Workers')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Re-detect capabilities' }));
        expect(mocks.detectCapabilities).toHaveBeenCalledWith(REFRESH_ARGS);
    });

    it('should render the slow WebGPU tier', () => {
        capabilityStore.set({
            phase: 'done',
            report: {
                ...SUPPORTED_REPORT,
                webGpuTier: 'webgpu-slow',
                inference: {
                    status: 'measured',
                    modelId: 'kokoro-82m-q8',
                    executionProviders: ['webgpu', 'wasm'],
                    audioSeconds: 4,
                    elapsedSeconds: 10,
                    realtimeFactor: 0.4,
                },
            },
        });

        render(<CapabilityReportPanel />);

        expect(screen.getByText('Slow (WebGPU)')).toBeInTheDocument();
        expect(screen.getByText('0.40× real time')).toBeInTheDocument();
    });

    it('should render the unavailable WebGPU tier for any non webgpu-* value', () => {
        capabilityStore.set({
            phase: 'done',
            report: { ...SUPPORTED_REPORT, webGpuTier: 'unavailable' },
        });

        render(<CapabilityReportPanel />);

        expect(screen.getByText('Unavailable', { selector: 'span' })).toBeInTheDocument();
    });

    // ── The tier must never look graded when nothing was measured ────────────

    it.each([
        ['not-requested', 'Not measured — press Refresh to run it'],
        ['no-webgpu', 'Not measured — no WebGPU on this target'],
        ['model-not-cached', 'Not measured — download Kokoro TTS first'],
        ['runtime-unavailable', 'Not measured — ONNX runtime failed to start'],
        ['inference-failed', 'Not measured — the probe render produced no audio'],
    ] as const)('should name the cause when throughput is not measured: %s', (reason, expected) => {
        capabilityStore.set({
            phase: 'done',
            report: {
                ...SUPPORTED_REPORT,
                webGpuTier: 'not-measured',
                inference: { status: 'not-measured', reason },
            },
        });

        render(<CapabilityReportPanel />);

        expect(screen.getByText('Not Measured')).toBeInTheDocument();
        expect(screen.getByText(expected)).toBeInTheDocument();
        // No probe row, because there was no probe.
        expect(screen.queryByText(/× real time$/)).not.toBeInTheDocument();
        expect(screen.queryByText(/webgpu → wasm/)).not.toBeInTheDocument();
    });
});
