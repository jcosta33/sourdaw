import { setOfflineDeviceParameterLaw } from '../repositories/offlineScheduler/setOfflineDeviceParameterLaw';

type ConfigureOfflineDeviceParameterLawInput = Parameters<typeof setOfflineDeviceParameterLaw>[0];

/**
 * Hand the offline render the same device-parameter law the live apply path
 * enforces. Wired at the composition root, which is the only place that may see
 * both Arrangement and the audio engine.
 */
export function configureOfflineDeviceParameterLaw({
    isAutomatable,
    clampValue,
}: ConfigureOfflineDeviceParameterLawInput): void {
    setOfflineDeviceParameterLaw({ isAutomatable, clampValue });
}
