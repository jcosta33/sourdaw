import { setOfflineDeviceParameterLaw } from '../repositories/offlineScheduler/setOfflineDeviceParameterLaw';

type ConfigureOfflineDeviceParameterLawInput = Parameters<typeof setOfflineDeviceParameterLaw>[0];

/**
 * Hand the audio engine the same device-parameter law the live apply path
 * enforces — the built-in descriptor half and the hosted-instance half. Wired at
 * the composition root, which is the only place that may see both Arrangement
 * and the audio engine, and read by the offline render and by the native live
 * automation producer alike.
 */
export function configureOfflineDeviceParameterLaw({
    isAutomatable,
    clampValue,
    quantiseValue,
    acceptsExternalPluginParameter,
    clampExternalPluginValue,
}: ConfigureOfflineDeviceParameterLawInput): void {
    setOfflineDeviceParameterLaw({
        isAutomatable,
        clampValue,
        quantiseValue,
        acceptsExternalPluginParameter,
        clampExternalPluginValue,
    });
}
