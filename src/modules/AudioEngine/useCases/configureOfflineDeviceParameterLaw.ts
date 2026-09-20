import { setOfflineDeviceParameterLaw } from '../repositories/offlineScheduler/setOfflineDeviceParameterLaw';

import { offlineRenderCapturePorts } from './offlineRender/offlineRenderCapturePorts';

type ConfigureOfflineDeviceParameterLawInput = Parameters<typeof setOfflineDeviceParameterLaw>[0] & {
    captureExternalPluginLaw?: NonNullable<typeof offlineRenderCapturePorts.captureExternalPluginLaw>;
};

/**
 * Hand the audio engine the same device-parameter law the live apply path
 * enforces — the built-in descriptor half and the hosted-instance half. Wired at
 * the composition root, which is the only place that may see both Arrangement
 * and the audio engine, and read by the offline render and by the native live
 * automation producer alike.
 */
export function configureOfflineDeviceParameterLaw({
    captureExternalPluginLaw,
    isAutomatable,
    clampValue,
    quantiseValue,
    acceptsExternalPluginParameter,
    clampExternalPluginValue,
}: ConfigureOfflineDeviceParameterLawInput): void {
    offlineRenderCapturePorts.captureExternalPluginLaw = captureExternalPluginLaw ?? null;
    setOfflineDeviceParameterLaw({
        isAutomatable,
        clampValue,
        quantiseValue,
        acceptsExternalPluginParameter,
        clampExternalPluginValue,
    });
}
