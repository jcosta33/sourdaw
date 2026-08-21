import { getPluginById } from '#/modules/Arrangement/useCases';

import {
    type ProjectContext,
    type ProjectContextDevice,
    type ProjectContextDeviceParameter,
    type ProjectContextTrack,
} from '../../models/ProjectContext';
import {
    type SharedVocalFxBusesCapability,
    type SharedVocalFxEffectGroup,
} from '../../models/SharedVocalFxBusesCapability';

const EFFECT_CONFIG = {
    delay: {
        binding: 'vocal-delay',
        busName: 'Vocal Delay',
        deviceType: 'builtin-delay',
        mixParameterId: 'delay-mix',
    },
    reverb: {
        binding: 'vocal-reverb',
        busName: 'Vocal Reverb',
        deviceType: 'builtin-reverb',
        mixParameterId: 'rev-mix',
    },
} as const;

type EffectKind = keyof typeof EFFECT_CONFIG;

type EffectSource = {
    track: ProjectContextTrack;
    device: ProjectContextDevice;
    parameters: ProjectContextDeviceParameter[];
};

export type SharedVocalFxBusesPromptScope =
    | { status: 'invalid'; reason: string }
    | {
          status: 'request';
          capability: SharedVocalFxBusesCapability;
          protectedObjects: Array<{ id: string; name: string }>;
      };

function normalizeText(value: string): string {
    return value
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function isVocalTrack(track: ProjectContextTrack): boolean {
    if (track.kind !== 'audio' && track.kind !== 'midi') {
        return false;
    }
    const name = normalizeText(track.name);
    return /^(?:(?:(?:lead|main|backing|background|bg|harmony|stacked|double|doubled) )?(?:vocal|vocals|vox)(?: (?:lead|main|backing|background|bg|harmony|high|low|mid|left|right|l|r|double|doubled|stack|stacked|[0-9]+))*|(?:bgv|bvs?|bv)(?: (?:high|low|mid|left|right|l|r|double|doubled|[0-9]+))*)$/u.test(
        name
    );
}

function isVocalLikeTrack(track: ProjectContextTrack): boolean {
    if (track.kind !== 'audio' && track.kind !== 'midi') {
        return false;
    }
    return /\b(?:vocal|vocals|vox|bgv|bvs?|bv)\b/u.test(normalizeText(track.name));
}

function classifySupportedEffect(device: ProjectContextDevice): EffectKind | null {
    if (device.type === EFFECT_CONFIG.delay.deviceType) {
        return 'delay';
    }
    if (device.type === EFFECT_CONFIG.reverb.deviceType) {
        return 'reverb';
    }
    return null;
}

function looksLikeDelayOrReverb(device: ProjectContextDevice): boolean {
    const descriptorName = getPluginById(device.type)?.name ?? '';
    const name = normalizeText(`${device.type} ${device.name ?? ''} ${descriptorName}`);
    return /\b(?:delay|echo|reverb|verb|plate|room|hall|chamber)\b/u.test(name);
}

function getCompleteParameters(device: ProjectContextDevice): ProjectContextDeviceParameter[] | null {
    const descriptor = getPluginById(device.type);
    if (!descriptor) {
        return null;
    }
    const parameters: ProjectContextDeviceParameter[] = [];
    for (const descriptorParameter of descriptor.parameters) {
        const parameter = device.parameters?.find((candidate) => candidate.id === descriptorParameter.id);
        if (
            !parameter ||
            !Number.isFinite(parameter.value) ||
            parameter.value < descriptorParameter.minValue ||
            parameter.value > descriptorParameter.maxValue
        ) {
            return null;
        }
        parameters.push(parameter);
    }
    return parameters;
}

function collectEffectSources(vocalTracks: readonly ProjectContextTrack[]): {
    sources: EffectSource[];
    unsupportedNames: string[];
} {
    const sources: EffectSource[] = [];
    const unsupportedNames: string[] = [];
    for (const track of vocalTracks) {
        for (const device of track.devices) {
            const kind = classifySupportedEffect(device);
            if (kind === null) {
                if (looksLikeDelayOrReverb(device)) {
                    unsupportedNames.push(`${track.name} ${device.name ?? device.type}`);
                }
                continue;
            }
            const parameters = getCompleteParameters(device);
            if (parameters === null || device.bypassed) {
                unsupportedNames.push(`${track.name} ${device.name ?? device.type}`);
                continue;
            }
            sources.push({ track, device, parameters });
        }
    }
    return { sources, unsupportedNames };
}

function buildEffectGroup(kind: EffectKind, allSources: readonly EffectSource[]): SharedVocalFxEffectGroup | null {
    const config = EFFECT_CONFIG[kind];
    const sources = allSources.filter((source) => classifySupportedEffect(source.device) === kind);
    if (sources.length < 2) {
        return null;
    }
    if (
        sources.some(
            (source, index) =>
                sources.findIndex(
                    (candidate) =>
                        candidate.track.id === source.track.id && candidate.device.type === source.device.type
                ) !== index
        )
    ) {
        return null;
    }
    const referenceParameters = sources[0]?.parameters;
    if (!referenceParameters) {
        return null;
    }
    const referenceShared = referenceParameters.filter((parameter) => parameter.id !== config.mixParameterId);
    const haveSharedConfiguration = sources.every((source) => {
        const shared = source.parameters.filter((parameter) => parameter.id !== config.mixParameterId);
        return (
            shared.length === referenceShared.length &&
            shared.every((parameter, index) => {
                const referenceParameter = referenceShared[index];
                return (
                    referenceParameter !== undefined &&
                    parameter.id === referenceParameter.id &&
                    parameter.value === referenceParameter.value
                );
            })
        );
    });
    if (!haveSharedConfiguration) {
        return null;
    }
    const projectedSources = sources.flatMap((source) => {
        const mix = source.parameters.find((parameter) => parameter.id === config.mixParameterId);
        if (!mix || !Number.isFinite(mix.value) || mix.value < 0 || mix.value > 0.5) {
            return [];
        }
        const dryScale = 1 - mix.value;
        const targetGain = source.track.gain * dryScale;
        const sendLevel = mix.value / dryScale;
        if (!Number.isFinite(targetGain) || !Number.isFinite(sendLevel) || sendLevel < 0 || sendLevel > 1) {
            return [];
        }
        return [
            {
                trackId: source.track.id,
                trackName: source.track.name,
                deviceId: source.device.id,
                deviceName: source.device.name ?? source.device.type,
                originalGain: source.track.gain,
                targetGain,
                originalMix: mix.value,
                sendLevel,
                preFader: false as const,
            },
        ];
    });
    if (projectedSources.length !== sources.length) {
        return null;
    }
    return {
        kind,
        busName: config.busName,
        binding: config.binding,
        deviceType: config.deviceType,
        mixParameterId: config.mixParameterId,
        sharedParameterValues: referenceShared.map((parameter) => ({
            parameterId: parameter.id,
            parameterName: parameter.name,
            value: parameter.value,
            unit: parameter.unit,
        })),
        sources: projectedSources,
    };
}

function getProtectedObjects(
    context: ProjectContext,
    vocalTracks: readonly ProjectContextTrack[],
    removedDeviceIds: ReadonlySet<string>
): Array<{ id: string; name: string }> {
    const vocalIds = new Set(vocalTracks.map((track) => track.id));
    const protections: Array<{ id: string; name: string }> = [
        { id: 'master:gain', name: `Master gain ${String(context.masterGain)}` },
    ];
    for (const track of context.tracks) {
        if (!vocalIds.has(track.id)) {
            protections.push({ id: track.id, name: track.name });
        } else {
            protections.push(
                { id: `${track.id}:pan`, name: `${track.name} pan ${String(track.pan)}` },
                { id: `${track.id}:output`, name: `${track.name} output ${track.outputId ?? 'master'}` },
                { id: `${track.id}:mute`, name: `${track.name} muted ${String(track.muted)}` },
                { id: `${track.id}:solo`, name: `${track.name} soloed ${String(track.soloed)}` }
            );
        }
        for (const device of track.devices) {
            if (!removedDeviceIds.has(device.id)) {
                protections.push({ id: device.id, name: `${track.name} ${device.name ?? device.type}` });
            }
        }
        for (const clip of track.clips) {
            protections.push({ id: clip.id, name: `${track.name} ${clip.name}` });
        }
        for (const send of track.sends ?? []) {
            protections.push({
                id: `${track.id}:send:${send.busId}`,
                name: `${track.name} send ${send.busId} level ${String(send.level)} ${send.preFader ? 'pre-fader' : 'post-fader'}`,
            });
        }
    }
    for (const lane of context.automationLanes ?? []) {
        if (vocalIds.has(lane.trackId)) {
            protections.push({ id: lane.id, name: `${lane.name} automation` });
        }
    }
    return [...new Map(protections.map((protection) => [protection.id, protection])).values()];
}

export function getSharedVocalFxBusesPromptScope(
    context: ProjectContext,
    baseRevision = 'unbound'
): SharedVocalFxBusesPromptScope {
    const vocalTracks = context.tracks.filter(isVocalTrack);
    const ambiguousVocals = context.tracks.filter((track) => isVocalLikeTrack(track) && !isVocalTrack(track));
    if (vocalTracks.length === 0) {
        return { status: 'invalid', reason: 'EX-08 requires at least one unambiguous vocal track' };
    }
    if (ambiguousVocals.length > 0) {
        return {
            status: 'invalid',
            reason: `EX-08 found ambiguous vocal tracks: ${ambiguousVocals.map((track) => track.name).join(', ')}`,
        };
    }
    if (vocalTracks.some((track) => track.frozen === true)) {
        return { status: 'invalid', reason: 'EX-08 vocal tracks must be unfrozen' };
    }
    const duplicateBus = context.tracks.find((track) =>
        Object.values(EFFECT_CONFIG).some((config) => normalizeText(track.name) === normalizeText(config.busName))
    );
    if (duplicateBus) {
        return { status: 'invalid', reason: `EX-08 shared-bus name is already in use: ${duplicateBus.name}` };
    }
    const availableDeviceTypes = new Set((context.availableDeviceTypes ?? []).map((device) => device.id));
    if (
        !availableDeviceTypes.has(EFFECT_CONFIG.delay.deviceType) ||
        !availableDeviceTypes.has(EFFECT_CONFIG.reverb.deviceType)
    ) {
        return { status: 'invalid', reason: 'EX-08 requires the built-in Delay and Reverb devices' };
    }
    const { sources, unsupportedNames } = collectEffectSources(vocalTracks);
    if (unsupportedNames.length > 0) {
        return {
            status: 'invalid',
            reason: `EX-08 cannot preserve unsupported, bypassed, or incomplete vocal effects: ${unsupportedNames.join(', ')}`,
        };
    }
    const sourceCountByTrack = new Map<string, number>();
    for (const source of sources) {
        sourceCountByTrack.set(source.track.id, (sourceCountByTrack.get(source.track.id) ?? 0) + 1);
    }
    const hasUnsafeSignalTopology = vocalTracks.some((track) => {
        const source = sources.find((candidate) => candidate.track.id === track.id);
        return (
            sourceCountByTrack.get(track.id) !== 1 ||
            track.devices.at(-1)?.id !== source?.device.id ||
            track.pan !== 0 ||
            track.outputId !== 'master' ||
            // Unity, deliberately — not the fader's ceiling. The refusal below
            // says "unity-or-lower" and means it: EX-08 lifts each vocal's tail
            // effect onto a shared bus, and it can only promise the balance
            // survives while the strip applies no make-up gain the send would
            // have to be re-trimmed against. Every other bound here is the same
            // kind of "plainly routed" condition. This one was unreachable
            // while `1` was also the fader's ceiling; widening it to
            // `FADER_MAX_GAIN` would keep it unreachable and contradict the
            // reason the caller is handed.
            track.gain > 1 ||
            (track.vcaGroupId !== null && track.vcaGroupId !== undefined) ||
            (track.sends?.length ?? 0) > 0
        );
    });
    const hasVocalAutomation = (context.automationLanes ?? []).some((lane) =>
        vocalTracks.some((track) => track.id === lane.trackId)
    );
    if (hasUnsafeSignalTopology || hasVocalAutomation) {
        return {
            status: 'invalid',
            reason: 'EX-08 can preserve balance only for centered, non-VCA, unity-or-lower master-routed vocals with one tail effect and no existing sends or automation',
        };
    }
    const delayGroup = buildEffectGroup('delay', sources);
    const reverbGroup = buildEffectGroup('reverb', sources);
    if (!delayGroup || !reverbGroup) {
        return {
            status: 'invalid',
            reason: 'EX-08 requires one complete shared delay configuration and one complete shared reverb configuration',
        };
    }
    const removedDeviceIds = new Set(sources.map((source) => source.device.id));
    const protectedObjects = getProtectedObjects(context, vocalTracks, removedDeviceIds);
    const orderedToolPlan: SharedVocalFxBusesCapability['orderedToolPlan'] = [
        ...sources.flatMap((source) => {
            const kind = classifySupportedEffect(source.device);
            const group = kind ? [delayGroup, reverbGroup].find((candidate) => candidate.kind === kind) : undefined;
            const projected = group?.sources.find((candidate) => candidate.deviceId === source.device.id);
            if (!projected) {
                return [];
            }
            return [
                { name: 'removeDevice', arguments: { deviceId: source.device.id } },
                {
                    name: 'setTrackGain',
                    arguments: { trackId: source.track.id, gain: projected.targetGain },
                },
            ];
        }),
        ...[delayGroup, reverbGroup].flatMap((group) => [
            { name: 'createBus', arguments: { name: group.busName, binding: group.binding } },
            { name: 'addDevice', arguments: { trackId: `$${group.binding}`, deviceType: group.deviceType } },
        ]),
        ...[delayGroup, reverbGroup].flatMap((group) =>
            group.sources.map((source) => ({
                name: 'addSend',
                arguments: {
                    trackId: source.trackId,
                    busId: `$${group.binding}`,
                    level: source.sendLevel,
                    preFader: source.preFader,
                },
            }))
        ),
    ];
    return {
        status: 'request',
        protectedObjects,
        capability: {
            schemaVersion: 1,
            baseRevision,
            effectGroups: [delayGroup, reverbGroup],
            protectedObjects,
            orderedToolPlan,
        },
    };
}
