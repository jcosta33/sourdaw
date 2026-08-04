import {
    offlineDeviceParameterLawState,
    type OfflineDeviceParameterAutomatablePredicate,
    type OfflineDeviceParameterClamp,
} from './offlineDeviceParameterLawState';

type SetOfflineDeviceParameterLawInput = {
    isAutomatable: OfflineDeviceParameterAutomatablePredicate;
    clampValue: OfflineDeviceParameterClamp;
};

export function setOfflineDeviceParameterLaw({ isAutomatable, clampValue }: SetOfflineDeviceParameterLawInput): void {
    offlineDeviceParameterLawState.isAutomatable = isAutomatable;
    offlineDeviceParameterLawState.clampValue = clampValue;
}
