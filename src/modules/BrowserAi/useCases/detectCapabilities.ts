/**
 * Use case: Detect browser AI capabilities.
 *
 * Checks Chrome + WebGPU availability, runs a micro-benchmark,
 * and updates the capability store.
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { detectCapabilities as detectCapabilitiesRepo } from '../repositories/capabilityDetector';
import { setCapabilityDetecting, setCapabilityReport, setCapabilityError } from '../stores/capabilityStore';

type DetectCapabilitiesInput = { forceRefresh?: boolean };

export const detectCapabilities = inject({ logger, detectCapabilitiesRepo })(
    ({ logger, detectCapabilitiesRepo }) =>
        async function detectCapabilities({ forceRefresh = false }: DetectCapabilitiesInput = {}): Promise<void> {
            setCapabilityDetecting();
            try {
                const report = await detectCapabilitiesRepo({ forceRefresh });
                setCapabilityReport(report);
                logger.info(`[BrowserAi] Capability detection complete: ${report.capability} / ${report.webGpuTier}`);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setCapabilityError(message);
                logger.error(new Error(`[BrowserAi] Capability detection failed: ${message}`));
            }
        }
);
