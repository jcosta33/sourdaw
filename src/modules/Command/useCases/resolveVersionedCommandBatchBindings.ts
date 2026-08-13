import { type VersionedCommandBatchEnvelope } from '../models/VersionedCommandBatchEnvelope';
import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

import { compileCommandArgumentMetadata } from './commandArgumentMetadata';
import { getVersionedCommandArgumentsDigest } from './getVersionedCommandArgumentsDigest';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function setArgumentPathValue(argumentsValue: Record<string, unknown>, path: string, value: string): void {
    const parts = path.split('.');
    let current: unknown = argumentsValue;
    for (const [partIndex, part] of parts.entries()) {
        const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?$/.exec(part);
        if (!match || !isRecord(current)) {
            return;
        }
        const key = match[1]!;
        const arrayIndex = match[2] === undefined ? undefined : Number(match[2]);
        const isLast = partIndex === parts.length - 1;
        if (arrayIndex === undefined) {
            if (isLast) {
                current[key] = value;
                return;
            }
            current = current[key];
            continue;
        }
        const array = current[key];
        if (!Array.isArray(array)) {
            return;
        }
        if (isLast) {
            array[arrayIndex] = value;
            return;
        }
        current = array[arrayIndex];
    }
}

function resolveCommand(
    command: VersionedCommandEnvelope,
    bindings: ReadonlyMap<string, string>
): VersionedCommandEnvelope {
    const argumentsValue = structuredClone(command.arguments);
    for (const reference of command.objectReferences) {
        if (reference.scope !== 'batch-local') {
            continue;
        }
        const boundValue = bindings.get(reference.id);
        if (boundValue) {
            setArgumentPathValue(argumentsValue, reference.argument, boundValue);
        }
    }
    const metadata = compileCommandArgumentMetadata(argumentsValue);
    return {
        ...command,
        arguments: argumentsValue,
        argumentsDigest: getVersionedCommandArgumentsDigest({
            operation: command.operation,
            arguments: argumentsValue,
        }),
        objectReferences: metadata.objectReferences,
        parameterUnits: metadata.parameterUnits,
        time: metadata.time,
    };
}

export function resolveVersionedCommandBatchBindings(
    envelope: VersionedCommandBatchEnvelope
): readonly VersionedCommandEnvelope[] {
    const commandsById = new Map(envelope.commands.map((command) => [command.commandId, command]));
    const bindings = new Map<string, string>();
    for (const binding of envelope.batchLocalBindings) {
        const producer = commandsById.get(binding.producerCommandId);
        const assigned = producer?.applicationAssignedIds.find(
            (candidate) => candidate.argument === binding.producerArgument
        );
        if (assigned) {
            bindings.set(binding.bindingId, assigned.value);
        }
    }
    return envelope.commands.map((command) => resolveCommand(command, bindings));
}
