import { findExternalPluginAutomationParameter } from './findExternalPluginAutomationParameter';

/**
 * Whether a curve may drive this parameter on an external plugin instance.
 *
 * The instance's own published parameter list is the whole contract. Nothing
 * else can serve as one: an external device has no static descriptor, and its
 * `parameterValues` stay empty until something writes a parameter by hand — so
 * reading either would refuse or accept for reasons that have nothing to do
 * with what the plugin offers. The device's `type` is therefore not an input:
 * every external plugin device spells the same one, and it answers for no
 * parameter.
 */
export function acceptsExternalPluginAutomationParameter(externalInstanceId: string, parameterId: string): boolean {
    return findExternalPluginAutomationParameter(externalInstanceId, parameterId)?.isAutomatable ?? false;
}
