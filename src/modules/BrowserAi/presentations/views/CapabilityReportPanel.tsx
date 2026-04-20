import { type ReactElement } from 'react';

import { DawBlockedState } from '#/components/daw/DawBlockedState';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { DawUtilitySection } from '#/components/daw/DawUtilitySection';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';

import { capabilityStore } from '../../stores/capabilityStore';
import { detectCapabilities } from '../../useCases/detectCapabilities';

export function CapabilityReportPanel(): ReactElement {
    const state = useStore(capabilityStore, { phase: 'idle' });

    const handleRefresh = (): void => {
        void detectCapabilities({ forceRefresh: true });
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
        const reason =
            report.capability === 'unsupported-platform'
                ? 'macOS/Linux Tauri — use native renderer'
                : 'Non-Chrome browser — AI features require Chrome latest';

        const summary =
            report.capability === 'unsupported-platform'
                ? 'Native rendering is available in Settings → Audio Generation.'
                : undefined;

        return (
            <DawBlockedState
                compact
                eyebrow="Browser AI"
                title="Browser AI Unavailable"
                description={reason}
                summary={summary}
                action={<DawMicroBadge tone="danger">Unsupported</DawMicroBadge>}
            />
        );
    }

    const tierTone =
        report.webGpuTier === 'webgpu-fast' ? 'success' : report.webGpuTier === 'webgpu-slow' ? 'peach' : 'danger';

    const tierLabel =
        report.webGpuTier === 'webgpu-fast'
            ? 'Fast (WebGPU)'
            : report.webGpuTier === 'webgpu-slow'
              ? 'Slow (WebGPU)'
              : 'Unavailable';

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
                <DawReadoutRow label="WebGPU" value={<DawMicroBadge tone={tierTone}>{tierLabel}</DawMicroBadge>} />
                {report.benchmarkMs !== null ? (
                    <DawReadoutRow label="Benchmark" value={`${report.benchmarkMs.toFixed(1)}ms`} />
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
