import { type ProjectContextDeviceParameter } from '../models/ProjectContext';

type DescriptorParameter = Omit<ProjectContextDeviceParameter, 'legalValues' | 'value'> & {
    defaultValue: number;
    legalSet?: { values: readonly number[] };
};

/**
 * Projects the descriptor's write contract without importing Arrangement's private model types.
 * Passing values projects an existing instance; omitting them projects a newly created instance.
 */
export function projectDeviceDescriptorParameters(
    parameters: readonly DescriptorParameter[],
    values?: Readonly<Record<string, number>>
): ProjectContextDeviceParameter[] {
    return parameters.flatMap((parameter) => {
        const value = values === undefined ? parameter.defaultValue : values[parameter.id];
        if (
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            !Number.isFinite(parameter.minValue) ||
            !Number.isFinite(parameter.maxValue)
        ) {
            return [];
        }
        return [
            {
                id: parameter.id,
                name: parameter.name,
                type: parameter.type,
                value,
                minValue: parameter.minValue,
                maxValue: parameter.maxValue,
                unit: parameter.unit,
                ...(parameter.legalSet ? { legalValues: [...parameter.legalSet.values] } : {}),
                ...(parameter.choices ? { choices: [...parameter.choices] } : {}),
            },
        ];
    });
}
