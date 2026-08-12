import { type BassProcessingCopyCapability } from '../../models/BassProcessingCopyCapability';
import {
    type ProjectContext,
    type ProjectContextAdjustmentLayer,
    type ProjectContextAdjustmentRegion,
    type ProjectContextSection,
    type ProjectContextTrack,
} from '../../models/ProjectContext';

import { projectCanonicalTrackRole } from './projectCanonicalTrackRole';

type BassProcessingCopyPlanEntry = {
    layer: ProjectContextAdjustmentLayer;
    sourceRegion: ProjectContextAdjustmentRegion;
    targetRegion: Omit<ProjectContextAdjustmentRegion, 'id'>;
};

export type BassProcessingCopyRequestScope = {
    status: 'request';
    capability: BassProcessingCopyCapability;
    bassTracks: ProjectContextTrack[];
    entries: BassProcessingCopyPlanEntry[];
    protectedObjects: Array<{ id: string; name: string }>;
    protectedAutomationLaneIds: string[];
    sourceSection: ProjectContextSection;
    targetSection: ProjectContextSection;
};

export type BassProcessingCopyPromptScope = { status: 'invalid'; reason: string } | BassProcessingCopyRequestScope;

function normalizeText(value: string): string {
    return value
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function findUniqueSection(context: ProjectContext, name: string): ProjectContextSection | null {
    const normalizedName = normalizeText(name);
    const matches = (context.sections ?? []).filter((section) => normalizeText(section.name) === normalizedName);
    return matches.length === 1 ? (matches[0] ?? null) : null;
}

function isBassTrack(track: ProjectContextTrack): boolean {
    if (track.kind !== 'audio' && track.kind !== 'midi') {
        return false;
    }
    const projectedRole = projectCanonicalTrackRole(track);
    if (projectedRole.classification !== 'ambiguous') {
        return projectedRole.classification === 'non-drum' && projectedRole.role === 'bass-instrument';
    }
    return /(?:^| )bass(?: |$)/u.test(normalizeText(track.name));
}

function regionsOverlap(
    left: Pick<ProjectContextAdjustmentRegion, 'startBeat' | 'endBeat'>,
    right: Pick<ProjectContextAdjustmentRegion, 'startBeat' | 'endBeat'>
): boolean {
    return left.startBeat < right.endBeat && right.startBeat < left.endBeat;
}

function toSectionSummary(section: ProjectContextSection) {
    return {
        id: section.id,
        name: section.name,
        startBeat: section.startBeat,
        endBeat: section.endBeat,
    };
}

function isDistortionDevice(device: ProjectContextTrack['devices'][number]): boolean {
    return /(?:^|[ -])distortion(?:[ -]|$)/u.test(normalizeText(`${device.type} ${device.name ?? ''}`));
}

export function getBassProcessingCopyPromptScope(
    context: ProjectContext,
    baseRevision = 'unbound'
): BassProcessingCopyPromptScope {
    const sourceSection = findUniqueSection(context, 'Chorus One');
    const targetSection = findUniqueSection(context, 'Chorus Two');
    if (!sourceSection || !targetSection) {
        return { status: 'invalid', reason: 'EX-03 requires unique Chorus One and Chorus Two sections' };
    }
    const sourceDuration = sourceSection.endBeat - sourceSection.startBeat;
    const targetDuration = targetSection.endBeat - targetSection.startBeat;
    if (sourceDuration <= 0 || targetDuration !== sourceDuration) {
        return { status: 'invalid', reason: 'EX-03 requires equal positive source and target section durations' };
    }

    const bassTracks = context.tracks.filter(isBassTrack);
    if (bassTracks.length === 0) {
        return { status: 'invalid', reason: 'EX-03 requires at least one unambiguous bass track' };
    }
    if (bassTracks.some((track) => track.frozen === true)) {
        return { status: 'invalid', reason: 'EX-03 bass targets must be unfrozen' };
    }
    const bassTrackIds = new Set(bassTracks.map((track) => track.id));
    const sourceBounds = { startBeat: sourceSection.startBeat, endBeat: sourceSection.endBeat };
    const targetBounds = { startBeat: targetSection.startBeat, endBeat: targetSection.endBeat };
    const delta = targetSection.startBeat - sourceSection.startBeat;
    const entries: BassProcessingCopyPlanEntry[] = [];
    const protectedLayers: Array<{ id: string; name: string }> = [];

    for (const layer of context.adjustmentLayers ?? []) {
        const sourceRegions = layer.regions.filter((region) => regionsOverlap(region, sourceBounds));
        if (sourceRegions.length === 0) {
            protectedLayers.push({ id: layer.id, name: layer.name });
            continue;
        }
        if (
            sourceRegions.some(
                (region) => region.startBeat < sourceSection.startBeat || region.endBeat > sourceSection.endBeat
            )
        ) {
            return { status: 'invalid', reason: `EX-03 source region crosses Chorus One: ${layer.id}` };
        }
        const affectsBass = layer.affectedTrackIds.some((trackId) => bassTrackIds.has(trackId));
        const bassOnly =
            layer.affectedTrackIds.length > 0 && layer.affectedTrackIds.every((trackId) => bassTrackIds.has(trackId));
        if (!affectsBass) {
            protectedLayers.push({ id: layer.id, name: layer.name });
            continue;
        }
        if (!bassOnly || !layer.enabled || !Number.isFinite(layer.mix) || layer.mix <= 0) {
            return {
                status: 'invalid',
                reason: `EX-03 bass processing layer is not independently copyable: ${layer.id}`,
            };
        }
        for (const sourceRegion of sourceRegions) {
            const targetRegion = {
                startBeat: sourceRegion.startBeat + delta,
                endBeat: sourceRegion.endBeat + delta,
                blend: sourceRegion.blend,
                fadeInBeats: sourceRegion.fadeInBeats,
                fadeOutBeats: sourceRegion.fadeOutBeats,
            };
            if (
                targetRegion.startBeat < targetSection.startBeat ||
                targetRegion.endBeat > targetSection.endBeat ||
                layer.regions.some((region) => regionsOverlap(region, targetBounds))
            ) {
                return { status: 'invalid', reason: `EX-03 target region is not empty for layer: ${layer.id}` };
            }
            entries.push({ layer, sourceRegion, targetRegion });
        }
    }
    if (entries.length === 0) {
        return { status: 'invalid', reason: 'EX-03 found no section-bounded bass processing to copy' };
    }

    const distortionDeviceIds = new Set(
        bassTracks.flatMap((track) => track.devices.filter(isDistortionDevice).map((device) => device.id))
    );
    const protectedAutomationLanes = (context.automationLanes ?? []).filter((lane) => {
        if (!bassTrackIds.has(lane.trackId)) {
            return false;
        }
        const deviceId = lane.parameterId.split(':', 1)[0];
        return deviceId !== undefined && distortionDeviceIds.has(deviceId);
    });
    if (
        protectedAutomationLanes.length === 0 ||
        !protectedAutomationLanes.some((lane) =>
            lane.points.some((point) => point.beat >= targetSection.startBeat && point.beat <= targetSection.endBeat)
        )
    ) {
        return { status: 'invalid', reason: 'EX-03 requires existing Chorus Two bass distortion automation' };
    }

    const targetedLayerIds = new Set(entries.map((entry) => entry.layer.id));
    const protectedObjects = [
        ...context.tracks
            .filter((track) => !bassTrackIds.has(track.id))
            .map((track) => ({ id: track.id, name: track.name })),
        ...protectedLayers.filter((layer) => !targetedLayerIds.has(layer.id)),
        ...protectedAutomationLanes.map((lane) => ({
            id: lane.id,
            name: `${lane.name}: ${lane.points
                .map((point) => `${String(point.beat)}→${String(point.value)} (${point.curve})`)
                .join(', ')}`,
        })),
    ];
    const exactPlan = entries.map((entry) => ({
        layerId: entry.layer.id,
        ...entry.targetRegion,
    }));
    const capability: BassProcessingCopyCapability = {
        schemaVersion: 1,
        baseRevision,
        actionType: 'addAdjustmentRegion',
        sourceSection: toSectionSummary(sourceSection),
        targetSection: toSectionSummary(targetSection),
        bassTracks: bassTracks.map((track) => ({ id: track.id, name: track.name })),
        sourceProcessing: entries.map((entry) => ({
            layerId: entry.layer.id,
            layerName: entry.layer.name,
            effectType: entry.layer.effectType,
            affectedTrackIds: [...entry.layer.affectedTrackIds],
            enabled: entry.layer.enabled,
            mix: entry.layer.mix,
            parameters: entry.layer.parameters.map(({ name, value, unit }) => ({ name, value, unit })),
            sourceRegion: { ...entry.sourceRegion },
            targetRegion: { ...entry.targetRegion },
        })),
        exactPlan,
        protectedAutomationLanes: protectedAutomationLanes.map((lane) => ({
            id: lane.id,
            trackId: lane.trackId,
            parameterId: lane.parameterId,
            name: lane.name,
            enabled: lane.enabled,
            points: lane.points.map((point) => ({ ...point })),
        })),
        protectedObjectIds: protectedObjects.map((object) => object.id),
        constraints: {
            preserveSourceProcessing: true,
            preserveTargetDistortionAutomation: true,
            requireFreshConfirmation: true,
        },
    };

    return {
        status: 'request',
        capability,
        bassTracks,
        entries,
        protectedObjects,
        protectedAutomationLaneIds: protectedAutomationLanes.map((lane) => lane.id),
        sourceSection,
        targetSection,
    };
}
