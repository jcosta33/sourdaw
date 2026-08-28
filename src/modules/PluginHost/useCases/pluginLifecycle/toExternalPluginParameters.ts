import { type PluginParameter } from '../../repositories/pluginBridge/types';
import { type ExternalPluginParameter } from '../../stores/externalPluginParameterStore';

/**
 * Translate the native host's snake_case parameter DTO into the camelCase read
 * contract other modules see, keeping the wire shape inside the bridge.
 */
export function toExternalPluginParameters(parameters: readonly PluginParameter[]): ExternalPluginParameter[] {
    return parameters.map((parameter) => ({
        id: parameter.id,
        name: parameter.name,
        value: parameter.value,
        defaultValue: parameter.default_value,
        minValue: parameter.min_value,
        maxValue: parameter.max_value,
        // The wire reports an absent unit as `null`; the read contract spells
        // "no unit" as the empty string, which is what a unitless builtin
        // parameter already carries and what a label renders as nothing.
        unit: parameter.unit ?? '',
        isAutomatable: parameter.is_automatable,
    }));
}
