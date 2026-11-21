import { type LevelArgument, type LevelLaw, resolveLevelArgument } from '#/utils/audioLevelLaw';
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

/** The argument names one control offers for its level, in each form it takes. */
export type LevelArgumentKeys = {
    linear: string;
    absolute: string;
    /** Omitted by a control with nothing to move from. */
    relative?: string;
};

export type LevelArgumentReading = {
    argument: LevelArgument;
    /** The single key the call stated, so the caller's exact-key check stays exact. */
    statedKey: string;
};

function toLevelArgument(statedKey: string, value: number, keys: LevelArgumentKeys): LevelArgument {
    if (statedKey === keys.linear) {
        return { linear: value };
    }
    if (statedKey === keys.absolute) {
        return { absoluteDb: value };
    }
    return { deltaDb: value };
}

/**
 * The one level form a call states, or `null` when it states none, several, or
 * a value that is not a finite number.
 *
 * Several forms at once is a contradiction rather than a preference: "-6 dB"
 * and "0.8" name different levels, and a caller that had to pick one for the
 * provider would be guessing which the request meant.
 */
export function readLevelArgument(args: Record<string, unknown>, keys: LevelArgumentKeys): LevelArgumentReading | null {
    const candidateKeys = [keys.linear, keys.absolute];
    if (keys.relative !== undefined) {
        candidateKeys.push(keys.relative);
    }
    const statedKeys = candidateKeys.filter((key) => Object.hasOwn(args, key));
    const statedKey = statedKeys[0];
    if (statedKeys.length !== 1 || statedKey === undefined) {
        return null;
    }
    const value = args[statedKey];
    if (!isFiniteNumber(value)) {
        return null;
    }
    return { argument: toLevelArgument(statedKey, value, keys), statedKey };
}

/**
 * The linear amplitude a stated level lands on, or `null` when the control
 * cannot honour it.
 *
 * The linear form is judged against the range the store already holds, so a
 * caller routed through here writes exactly what it wrote before; the decibel
 * forms are judged by the law, which is the only thing that knows what a
 * decibel means on this control. A relative form needs somewhere to start, so a
 * control with no current level refuses it rather than assuming unity.
 */
function resolveLevelReading(
    reading: LevelArgumentReading,
    current: number | undefined,
    law: LevelLaw,
    linearBounds: { min: number; max: number }
): number | null {
    if ('linear' in reading.argument) {
        const { linear } = reading.argument;
        return linear >= linearBounds.min && linear <= linearBounds.max ? linear : null;
    }
    if ('deltaDb' in reading.argument && current === undefined) {
        return null;
    }
    const resolution = resolveLevelArgument(reading.argument, current ?? law.unity, law);
    return resolution.ok ? resolution.linear : null;
}

/** One control's level: the form the request stated, and where it lands. */
export type ResolvedLevelArgument = LevelArgumentReading & { linear: number };

/**
 * The level a call states on one control, once that control has agreed it can
 * hold it. A caller that gets one back still has to check the rest of the call:
 * this answers only what the level is and whether it fits.
 */
export function readResolvedLevelArgument(
    args: Record<string, unknown>,
    keys: LevelArgumentKeys,
    control: { current: number | undefined; law: LevelLaw; linearBounds: { min: number; max: number } }
): ResolvedLevelArgument | null {
    const reading = readLevelArgument(args, keys);
    if (reading === null) {
        return null;
    }
    const linear = resolveLevelReading(reading, control.current, control.law, control.linearBounds);
    if (linear === null) {
        return null;
    }
    return { ...reading, linear };
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

export function findClip(context: ProjectContext, clipId: unknown) {
    if (typeof clipId !== 'string') {
        return undefined;
    }
    for (const track of context.tracks) {
        const clip = track.clips.find((candidate) => candidate.id === clipId);
        if (clip) {
            return { clip, track };
        }
    }
    return undefined;
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

export function normalizeMarkerName(name: string): string {
    return name.trim().toLocaleLowerCase();
}

export function rejection(index: number, name: string, reason: string): LlmActionRejection {
    return { index, name, reason };
}
