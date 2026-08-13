import {
    type CommandObjectReference,
    type CommandParameterUnit,
    type CommandTimeReference,
} from '../models/VersionedCommandEnvelope';

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
    if (typeof value === 'string' && value !== '' && (leaf === 'id' || leaf.endsWith('Id') || leaf.endsWith('Ids'))) {
        metadata.objectReferences.push({
            argument: path,
            id: value,
            scope: value.startsWith('$') ? 'batch-local' : 'stable',
        });
    }
    if (typeof value === 'number' && Number.isFinite(value) && leaf !== 'seed') {
        metadata.parameterUnits.push({ argument: path, unit: getUnit(path) });
        const timeReference = getTimeReference(path, value);
        if (timeReference) {
            metadata.time.push(timeReference);
        }
    }
}

export function compileCommandArgumentMetadata(
    argumentsValue: Readonly<Record<string, unknown>>
): CommandArgumentMetadata {
    const metadata: CommandArgumentMetadata = {
        objectReferences: [],
        parameterUnits: [],
        time: [],
    };
    appendValueMetadata(metadata, argumentsValue, '');
    return metadata;
}
