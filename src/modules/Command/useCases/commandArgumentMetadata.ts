import { normalizeDeviceParameterValueUnit } from '#/utils/deviceParameterValueUnit';

import {
    type CommandObjectReference,
    type CommandParameterUnit,
    type CommandTimeReference,
} from '../models/VersionedCommandEnvelope';

import { collectCommandIdReferences } from './collectCommandIdReferences';

type CommandArgumentMetadata = {
    objectReferences: CommandObjectReference[];
    parameterUnits: CommandParameterUnit[];
    time: CommandTimeReference[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getLeafName(path: string): string {
    const withoutIndexes = path.replaceAll(/\[\d+\]/g, '');
    return withoutIndexes.split('.').at(-1) ?? withoutIndexes;
}

function getUnit(argument: string): string {
    const leaf = getLeafName(argument);
    if (/beat/i.test(leaf)) {
        return 'beats';
    }
    if (/gain|level/i.test(leaf)) {
        return 'linear-gain';
    }
    if (/pan/i.test(leaf)) {
        return 'pan-percent';
    }
    if (/bpm|tempo/i.test(leaf)) {
        return 'beats-per-minute';
    }
    if (/milliseconds|Ms$/.test(leaf)) {
        return 'milliseconds';
    }
    if (/seconds|Seconds$/.test(leaf)) {
        return 'seconds';
    }
    if (/samples|Samples$/.test(leaf)) {
        return 'samples';
    }
    if (/semitone/i.test(leaf)) {
        return 'semitones';
    }
    if (/cent/i.test(leaf)) {
        return 'cents';
    }
    if (/percent/i.test(leaf)) {
        return 'percent';
    }
    return 'unitless';
}

function getTimeReference(argument: string, value: number): CommandTimeReference | null {
    const leaf = getLeafName(argument);
    if (/beat/i.test(leaf)) {
        return { argument, domain: 'musical', unit: 'beats', value };
    }
    if (/milliseconds|Ms$/.test(leaf)) {
        return { argument, domain: 'absolute', unit: 'milliseconds', value };
    }
    if (/seconds|Seconds$/.test(leaf)) {
        return { argument, domain: 'absolute', unit: 'seconds', value };
    }
    if (/samples|Samples$/.test(leaf)) {
        return { argument, domain: 'absolute', unit: 'samples', value };
    }
    return null;
}

/**
 * A parameter id names a control on a track or device (`gain`, `pan`, a device parameter, or
 * `<deviceId>:<paramId>`), not a project object, so a batch preflight has nothing to find under it.
 * Bare `paramId` stays a reference: setDeviceParameter declares it a device-parameter target, which
 * the preflight resolves against the device's parameter values.
 */
function namesParameter(argument: string): boolean {
    return /^(?:parameter|[a-z]\w*Param(?:eter)?)Ids?$/.test(getLeafName(argument));
}

function appendValueMetadata(metadata: CommandArgumentMetadata, value: unknown, path: string): void {
    if (Array.isArray(value)) {
        for (const [index, item] of value.entries()) {
            appendValueMetadata(metadata, item, `${path}[${String(index)}]`);
        }
        return;
    }
    if (isRecord(value)) {
        for (const [key, item] of Object.entries(value)) {
            appendValueMetadata(metadata, item, path === '' ? key : `${path}.${key}`);
        }
        return;
    }
    const leaf = getLeafName(path);
    if (typeof value === 'number' && Number.isFinite(value) && leaf !== 'seed') {
        metadata.parameterUnits.push({ argument: path, unit: getUnit(path) });
        const timeReference = getTimeReference(path, value);
        if (timeReference) {
            metadata.time.push(timeReference);
        }
    }
}

export function isCompSourceSupportPath(operation: string | undefined, path: string): boolean {
    if (operation !== 'setCompRegion' && operation !== 'removeCompRegion' && operation !== 'restoreCompRegionInterval')
        return false;
    return (
        path.startsWith('audioSourcePromotions[') || /^(expected|replacement)\[\d+\]\.audioSource(?:\.|$)/.test(path)
    );
}

export function compileCommandArgumentMetadata(
    argumentsValue: Readonly<Record<string, unknown>>,
    operation?: string
): CommandArgumentMetadata {
    const metadata: CommandArgumentMetadata = {
        objectReferences: collectCommandIdReferences(argumentsValue).filter(
            (reference) => !namesParameter(reference.argument)
        ),
        parameterUnits: [],
        time: [],
    };
    appendValueMetadata(metadata, argumentsValue, '');
    if (operation === 'setDeviceParameter' && typeof argumentsValue.value === 'number') {
        const valueUnit = normalizeDeviceParameterValueUnit(argumentsValue.valueUnit);
        if (valueUnit !== null) {
            const valueMetadata = metadata.parameterUnits.find((entry) => entry.argument === 'value');
            if (valueMetadata) {
                valueMetadata.unit = valueUnit;
            }
        }
    }
    // Source preservation on complements is derived support. Its owner still
    // validates every value; it does not expand the musician's requested scope.
    return {
        objectReferences: metadata.objectReferences.filter(
            (reference) => !isCompSourceSupportPath(operation, reference.argument)
        ),
        parameterUnits: metadata.parameterUnits.filter(
            (parameter) => !isCompSourceSupportPath(operation, parameter.argument)
        ),
        time: metadata.time.filter((time) => !isCompSourceSupportPath(operation, time.argument)),
    };
}
