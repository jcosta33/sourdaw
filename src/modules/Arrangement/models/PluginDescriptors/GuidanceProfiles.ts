import {
    type DeviceGainCompensationDeclaration,
    type DeviceParameter,
    type DeviceParameterGuidance,
    type PluginDescriptorCapabilities,
    type PluginDescriptorGuidance,
} from '../DeviceParameterTypes';

import { parameterGuidance } from './DescriptorGuidance';

type DeviceGuidance = Omit<PluginDescriptorGuidance, 'parameters'> & { capabilities: PluginDescriptorCapabilities };

function unavailable(reason: string): PluginDescriptorCapabilities['instrumentGeneration'] {
    return { availability: 'unavailable', reason };
}

function audioProcessingCapabilities(): PluginDescriptorCapabilities {
    return {
        instrumentGeneration: unavailable('This processor does not generate note-driven audio.'),
        audioProcessing: {
            availability: 'available',
            detail: 'Processes incoming audio with the declared effect algorithm.',
        },
        audioAnalysis: unavailable('This processor does not publish analysis output.'),
        referenceSignalGeneration: unavailable('This processor does not publish a calibration reference signal.'),
    };
}

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
    return { usage, safety, interactions, risks, gainCompensation, capabilities: audioProcessingCapabilities() };
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
        capabilities: {
            instrumentGeneration: {
                availability: 'available',
                detail: 'Generates an instrument signal from accepted note events.',
            },
            audioProcessing: unavailable('This instrument has no incoming-audio processing path.'),
            audioAnalysis: unavailable('This instrument does not publish analysis output.'),
            referenceSignalGeneration: unavailable('This instrument does not publish a calibration reference signal.'),
        },
    };
}

export function analysisGuidance(
    usage: string,
    safety: readonly string[],
    interactions: readonly string[],
    risks: readonly string[],
    gainCompensation: DeviceGainCompensationDeclaration
): DeviceGuidance {
    return {
        usage,
        safety,
        interactions,
        risks,
        gainCompensation,
        capabilities: {
            instrumentGeneration: unavailable('This analyzer does not generate note-driven audio.'),
            audioProcessing: unavailable('This analyzer does not alter the audio signal.'),
            audioAnalysis: { availability: 'available', detail: 'Measures audio without changing its signal path.' },
            referenceSignalGeneration: unavailable('This analyzer does not publish a calibration reference signal.'),
        },
    };
}

export function referenceSignalGuidance(
    usage: string,
    safety: readonly string[],
    interactions: readonly string[],
    risks: readonly string[],
    gainCompensation: DeviceGainCompensationDeclaration
): DeviceGuidance {
    return {
        usage,
        safety,
        interactions,
        risks,
        gainCompensation,
        capabilities: {
            instrumentGeneration: unavailable('This reference utility does not accept note events.'),
            audioProcessing: unavailable('This reference utility does not process incoming audio.'),
            audioAnalysis: unavailable('This reference utility does not publish analysis output.'),
            referenceSignalGeneration: {
                availability: 'available',
                detail: 'Generates a calibration reference tone when enabled.',
            },
        },
    };
}
