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
    webGpuTier: 'webgpu-fast',
    sharedArrayBuffer: true,
    opfsAvailable: true,
    chromeVersion: 133,
    benchmarkMs: 12.34,
    detectedAt: 1_803_556_800_000,
};

describe('CapabilityReportPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capabilityStore.set({ phase: 'idle' });
    });

    it('should render the idle empty state and trigger a forced refresh on click', () => {
        render(<CapabilityReportPanel />);

        expect(screen.getByText('No capabilities detected')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Detect Capabilities' }));

        expect(mocks.detectCapabilities).toHaveBeenCalledWith({ forceRefresh: true });
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

        expect(mocks.detectCapabilities).toHaveBeenCalledWith({ forceRefresh: true });
    });

    it('should render the unsupported-platform reason with a native rendering summary', () => {
        capabilityStore.set({
            phase: 'done',
            report: { ...SUPPORTED_REPORT, capability: 'unsupported-platform' },
        });

        render(<CapabilityReportPanel />);

        expect(screen.getByText('Browser AI Unavailable')).toBeInTheDocument();
        expect(screen.getByText('macOS/Linux Tauri — use native renderer')).toBeInTheDocument();
        expect(screen.getByText('Native rendering is available in Settings → Audio Generation.')).toBeInTheDocument();
        expect(screen.getByText('Unsupported')).toBeInTheDocument();
    });

    it('should render the unsupported-browser reason without a summary', () => {
        capabilityStore.set({
            phase: 'done',
            report: { ...SUPPORTED_REPORT, capability: 'unsupported-browser' },
        });

        render(<CapabilityReportPanel />);

        expect(screen.getByText('Non-Chrome browser — AI features require Chrome latest')).toBeInTheDocument();
    });

    it('should render full readouts for a supported report with a fast WebGPU tier', () => {
        capabilityStore.set({ phase: 'done', report: SUPPORTED_REPORT });

        render(<CapabilityReportPanel />);

        expect(screen.getByRole('status', { name: 'Browser AI capabilities' })).toBeInTheDocument();
        expect(screen.getByText('Fast (WebGPU)')).toBeInTheDocument();
        expect(screen.getByText('12.3ms')).toBeInTheDocument();
        expect(screen.getAllByText('Available')).toHaveLength(2);
        expect(screen.getByText('133')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Re-detect capabilities' }));
        expect(mocks.detectCapabilities).toHaveBeenCalledWith({ forceRefresh: true });
    });

    it('should render the slow WebGPU tier and unavailable shared memory / OPFS', () => {
        capabilityStore.set({
            phase: 'done',
            report: {
                ...SUPPORTED_REPORT,
                webGpuTier: 'webgpu-slow',
                sharedArrayBuffer: false,
                opfsAvailable: false,
                benchmarkMs: null,
                chromeVersion: null,
            },
        });

        render(<CapabilityReportPanel />);

        expect(screen.getByText('Slow (WebGPU)')).toBeInTheDocument();
        expect(screen.getAllByText('Unavailable')).toHaveLength(2);
        expect(screen.queryByText(/ms$/)).not.toBeInTheDocument();
    });

    it('should render the unavailable WebGPU tier for any non webgpu-* value', () => {
        capabilityStore.set({
            phase: 'done',
            report: { ...SUPPORTED_REPORT, webGpuTier: 'unavailable' },
        });

        render(<CapabilityReportPanel />);

        expect(screen.getByText('Unavailable', { selector: 'span' })).toBeInTheDocument();
    });
});
