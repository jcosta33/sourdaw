import { type AppAction, type ExecuteOptions } from '#/utils/handlerContract';
import { generateSeed } from '#/utils/SeededRandom/SeededRandom';

import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

import { commandProjectRevisionPort } from './commandProjectRevisionPort';
import { createVersionedCommandEnvelope } from './createVersionedCommandEnvelope';

type CreateExecutionCommandEnvelopeInput = {
    action: AppAction;
    dependencyIds?: readonly string[];
    expectedEffect: string;
    normalizedProjectRevision?: string;
    options?: ExecuteOptions;
};

const STOCHASTIC_OPERATION_TYPES = new Set<AppAction['type']>([
    'generateChordProgression',
    'generateDrumPattern',
    'generateMelody',
    'humanizeNotes',
]);

function materializeSeed(action: AppAction): { action: AppAction; seed?: number } {
    if (!STOCHASTIC_OPERATION_TYPES.has(action.type)) {
        return { action };
    }
    if (
        action.type !== 'generateChordProgression' &&
        action.type !== 'generateDrumPattern' &&
        action.type !== 'generateMelody' &&
        action.type !== 'humanizeNotes'
    ) {
        return { action };
    }
    if (action.payload.seed !== undefined) {
        return { action, seed: action.payload.seed };
    }
    const cloned = structuredClone(action);
    const seed = generateSeed();
    cloned.payload.seed = seed;
    return { action: cloned, seed };
}

function getPayloadRecord(action: AppAction): object {
    if (!('payload' in action)) {
        return {};
    }
    const payload: unknown = action.payload;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return {};
    }
    return payload;
}

function inferObjectReferences(action: AppAction) {
    const references: Array<{ argument: string; id: string; scope: 'stable' | 'batch-local' }> = [];
    for (const [argument, value] of Object.entries(getPayloadRecord(action))) {
        if (argument.endsWith('Id') && typeof value === 'string' && value.length > 0) {
            references.push({
                argument,
                id: value,
                scope: value.startsWith('$') ? 'batch-local' : 'stable',
            });
        }
        if (argument.endsWith('Ids') && Array.isArray(value)) {
            for (const id of value) {
                if (typeof id === 'string' && id.length > 0) {
                    references.push({
                        argument,
                        id,
                        scope: id.startsWith('$') ? 'batch-local' : 'stable',
                    });
                }
            }
        }
    }
    return references;
}

function inferTime(action: AppAction) {
    const time: Array<{
        argument: string;
        domain: 'musical' | 'absolute';
        unit: 'beats' | 'seconds' | 'milliseconds' | 'samples';
        value: number;
    }> = [];
    for (const [argument, value] of Object.entries(getPayloadRecord(action))) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            continue;
        }
        if (/beat/i.test(argument)) {
            time.push({ argument, domain: 'musical', unit: 'beats', value });
            continue;
        }
        if (/milliseconds|Ms$/.test(argument)) {
            time.push({ argument, domain: 'absolute', unit: 'milliseconds', value });
            continue;
        }
        if (/seconds|Seconds$/.test(argument)) {
            time.push({ argument, domain: 'absolute', unit: 'seconds', value });
            continue;
        }
        if (/samples|Samples$/.test(argument)) {
            time.push({ argument, domain: 'absolute', unit: 'samples', value });
        }
    }
    return time;
}

function getUnit(argument: string): string {
    if (/beat/i.test(argument)) {
        return 'beats';
    }
    if (/gain|level/i.test(argument)) {
        return 'linear-gain';
    }
    if (/pan/i.test(argument)) {
        return 'pan-percent';
    }
    if (/bpm|tempo/i.test(argument)) {
        return 'beats-per-minute';
    }
    if (/milliseconds|Ms$/.test(argument)) {
        return 'milliseconds';
    }
    if (/seconds|Seconds$/.test(argument)) {
        return 'seconds';
    }
    if (/semitone/i.test(argument)) {
        return 'semitones';
    }
    if (/cent/i.test(argument)) {
        return 'cents';
    }
    if (/percent/i.test(argument)) {
        return 'percent';
    }
    return 'unitless';
}

function inferParameterUnits(action: AppAction) {
    return Object.entries(getPayloadRecord(action))
        .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
        .map(([argument]) => ({ argument, unit: getUnit(argument) }));
}

function inferAvailableDeviceVersions(action: AppAction): Readonly<Record<string, string>> {
    const versions: Record<string, string> = {};
    for (const [argument, value] of Object.entries(getPayloadRecord(action))) {
        if ((argument === 'deviceType' || argument === 'expectedDeviceType') && typeof value === 'string') {
            versions[value] = 'unversioned';
        }
    }
    return versions;
}

export function createExecutionCommandEnvelope(input: CreateExecutionCommandEnvelopeInput): {
    action: AppAction;
    envelope: VersionedCommandEnvelope;
} {
    const materialized = materializeSeed(input.action);
    const source = input.options?.source ?? 'manual';
    const envelope = createVersionedCommandEnvelope({
        action: materialized.action,
        availableDeviceVersions: inferAvailableDeviceVersions(materialized.action),
        dependencyIds: input.dependencyIds,
        expectedEffect: input.expectedEffect,
        groupId: input.options?.groupId,
        normalizedProjectRevision: input.normalizedProjectRevision ?? commandProjectRevisionPort.capture(),
        objectReferences: inferObjectReferences(materialized.action),
        parameterUnits: inferParameterUnits(materialized.action),
        reason: `Execute ${materialized.action.type} from ${source}`,
        seed: materialized.seed,
        time: inferTime(materialized.action),
    });
    return { action: materialized.action, envelope };
}
