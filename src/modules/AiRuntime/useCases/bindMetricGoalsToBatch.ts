import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';

import { type MetricNativeLiteralUse } from '../models/MetricGoalAdmission';

import { digestCommandBatchContent } from './digestCommandBatchContent';
import { getExactAgentActionHash } from './getExactAgentActionHash';
import { type MetricGoalState } from './metricGoalContractTypes';

type Envelope = Extract<ReturnType<typeof parseVersionedCommandBatchEnvelope>, { status: 'valid' }>['envelope'];

/** The actual created owner and parameter must retain the producer's exact materialized identities. */
export function readNativeLiteralCommandBinding(
    use: MetricNativeLiteralUse,
    envelope: Envelope,
    schedulePosition: number | null
): MetricNativeLiteralUse['binding'] {
    const owner = envelope.commands[use.ownerActionIndex];
    const device = envelope.commands[use.deviceActionIndex];
    const command = envelope.commands[use.actionIndex];
    if (!nativeLiteralArgumentsMatch(use, owner, device, command)) {
        return null;
    }
    if (
        !owner!.applicationAssignedIds.some((entry) => entry.argument === 'busId' && entry.value === use.ownerId) ||
        !device!.applicationAssignedIds.some(
            (entry) => entry.argument === 'deviceId' && entry.value === use.deviceId
        ) ||
        !command!.parameterUnits.some((entry) => entry.argument === 'value' && entry.unit === use.unit) ||
        !nativeLiteralPayloadsMatch(use, owner!, device!, command!)
    ) {
        return null;
    }
    return {
        contentHash: digestCommandBatchContent(envelope),
        projectId: envelope.projectId,
        revision: envelope.baseRevision,
        runId: envelope.runId,
        batchId: envelope.batchId,
        commandId: command!.commandId,
        ownerCommandId: owner!.commandId,
        deviceCommandId: device!.commandId,
        schedulePosition,
    };
}

function nativeLiteralArgumentsMatch(
    use: MetricNativeLiteralUse,
    owner: Envelope['commands'][number] | undefined,
    device: Envelope['commands'][number] | undefined,
    command: Envelope['commands'][number] | undefined
): boolean {
    if (
        owner?.operation !== 'createBus' ||
        device?.operation !== 'addDevice' ||
        command?.operation !== 'setDeviceParameter' ||
        use.ownerActionIndex >= use.deviceActionIndex ||
        use.deviceActionIndex >= use.actionIndex
    ) {
        return false;
    }
    return (
        owner.arguments.busId === use.ownerId &&
        device.arguments.trackId === use.ownerId &&
        device.arguments.deviceId === use.deviceId &&
        device.arguments.deviceType === use.deviceType &&
        command.arguments.deviceId === use.deviceId &&
        command.arguments.expectedTrackId === use.ownerId &&
        command.arguments.expectedDeviceType === use.deviceType &&
        command.arguments.paramId === use.paramId &&
        command.arguments.value === use.value &&
        command.arguments.valueUnit === use.unit
    );
}

/** Only Command's known bus defaults may extend the accepted producer payload. */
function nativeLiteralPayloadsMatch(
    use: MetricNativeLiteralUse,
    owner: Envelope['commands'][number],
    device: Envelope['commands'][number],
    command: Envelope['commands'][number]
): boolean {
    const { initialAlternativeId, color, ...producerArguments } = owner.arguments;
    if (
        typeof initialAlternativeId !== 'string' ||
        initialAlternativeId.length === 0 ||
        (color !== undefined && typeof color !== 'string') ||
        !owner.applicationAssignedIds.some(
            (entry) => entry.argument === 'initialAlternativeId' && entry.value === initialAlternativeId
        )
    ) {
        return false;
    }
    return (
        getExactAgentActionHash({ operation: owner.operation, arguments: producerArguments }) === use.ownerActionHash &&
        getExactAgentActionHash({ operation: device.operation, arguments: device.arguments }) ===
            use.deviceActionHash &&
        getExactAgentActionHash({ operation: command.operation, arguments: command.arguments }) === use.actionHash
    );
}

/** Rebinding never deletes intent. A changed/subset batch must earn fresh compatible proof. */
export function bindMetricGoalsToBatch(input: {
    state: MetricGoalState | null | undefined;
    commandBatch: { serialized: string; authority: Parameters<typeof parseVersionedCommandBatchEnvelope>[1] };
    schedulePosition?: number;
}): MetricGoalState {
    const parsed = parseVersionedCommandBatchEnvelope(input.commandBatch.serialized, input.commandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new TypeError(parsed.reason);
    }
    const envelope = parsed.envelope;
    const original = input.state ?? { schemaVersion: 1, authorities: [], steps: [], proofs: [], binding: null };
    const schedulePosition = input.schedulePosition ?? original.binding?.schedulePosition ?? null;
    const advancesSchedule = original.binding !== null && original.binding.schedulePosition !== schedulePosition;
    const prefixes: NonNullable<MetricGoalState['binding']>['prefixes'][number][] = [];
    let offset = 0;
    let before: string | null = null;
    let complete = original.steps.length > 0;
    for (const step of original.steps) {
        const slice = envelope.commands.slice(offset, offset + step.commandCount);
        if (
            (step.stepId !== 'overall' && step.recipePrefixHash === null) ||
            slice.length !== step.commandCount ||
            slice.some((command, index) => command.operation !== step.operationTypes[index])
        ) {
            complete = false;
            break;
        }
        offset += step.commandCount;
        const commands = envelope.commands.slice(0, offset);
        const ids = new Set(commands.map((command) => command.commandId));
        const after = digestCommandBatchContent({
            ...envelope,
            commands,
            batchLocalBindings: envelope.batchLocalBindings.filter((binding) => ids.has(binding.producerCommandId)),
        });
        if (step.recipePrefixHash !== null && step.recipePrefixHash !== after) {
            complete = false;
            break;
        }
        prefixes.push({ stepId: step.stepId, before, after });
        before = after;
    }
    if (offset !== envelope.commands.length || !complete) {
        prefixes.length = 0;
    }
    return {
        ...structuredClone(original),
        nativeLiteralUses: original.nativeLiteralUses?.map((use) => ({
            ...structuredClone(use),
            binding: use.binding ?? readNativeLiteralCommandBinding(use, envelope, schedulePosition),
        })),
        proofs: advancesSchedule ? [] : structuredClone(original.proofs),
        binding: {
            contentHash: digestCommandBatchContent(envelope),
            revision: envelope.baseRevision,
            projectId: envelope.projectId,
            runId: envelope.runId,
            batchId: envelope.batchId,
            schedulePosition,
            prefixes,
        },
    };
}
