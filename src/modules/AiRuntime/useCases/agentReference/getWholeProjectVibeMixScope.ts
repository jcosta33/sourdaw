import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type ProjectContext, type ProjectContextSection, type ProjectContextTrack } from '../../models/ProjectContext';
import { type WholeProjectVibeMixCapability, type WholeProjectVibeMixPlan } from '../../models/WholeProjectVibeMixPlan';

const IMPACT_GAIN_DB = 1.5;

type WholeProjectVibeMixScope = {
    capability: WholeProjectVibeMixCapability;
    plan: WholeProjectVibeMixPlan;
    protectedObjects: Array<{ id: string; name: string }>;
    section: ProjectContextSection;
    targetIds: string[];
};

function normalizeText(value: string): string {
    return value
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function isExactSecondChorusImpactRequest(prompt: string): boolean {
    const normalized = normalizeText(prompt);
    return (
        normalized.includes('make the second chorus hit harder') &&
        normalized.includes('without changing any lead vocal state') &&
        normalized.includes('the tempo map') &&
        normalized.includes('the master chain')
    );
}

function hasRoleWords(track: ProjectContextTrack, words: readonly string[]): boolean {
    const normalizedName = ` ${normalizeText(track.name)} `;
    return words.every((word) => normalizedName.includes(` ${word} `));
}

function isChorusSection(section: ProjectContextSection): boolean {
    const normalized = normalizeText(section.name);
    return /^chorus(?:\s+(?:\d+|[ivx]+|one|two|three|four|five|six|seven|eight|nine|ten))?$/u.test(normalized);
}

function findUniqueImpactBus(context: ProjectContext, role: 'drum' | 'bass'): ProjectContextTrack | null {
    const matches = context.tracks.filter((track) => track.kind === 'bus' && hasRoleWords(track, [role, 'bus']));
    if (matches.length !== 1) {
        return null;
    }
    return matches[0] ?? null;
}

function toSectionSummary(section: ProjectContextSection) {
    return {
        id: section.id,
        name: section.name,
        startBeat: section.startBeat,
        endBeat: section.endBeat,
    };
}

export function getWholeProjectVibeMixScope(
    prompt: string,
    context: ProjectContext,
    baseRevision = 'unbound'
): WholeProjectVibeMixScope | null {
    if (!isExactSecondChorusImpactRequest(prompt)) {
        return null;
    }

    const orderedSections = [...(context.sections ?? [])].sort(
        (left, right) =>
            left.startBeat - right.startBeat || left.endBeat - right.endBeat || left.id.localeCompare(right.id)
    );
    const choruses = orderedSections.filter(isChorusSection);
    const section = choruses[1];
    if (!section || section.endBeat <= section.startBeat) {
        return null;
    }

    const sectionIndex = orderedSections.findIndex((candidate) => candidate.id === section.id);
    const previousSection = orderedSections[sectionIndex - 1] ?? null;
    const nextSection = orderedSections[sectionIndex + 1] ?? null;
    const drumBus = findUniqueImpactBus(context, 'drum');
    const bassBus = findUniqueImpactBus(context, 'bass');
    if (!drumBus || !bassBus || drumBus.id === bassBus.id) {
        return null;
    }
    const impactBuses = [drumBus, bassBus];
    const leadVocals = context.tracks.filter((track) => hasRoleWords(track, ['lead', 'vocal']));
    const lockedClips = context.tracks.flatMap((track) =>
        track.clips
            .filter((clip) => clip.locked === true)
            .map((clip) => ({ id: clip.id, name: `${clip.name} (locked clip)` }))
    );
    const masters = context.tracks.filter((track) => track.kind === 'master');
    if (leadVocals.length === 0 || masters.length !== 1) {
        return null;
    }
    if (
        impactBuses.some(
            (track) =>
                track.frozen === true ||
                track.automationMode === 'off' ||
                !Number.isFinite(track.gain) ||
                track.gain <= 0 ||
                // The fader's own ceiling, matching what
                // `handleAutomateTrackGainRange` admits.
                track.gain * 10 ** (IMPACT_GAIN_DB / 20) > FADER_MAX_GAIN ||
                (context.automationLanes ?? []).some(
                    (lane) =>
                        lane.id === `auto-gain-${encodeURIComponent(track.id)}` ||
                        (lane.trackId === track.id && !lane.clipId && lane.parameterId === 'gain')
                )
        )
    ) {
        return null;
    }

    const targetIds = impactBuses.map((track) => track.id);
    const protectedObjects = [
        ...leadVocals.map((track) => ({ id: track.id, name: track.name })),
        ...lockedClips,
        ...masters.map((track) => ({ id: track.id, name: `${track.name} chain` })),
        { id: 'project:tempo-map', name: 'Tempo map' },
    ];
    const commandBatch = [
        {
            type: 'automateTrackGainRange' as const,
            payload: { trackIds: targetIds, sectionName: section.name, gainDb: IMPACT_GAIN_DB },
        },
    ];
    const capability: WholeProjectVibeMixCapability = {
        schemaVersion: 1,
        baseRevision,
        actionType: 'automateTrackGainRange',
        targetSection: toSectionSummary(section),
        neighboringSections: {
            previous: previousSection ? toSectionSummary(previousSection) : null,
            next: nextSection ? toSectionSummary(nextSection) : null,
        },
        candidateImpactBuses: impactBuses.map((track) => ({
            id: track.id,
            name: track.name,
            currentGain: track.gain,
        })),
        exactTargetIds: targetIds,
        allowedRelativeGainDbValues: [IMPACT_GAIN_DB],
        protectedObjectIds: protectedObjects.map((object) => object.id),
        constraints: {
            preserveRouting: true,
            preserveDevices: true,
            requireFreshConfirmation: true,
        },
    };
    const plan: WholeProjectVibeMixPlan = {
        schemaVersion: 1,
        baseRevision,
        productionVision: `Give ${section.name} more impact through bounded rhythm-section dynamics, without claiming perceptual judgment.`,
        globalConstraints: protectedObjects.map((object) => ({
            ...object,
            reason: lockedClips.some((clip) => clip.id === object.id)
                ? 'Explicit project clip lock.'
                : 'Explicitly protected by the user request.',
        })),
        sectionMap: {
            target: toSectionSummary(section),
            previous: previousSection ? toSectionSummary(previousSection) : null,
            next: nextSection ? toSectionSummary(nextSection) : null,
        },
        trackRoles: [
            ...impactBuses.map((track) => ({
                trackId: track.id,
                trackName: track.name,
                role: 'impact-bus' as const,
            })),
            ...leadVocals.map((track) => ({
                trackId: track.id,
                trackName: track.name,
                role: 'protected-lead-vocal' as const,
            })),
            ...masters.map((track) => ({
                trackId: track.id,
                trackName: track.name,
                role: 'protected-master' as const,
            })),
        ],
        dynamicTrajectory: {
            gainDb: IMPACT_GAIN_DB,
            startBeat: section.startBeat,
            endBeat: section.endBeat,
            before: 'preserve-current',
            inside: 'lift-impact-buses',
            after: 'restore-current',
        },
        strategy: {
            routing: 'preserve-existing',
            devices: 'preserve-existing',
            automation: `Lift ${impactBuses.map((track) => track.name).join(' and ')} by ${String(IMPACT_GAIN_DB)} dB only from beat ${String(section.startBeat)} to ${String(section.endBeat)}.`,
        },
        acceptedDecisions: [
            'Preserve every lead-vocal property and automation lane.',
            'Preserve every explicit clip lock.',
            'Preserve the tempo map.',
            'Preserve the master chain.',
            'Preserve existing routing and device chains.',
            'Stop after one previewable proposal and require fresh approval before commit.',
        ],
        commandBatch,
    };

    return { capability, plan, protectedObjects, section, targetIds };
}
