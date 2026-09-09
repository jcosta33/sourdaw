import { getSidechainTargetCapability } from '#/utils/getSidechainTargetCapability';

import { type ProjectContext } from '../../models/ProjectContext';
import { type LlmActionRejection } from '../llmActionBridgeContracts';

export type ExecutableTrackKind = 'audio' | 'midi' | 'folder';

const executableTrackKinds: ReadonlySet<string> = new Set(['audio', 'midi', 'folder']);

export function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
    const actualKeys = Object.keys(value);
    if (actualKeys.length !== expectedKeys.length) {
        return false;
    }
    return expectedKeys.every((key) => Object.hasOwn(value, key));
}

export function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function isExecutableTrackKind(value: unknown): value is ExecutableTrackKind {
    return typeof value === 'string' && executableTrackKinds.has(value);
}

export function isValidParameterValue(
    parameter: NonNullable<ProjectContext['tracks'][number]['devices'][number]['parameters']>[number],
    value: number
): boolean {
    if (value < parameter.minValue || value > parameter.maxValue) {
        return false;
    }
    // A range is not a list of settings. `crust/oversampling` spans 1..32 and
    // has six settings; a model asking for 9 is asking for a position the
    // cascade does not build, and passing it would have the engine resolve it
    // to 8 while the model was told 9 landed.
    if (parameter.legalValues && !parameter.legalValues.includes(value)) {
        return false;
    }
    if (parameter.type === 'bool') {
        return value === 0 || value === 1;
    }
    if (parameter.type === 'int') {
        return Number.isInteger(value);
    }
    if (parameter.type === 'choice') {
        if (!Number.isInteger(value)) {
            return false;
        }
        return parameter.choices ? value >= 0 && value < parameter.choices.length : true;
    }
    return true;
}

export function hasTrack(context: ProjectContext, trackId: unknown): trackId is string {
    return typeof trackId === 'string' && context.tracks.some((track) => track.id === trackId);
}

export function findTrack(context: ProjectContext, trackId: unknown) {
    if (typeof trackId !== 'string') {
        return undefined;
    }
    return context.tracks.find((track) => track.id === trackId);
}

export function findSend(context: ProjectContext, trackId: unknown, busId: unknown) {
    const source = findTrack(context, trackId);
    if (!source || typeof busId !== 'string') {
        return undefined;
    }
    return source.sends?.find((send) => send.busId === busId);
}

export function findSidechainRoutes(context: ProjectContext, sourceTrackId: string, targetTrackId: string) {
    return (context.sidechainRoutes ?? []).filter(
        (route) => route.sourceTrackId === sourceTrackId && route.targetTrackId === targetTrackId
    );
}

export function findSupportedSidechainDevices(target: ProjectContext['tracks'][number]) {
    return target.devices.filter((device) => getSidechainTargetCapability(device.type) !== null);
}

export function findDeviceTarget(context: ProjectContext, deviceId: unknown) {
    if (typeof deviceId !== 'string') {
        return undefined;
    }
    for (const track of context.tracks) {
        const device = track.devices.find((candidate) => candidate.id === deviceId);
        if (device) {
            return { device, track };
        }
    }
    return undefined;
}

export function findDevice(context: ProjectContext, deviceId: unknown) {
    return findDeviceTarget(context, deviceId)?.device;
}

export function findAvailableDeviceType(context: ProjectContext, assertedType: unknown) {
    if (typeof assertedType !== 'string') {
        return undefined;
    }
    const normalized = assertedType.toLocaleLowerCase();
    const matches = (context.availableDeviceTypes ?? []).filter(
        (deviceType) =>
            deviceType.id.toLocaleLowerCase() === normalized || deviceType.name.toLocaleLowerCase() === normalized
    );
    return matches.length === 1 ? matches[0] : undefined;
}

export function findProviderOutputTarget(context: ProjectContext, outputId: unknown) {
    if (typeof outputId !== 'string') {
        return undefined;
    }
    return context.tracks.find((track) => track.id === outputId && (track.kind === 'bus' || track.kind === 'master'));
}

export function isProviderRoutableSource(
    track: ProjectContext['tracks'][number] | undefined
): track is ProjectContext['tracks'][number] {
    return track?.kind === 'audio' || track?.kind === 'midi' || track?.kind === 'bus';
}

export function isSafeTrackColor(value: unknown): value is string {
    return typeof value === 'string' && /^#[\dA-Fa-f]{6}$/.test(value);
}

export function rejection(index: number, name: string, reason: string): LlmActionRejection {
    return { index, name, reason };
}
