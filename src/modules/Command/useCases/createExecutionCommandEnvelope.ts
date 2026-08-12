import { type AppAction, type ExecuteOptions } from '#/utils/handlerContract';
import { generateSeed } from '#/utils/SeededRandom/SeededRandom';

import { type CommandApplicationAssignedId, type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

import { compileCommandArgumentMetadata } from './commandArgumentMetadata';
import { commandDeviceVersionsPort } from './commandDeviceVersionsPort';
import { commandProjectRevisionPort } from './commandProjectRevisionPort';
import { createVersionedCommandEnvelope } from './createVersionedCommandEnvelope';
import { getCommandDeviceTypes } from './getCommandDeviceTypes';
import { materializeCommandApplicationIds } from './materializeCommandApplicationIds';

type CreateExecutionCommandEnvelopeInput = {
    action: AppAction;
    applicationAssignedIds?: readonly CommandApplicationAssignedId[];
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPayloadRecord(action: AppAction): Readonly<Record<string, unknown>> {
    if (!('payload' in action) || !isRecord(action.payload)) {
        return {};
    }
    return action.payload;
}

export function createExecutionCommandEnvelope(input: CreateExecutionCommandEnvelopeInput): {
    action: AppAction;
    envelope: VersionedCommandEnvelope;
} {
    const identityMaterialized = input.applicationAssignedIds
        ? { action: input.action, applicationAssignedIds: input.applicationAssignedIds }
        : materializeCommandApplicationIds(input.action);
    const materialized = materializeSeed(identityMaterialized.action);
    const source = input.options?.source ?? 'manual';
    const argumentsValue = getPayloadRecord(materialized.action);
    const metadata = compileCommandArgumentMetadata(argumentsValue);
    const envelope = createVersionedCommandEnvelope({
        action: materialized.action,
        applicationAssignedIds: identityMaterialized.applicationAssignedIds,
        availableDeviceVersions: commandDeviceVersionsPort.capture(getCommandDeviceTypes(argumentsValue)),
        dependencyIds: input.dependencyIds,
        expectedEffect: input.expectedEffect,
        groupId: input.options?.groupId,
        normalizedProjectRevision: input.normalizedProjectRevision ?? commandProjectRevisionPort.capture(),
        objectReferences: metadata.objectReferences,
        parameterUnits: metadata.parameterUnits,
        reason: `Execute ${materialized.action.type} from ${source}`,
        seed: materialized.seed,
        time: metadata.time,
    });
    return { action: materialized.action, envelope };
}
