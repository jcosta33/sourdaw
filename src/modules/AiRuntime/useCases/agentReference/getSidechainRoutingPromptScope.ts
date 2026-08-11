import { getSidechainTargetCapability } from '#/utils/getSidechainTargetCapability';

import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';
import {
    type SidechainRoutingCapability,
    type SidechainRoutingProtectedTarget,
    type SidechainRoutingTarget,
} from '../../models/SidechainRoutingCapability';

type SidechainRoutingPromptScope =
    | { status: 'none' }
    | { status: 'invalid'; reason: string }
    | {
          status: 'request';
          sourceTrackId: string;
          routes: Array<{ sourceTrackId: string; targetTrackId: string; targetDeviceId: string }>;
          protectedTargets: SidechainRoutingProtectedTarget[];
          capability?: SidechainRoutingCapability;
      };

const KICK_PATTERN = /^(?:kick|kick drum|bass drum|bd)(?: (?:in|out|inside|outside|sub|close|far|mic|[0-9]+))*$/u;
const BASS_PATTERN =
    /^(?:bass|bass di|di bass|bass guitar|electric bass|upright bass|bass synth|synth bass|sub bass)(?: [0-9]+)*$/u;
const SIDECHAIN_ROUTING_PROMPTS = new Set([
    'create a sidechain from the kick to every bass compressor that supports sidechain input',
    'reduce kick bass masking without replacing either basic sound',
]);

function normalizeText(value: string): string {
    return value
        .toLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function isLocked(track: ProjectContextTrack): boolean {
    return track.clips.some((clip) => clip.locked === true);
}

function isRoutable(track: ProjectContextTrack): boolean {
    return track.kind === 'audio' || track.kind === 'midi' || track.kind === 'bus';
}

function addProtection(
    protections: SidechainRoutingProtectedTarget[],
    protection: SidechainRoutingProtectedTarget
): void {
    if (!protections.some((candidate) => candidate.id === protection.id)) {
        protections.push(protection);
    }
}

export function getSidechainRoutingPromptScope(
    prompt: string,
    context: ProjectContext,
    projectRevision?: string
): SidechainRoutingPromptScope {
    const normalizedPrompt = normalizeText(prompt);
    if (!SIDECHAIN_ROUTING_PROMPTS.has(normalizedPrompt)) {
        return { status: 'none' };
    }

    const kickTracks = context.tracks.filter(
        (track) => isRoutable(track) && KICK_PATTERN.test(normalizeText(track.name))
    );
    if (kickTracks.length !== 1) {
        return { status: 'invalid', reason: 'MF-06 requires exactly one canonical Kick source' };
    }
    const source = kickTracks[0]!;
    if (source.frozen === true || isLocked(source)) {
        return { status: 'invalid', reason: `MF-06 Kick source is protected or locked: ${source.id}` };
    }

    const protectedTargets: SidechainRoutingProtectedTarget[] = [];
    const targets: SidechainRoutingTarget[] = [];
    for (const track of context.tracks) {
        if (track.id === source.id) {
            continue;
        }
        const normalizedName = normalizeText(track.name);
        const bassRole = isRoutable(track) && BASS_PATTERN.test(normalizedName);
        if (!bassRole) {
            if (/\b(?:bass|kick)\b/u.test(normalizedName)) {
                return { status: 'invalid', reason: `MF-06 track role is ambiguous: ${track.id}` };
            }
            addProtection(protectedTargets, { id: track.id, name: track.name, reason: 'non-bass' });
            continue;
        }
        if (track.frozen === true) {
            addProtection(protectedTargets, { id: track.id, name: track.name, reason: 'frozen' });
            continue;
        }
        if (isLocked(track)) {
            addProtection(protectedTargets, { id: track.id, name: track.name, reason: 'locked' });
            continue;
        }
        for (const device of track.devices) {
            const capability = getSidechainTargetCapability(device.type);
            if (!capability) {
                addProtection(protectedTargets, {
                    id: device.id,
                    name: `${track.name} ${device.name ?? device.type}`,
                    reason: 'unsupported-device',
                });
                continue;
            }
            const existing = (context.sidechainRoutes ?? []).some(
                (route) => route.sourceTrackId === source.id && route.targetDeviceId === device.id
            );
            if (existing) {
                addProtection(protectedTargets, {
                    id: device.id,
                    name: `${track.name} ${device.name ?? device.type}`,
                    reason: 'already-routed',
                });
                continue;
            }
            targets.push({
                trackId: track.id,
                trackName: track.name,
                trackRole: 'bass',
                roleEvidence: `canonical-name:${normalizedName}`,
                deviceId: device.id,
                deviceName: device.name ?? device.type,
                deviceType: device.type,
                targetParameterId: capability.targetParameterId,
            });
        }
    }
    if (targets.length === 0) {
        return { status: 'invalid', reason: 'MF-06 found no eligible bass compressor sidechain targets' };
    }

    const routes = targets.map((target) => ({
        sourceTrackId: source.id,
        targetTrackId: target.trackId,
        targetDeviceId: target.deviceId,
    }));
    const capability: SidechainRoutingCapability | undefined = projectRevision
        ? {
              schemaVersion: 1,
              baseRevision: projectRevision,
              actionType: 'addSidechainRoute',
              source: {
                  trackId: source.id,
                  trackName: source.name,
                  role: 'kick',
                  roleEvidence: `canonical-name:${normalizeText(source.name)}`,
              },
              targets,
              protectedTargets,
              allowedAction: {
                  type: 'addSidechainRoute',
                  exactRoutes: routes,
                  requiredPayloadKeys: ['sourceTrackId', 'targetTrackId', 'targetDeviceId'],
              },
              constraints: {
                  requireCompleteExactTargetSet: true,
                  requireFreshConfirmation: true,
                  preserveProtectedTargets: true,
              },
          }
        : undefined;
    return { status: 'request', sourceTrackId: source.id, routes, protectedTargets, capability };
}
