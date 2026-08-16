import {
    type DeviceGainCompensationDeclaration,
    type DeviceParameter,
    type DeviceParameterGuidance,
    type PluginDescriptorGuidance,
} from '../DeviceParameterTypes';

import { parameterGuidance } from './DescriptorGuidance';

type DeviceGuidance = Omit<PluginDescriptorGuidance, 'parameters'>;

function defaultCenteredRange(parameter: DeviceParameter): { minimum: number; maximum: number } {
    const span = parameter.maxValue - parameter.minValue;
    const radius = span * 0.25;
    return {
        minimum: Math.max(parameter.minValue, parameter.defaultValue - radius),
        maximum: Math.min(parameter.maxValue, parameter.defaultValue + radius),
    };
}

export function declaredControl(
    semanticRole: string,
    perceptualRole: string,
    interactions: readonly string[],
    risks: readonly string[]
): (parameter: DeviceParameter) => DeviceParameterGuidance {
    return (parameter) => {
        const range = defaultCenteredRange(parameter);
        return parameterGuidance(semanticRole, perceptualRole, range.minimum, range.maximum, interactions, risks, {
            availability: 'unavailable',
            reason: 'This descriptor declares no source-specific modulation route beyond its separate automation capability.',
        });
    };
}

export function effectGuidance(
    usage: string,
    safety: readonly string[],
    interactions: readonly string[],
    risks: readonly string[],
    gainCompensation: DeviceGainCompensationDeclaration
): DeviceGuidance {
    return { usage, safety, interactions, risks, gainCompensation };
}

export function instrumentGuidance(
    usage: string,
    safety: readonly string[],
    interactions: readonly string[],
    risks: readonly string[]
): DeviceGuidance {
    return {
        usage,
        safety,
        interactions,
        risks,
        gainCompensation: {
            availability: 'not-applicable',
            reason: 'This instrument declares no automatic output-level compensation.',
        },
    };
}
