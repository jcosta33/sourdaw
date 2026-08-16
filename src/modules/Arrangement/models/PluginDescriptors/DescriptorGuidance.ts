import {
    type DeviceParameter,
    type DeviceParameterGuidance,
    type PluginDescriptor,
    type PluginDescriptorGuidance,
} from '../DeviceParameterTypes';

type DescriptorGuidanceDeclaration = {
    deviceId: string;
    guidance: Omit<PluginDescriptorGuidance, 'parameters'>;
    parameterFallback: (parameter: DeviceParameter) => DeviceParameterGuidance;
    parameterOverrides?: Readonly<Record<string, DeviceParameterGuidance>>;
};

function assertGuidanceCoverage(descriptor: PluginDescriptor, guidance: PluginDescriptorGuidance): void {
    if (
        guidance.usage.length === 0 ||
        guidance.safety.length === 0 ||
        guidance.interactions.length === 0 ||
        guidance.risks.length === 0
    ) {
        throw new Error(`Incomplete device guidance for ${descriptor.id}`);
    }
    const declaredIds = new Set(Object.keys(guidance.parameters));
    for (const parameter of descriptor.parameters) {
        const parameterGuidance = guidance.parameters[parameter.id];
        if (!parameterGuidance) {
            throw new Error(`Missing guidance for ${descriptor.id}/${parameter.id}`);
        }
        if (
            parameterGuidance.semanticRole.length === 0 ||
            parameterGuidance.perceptualRole.length === 0 ||
            parameterGuidance.semanticRole === 'continuous-control' ||
            parameterGuidance.perceptualRole === 'audible-parameter' ||
            parameterGuidance.interactions.length === 0 ||
            parameterGuidance.risks.length === 0
        ) {
            throw new Error(`Generic parameter guidance for ${descriptor.id}/${parameter.id}`);
        }
        if (
            parameterGuidance.typicalRange.minimum < parameter.minValue ||
            parameterGuidance.typicalRange.maximum > parameter.maxValue ||
            parameterGuidance.typicalRange.minimum > parameterGuidance.typicalRange.maximum ||
            (parameterGuidance.typicalRange.minimum === parameter.minValue &&
                parameterGuidance.typicalRange.maximum === parameter.maxValue)
        ) {
            throw new Error(`Invalid typical range for ${descriptor.id}/${parameter.id}`);
        }
        declaredIds.delete(parameter.id);
    }
    if (declaredIds.size > 0) {
        throw new Error(`Guidance declares unknown parameters for ${descriptor.id}: ${[...declaredIds].join(', ')}`);
    }
    const gainCompensation = guidance.gainCompensation;
    if (
        gainCompensation.availability === 'provided' &&
        !descriptor.parameters.some((parameter) => parameter.id === gainCompensation.parameterId)
    ) {
        throw new Error(
            `Gain compensation references an unknown parameter for ${descriptor.id}: ${gainCompensation.parameterId}`
        );
    }
}

export function applyDescriptorGuidance(
    descriptors: readonly PluginDescriptor[],
    declarations: readonly DescriptorGuidanceDeclaration[]
): PluginDescriptor[] {
    const guidanceByDeviceId = new Map(declarations.map((declaration) => [declaration.deviceId, declaration]));
    if (guidanceByDeviceId.size !== declarations.length) {
        throw new Error('Descriptor guidance contains duplicate device declarations');
    }
    return descriptors.map((descriptor) => {
        const declaration = guidanceByDeviceId.get(descriptor.id);
        if (!declaration) {
            throw new Error(`Missing guidance for ${descriptor.id}`);
        }
        const guidance = {
            ...declaration.guidance,
            parameters: Object.fromEntries(
                descriptor.parameters.map((parameter) => [
                    parameter.id,
                    declaration.parameterOverrides?.[parameter.id] ?? declaration.parameterFallback(parameter),
                ])
            ),
        };
        const unknownOverrides = Object.keys(declaration.parameterOverrides ?? {}).filter(
            (parameterId) => !descriptor.parameters.some((parameter) => parameter.id === parameterId)
        );
        if (unknownOverrides.length > 0) {
            throw new Error(
                `Guidance declares unknown parameters for ${descriptor.id}: ${unknownOverrides.join(', ')}`
            );
        }
        assertGuidanceCoverage(descriptor, guidance);
        return { ...descriptor, guidance };
    });
}

export function descriptorGuidance(
    deviceId: string,
    guidance: Omit<PluginDescriptorGuidance, 'parameters'>,
    parameterFallback: DescriptorGuidanceDeclaration['parameterFallback'],
    parameterOverrides?: DescriptorGuidanceDeclaration['parameterOverrides']
): DescriptorGuidanceDeclaration {
    return { deviceId, guidance, parameterFallback, parameterOverrides };
}

export function applySingleDescriptorGuidance(
    descriptor: PluginDescriptor,
    declaration: DescriptorGuidanceDeclaration
): PluginDescriptor {
    const guidedDescriptor = applyDescriptorGuidance([descriptor], [declaration])[0];
    if (!guidedDescriptor) {
        throw new Error(`Guidance application returned no descriptor for ${descriptor.id}`);
    }
    return guidedDescriptor;
}

export function parameterGuidance(
    semanticRole: string,
    perceptualRole: string,
    minimum: number,
    maximum: number,
    interactions: readonly string[],
    risks: readonly string[],
    modulation: DeviceParameterGuidance['modulation']
): DeviceParameterGuidance {
    return { semanticRole, perceptualRole, typicalRange: { minimum, maximum }, interactions, risks, modulation };
}
