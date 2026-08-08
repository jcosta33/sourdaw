/**
 * Use case: Detect browser AI capabilities.
 *
 * Checks Chrome + WebGPU availability and updates the capability store.
 *
 * `measureInference` runs a real Kokoro render to produce the throughput figure
 * the WebGPU tier is derived from. It is expensive — a full model inference — so
 * callers opt in. Without it the report carries `not-requested` and the tier
 * reads `not-measured`, which is the honest answer rather than a grade.
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { detectCapabilities as detectCapabilitiesRepo } from '../repositories/capabilityDetector';
import { setCapabilityDetecting, setCapabilityReport, setCapabilityError } from '../stores/capabilityStore';

type DetectCapabilitiesInput = { forceRefresh?: boolean; measureInference?: boolean };

export const detectCapabilities = inject({ logger, detectCapabilitiesRepo })(
    ({ logger, detectCapabilitiesRepo }) =>
        async function detectCapabilities({
            forceRefresh = false,
            measureInference = false,
        }: DetectCapabilitiesInput = {}): Promise<void> {
            setCapabilityDetecting();
            try {
                const report = await detectCapabilitiesRepo({ forceRefresh, measureInference });
                setCapabilityReport(report);
                logger.info(`[BrowserAi] Capability detection complete: ${report.capability} / ${report.webGpuTier}`);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setCapabilityError(message);
                logger.error(new Error(`[BrowserAi] Capability detection failed: ${message}`));
            }
        }
);
