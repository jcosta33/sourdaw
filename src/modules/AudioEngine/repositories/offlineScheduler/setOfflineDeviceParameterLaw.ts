import {
    offlineDeviceParameterLawState,
    type OfflineDeviceParameterAutomatablePredicate,
    type OfflineDeviceParameterClamp,
    type OfflineDeviceParameterQuantise,
} from './offlineDeviceParameterLawState';

type SetOfflineDeviceParameterLawInput = {
    isAutomatable: OfflineDeviceParameterAutomatablePredicate;
    clampValue: OfflineDeviceParameterClamp;
    quantiseValue: OfflineDeviceParameterQuantise;
};

export function setOfflineDeviceParameterLaw({
    isAutomatable,
    clampValue,
    quantiseValue,
}: SetOfflineDeviceParameterLawInput): void {
    offlineDeviceParameterLawState.isAutomatable = isAutomatable;
    offlineDeviceParameterLawState.clampValue = clampValue;
    offlineDeviceParameterLawState.quantiseValue = quantiseValue;
}
