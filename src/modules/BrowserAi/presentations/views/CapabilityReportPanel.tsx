import { type ReactElement } from 'react';

import { DawBlockedState } from '#/components/daw/DawBlockedState';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { DawUtilitySection } from '#/components/daw/DawUtilitySection';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';

import { type InferenceThroughput } from '../../models/CapabilityReport';
import { type WebGpuUnavailableReason } from '../../models/WebGpuProbe';
import { capabilityStore } from '../../stores/capabilityStore';
import { detectCapabilities } from '../../useCases/detectCapabilities';

/**
 * Plain-language cause for an absent throughput figure. The panel says which
 * one it is rather than showing a grade it did not earn.
 */
const NOT_MEASURED_LABELS: Record<Extract<InferenceThroughput, { status: 'not-measured' }>['reason'], string> = {
    'not-requested': 'Not measured — press Refresh to run it',
    'no-webgpu': 'Not measured — no WebGPU on this target',
    'model-not-cached': 'Not measured — download Kokoro TTS first',
    'runtime-unavailable': 'Not measured — ONNX runtime failed to start',
    'inference-failed': 'Not measured — the probe render produced no audio',
};

const WEBGPU_UNAVAILABLE_LABELS: Record<WebGpuUnavailableReason, string> = {
    'missing-surface': 'WebGPU is not exposed by this Chromium runtime',
    'adapter-unavailable': 'No core WebGPU adapter is available',
    'fallback-adapter': 'Only a software WebGPU fallback adapter is available',
    'device-unavailable': 'The WebGPU adapter could not create a device',
};

export function CapabilityReportPanel(): ReactElement {
    const state = useStore(capabilityStore, { phase: 'idle' });

    const handleRefresh = (): void => {
        void detectCapabilities({ forceRefresh: true, measureInference: true });
    };

    if (!state || state.phase === 'idle') {
        return (
            <DawEmptyState
                compact
                title="No capabilities detected"
                description="Browser AI capabilities have not been detected yet."
                action={
                    <Button size="xs" variant="outline" type="button" onClick={handleRefresh}>
                        Detect Capabilities
                    </Button>
                }
            />
        );
    }

    if (state.phase === 'detecting') {
        return <DawEmptyState compact title="Detecting…" description="Detecting browser AI capabilities." />;
    }

    if (state.phase === 'error') {
        return (
            <DawBlockedState
                compact
                title="Detection Failed"
                description={`Capability detection failed: ${state.message}`}
                action={
                    <Button size="xs" variant="danger" type="button" onClick={handleRefresh}>
                        Retry
                    </Button>
                }
            />
        );
    }

    const { report } = state;

    if (report.capability !== 'supported') {
        // Two distinct causes land here and the copy must not conflate them:
        // a Chromium renderer without WebGPU (older build, refused GPU stack,
        // desktop app on a blocked GPU) versus a genuinely non-Chrome browser.
        let description: string;
        if (report.chromeVersion === null) {
            description = 'Non-Chrome browser — AI features require Chrome latest';
        } else if (report.webGpu.status === 'unavailable') {
            description = WEBGPU_UNAVAILABLE_LABELS[report.webGpu.reason];
        } else {
            description = 'Browser AI is unavailable in this Chromium runtime';
        }
        return (
            <DawBlockedState
                compact
                eyebrow="Browser AI"
                title="Browser AI Unavailable"
                description={description}
                action={<DawMicroBadge tone="danger">Unsupported</DawMicroBadge>}
            />
        );
    }

    let tierTone: 'success' | 'peach' | 'danger' | 'muted';
    if (report.webGpuTier === 'webgpu-fast') {
        tierTone = 'success';
    } else if (report.webGpuTier === 'webgpu-slow') {
        tierTone = 'peach';
    } else if (report.webGpuTier === 'not-measured') {
        tierTone = 'muted';
    } else {
        tierTone = 'danger';
    }

    let tierLabel: string;
    if (report.webGpuTier === 'webgpu-fast') {
        tierLabel = 'Fast (WebGPU)';
    } else if (report.webGpuTier === 'webgpu-slow') {
        tierLabel = 'Slow (WebGPU)';
    } else if (report.webGpuTier === 'not-measured') {
        tierLabel = 'Not Measured';
    } else {
        tierLabel = 'Unavailable';
    }

    let throughputValue: string;
    if (report.inference.status === 'measured') {
        throughputValue = `${report.inference.realtimeFactor.toFixed(2)}× real time`;
    } else {
        throughputValue = NOT_MEASURED_LABELS[report.inference.reason];
    }

    return (
        <DawUtilitySection
            title="Browser AI Capabilities"
            actions={
                <button
                    type="button"
                    onClick={handleRefresh}
                    className="text-[10px] text-muted-foreground/70 hover:text-muted-foreground transition-colors"
                    aria-label="Re-detect capabilities"
                >
                    Refresh
                </button>
            }
            role="status"
            aria-label="Browser AI capabilities"
        >
            <div className="space-y-1">
                <DawReadoutRow label="WebGPU" value={<DawMicroBadge tone="success">Available</DawMicroBadge>} />
                <DawReadoutRow
                    label="Render Performance"
                    value={<DawMicroBadge tone={tierTone}>{tierLabel}</DawMicroBadge>}
                />
                <DawReadoutRow label="Render Throughput" value={throughputValue} />
                {report.inference.status === 'measured' ? (
                    <DawReadoutRow
                        label="Probe"
                        value={`${report.inference.modelId} · ${report.inference.executionProviders.join(' → ')}`}
                    />
                ) : null}
                <DawReadoutRow
                    label="Shared Memory"
                    value={
                        <DawMicroBadge tone={report.sharedArrayBuffer ? 'success' : 'danger'}>
                            {report.sharedArrayBuffer ? 'Available' : 'Unavailable'}
                        </DawMicroBadge>
                    }
                />
                <DawReadoutRow
                    label="Model Storage (OPFS)"
                    value={
                        <DawMicroBadge tone={report.opfsAvailable ? 'success' : 'danger'}>
                            {report.opfsAvailable ? 'Available' : 'Unavailable'}
                        </DawMicroBadge>
                    }
                />
                {report.chromeVersion !== null ? (
                    <DawReadoutRow label="Chrome Version" value={String(report.chromeVersion)} />
                ) : null}
            </div>
        </DawUtilitySection>
    );
}
