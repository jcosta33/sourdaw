import {
    offlineDeviceParameterLawState,
    type OfflineDeviceParameterAutomatablePredicate,
    type OfflineDeviceParameterClamp,
    type OfflineDeviceParameterQuantise,
    type OfflineExternalPluginParameterClamp,
    type OfflineExternalPluginParameterPredicate,
} from './offlineDeviceParameterLawState';

type SetOfflineDeviceParameterLawInput = {
    isAutomatable: OfflineDeviceParameterAutomatablePredicate;
    clampValue: OfflineDeviceParameterClamp;
    quantiseValue: OfflineDeviceParameterQuantise;
    acceptsExternalPluginParameter: OfflineExternalPluginParameterPredicate;
    clampExternalPluginValue: OfflineExternalPluginParameterClamp;
};

export function setOfflineDeviceParameterLaw({
    isAutomatable,
    clampValue,
    quantiseValue,
    acceptsExternalPluginParameter,
    clampExternalPluginValue,
}: SetOfflineDeviceParameterLawInput): void {
    offlineDeviceParameterLawState.isAutomatable = isAutomatable;
    offlineDeviceParameterLawState.clampValue = clampValue;
    offlineDeviceParameterLawState.quantiseValue = quantiseValue;
    offlineDeviceParameterLawState.acceptsExternalPluginParameter = acceptsExternalPluginParameter;
    offlineDeviceParameterLawState.clampExternalPluginValue = clampExternalPluginValue;
}
