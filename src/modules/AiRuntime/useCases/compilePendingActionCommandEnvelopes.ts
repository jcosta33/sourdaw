import {
    migrateLegacyAppActionToVersionedCommandEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type ActionCommandGraph } from '../models/ActionCommandGraph';

type CompilePendingActionCommandEnvelopesInput = {
    actionCommandGraph?: ActionCommandGraph;
    actions: readonly AppAction[];
    actionLabels: readonly string[];
    group: { groupId: string; groupLabel: string };
    projectRevision: string;
};

type DeviceProducer = { actionIndex: number; trackId: string };

function getStructuralDeviceDependencyIndexes(
    action: AppAction,
    deviceProducers: ReadonlyMap<string, DeviceProducer>
): number[] {
    if (action.type !== 'addDevice' && action.type !== 'setDeviceParameter') {
        return [];
    }
    const expectedDeviceIds = action.payload.expectedDeviceIds;
    if (expectedDeviceIds === undefined) {
        return [];
    }
    const trackId =
        action.type === 'addDevice'
            ? action.payload.trackId
            : (action.payload.expectedTrackId ?? deviceProducers.get(action.payload.deviceId)?.trackId);
    if (trackId === undefined) {
        return [];
    }
    return expectedDeviceIds.flatMap((deviceId) => {
        const producer = deviceProducers.get(deviceId);
        return producer?.trackId === trackId ? [producer.actionIndex] : [];
    });
}

function indexProducedDevice(
    envelope: ReturnType<typeof migrateLegacyAppActionToVersionedCommandEnvelope>,
    actionIndex: number,
    deviceProducers: Map<string, DeviceProducer>
): void {
    const producerArgument = envelope.operation === 'addTrack' ? 'initialDeviceId' : 'deviceId';
    if (
        (envelope.operation !== 'addTrack' && envelope.operation !== 'addDevice') ||
        (envelope.operation === 'addTrack' && envelope.arguments.kind !== 'midi')
    ) {
        return;
    }
    const producedDeviceId = envelope.applicationAssignedIds.find(
        (assignedId) => assignedId.argument === producerArgument
    )?.value;
    const trackId = envelope.operation === 'addTrack' ? envelope.arguments.id : envelope.arguments.trackId;
    if (producedDeviceId === undefined || typeof trackId !== 'string') {
        return;
    }
    deviceProducers.set(producedDeviceId, { actionIndex, trackId });
}

export function compilePendingActionCommandEnvelopes(input: CompilePendingActionCommandEnvelopesInput): string[] {
    if (
        input.actionCommandGraph !== undefined &&
        input.actionCommandGraph.dependenciesByActionIndex.length !== input.actions.length
    ) {
        throw new Error('Action command graph does not exactly match the action batch');
    }
    const commandIds: string[] = [];
    const deviceProducers = new Map<string, DeviceProducer>();
    return input.actions.map((action, index) => {
        const declaredDependencyIndexes = input.actionCommandGraph?.dependenciesByActionIndex[index] ?? [];
        if (
            new Set(declaredDependencyIndexes).size !== declaredDependencyIndexes.length ||
            declaredDependencyIndexes.some(
                (dependencyIndex) =>
                    !Number.isSafeInteger(dependencyIndex) || dependencyIndex < 0 || dependencyIndex >= index
            )
        ) {
            throw new Error('Action command graph contains an invalid or out-of-order dependency');
        }
        const dependencyIndexes = [...declaredDependencyIndexes];
        for (const structuralDependencyIndex of getStructuralDeviceDependencyIndexes(action, deviceProducers)) {
            if (!dependencyIndexes.includes(structuralDependencyIndex)) {
                dependencyIndexes.push(structuralDependencyIndex);
            }
        }
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            dependencyIds: dependencyIndexes.map((dependencyIndex) => commandIds[dependencyIndex]!),
            expectedEffect: input.actionLabels[index] ?? action.type,
            normalizedProjectRevision: input.projectRevision,
            options: { ...input.group, source: 'prompt' },
        });
        commandIds.push(envelope.commandId);
        indexProducedDevice(envelope, index, deviceProducers);
        return serializeVersionedCommandEnvelope(envelope);
    });
}
