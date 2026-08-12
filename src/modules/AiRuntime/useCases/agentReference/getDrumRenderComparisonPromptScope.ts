import { type DrumRenderComparisonCapability } from '../../models/DrumRenderComparisonCapability';
import { type DrumRoutingRole } from '../../models/DrumRoutingCapability';
import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';

import { projectCanonicalTrackRole } from './projectCanonicalTrackRole';

const DRUM_BUS_NAME = 'Drum Bus';
const DRUM_BUS_BINDING = 'drum-bus';
const PARALLEL_BUS_NAME = 'Parallel Compression';
const PARALLEL_BUS_BINDING = 'parallel-compression';
const COMPRESSOR_DEVICE_TYPE = 'builtin-compressor';
const SEND_LEVEL_DB = -12;
const SEND_LEVEL = 10 ** (SEND_LEVEL_DB / 20);
const PARALLEL_GAIN_DB = -1.5;
const PARALLEL_GAIN = 10 ** (PARALLEL_GAIN_DB / 20);
const TARGET_ROLES: readonly DrumRoutingRole[] = ['kick', 'snare', 'hi-hat'];
const RENDER_SECTION_NAMES = ['verse one', 'chorus one'] as const;

export type DrumRenderComparisonPromptScope =
    | { status: 'invalid'; reason: string }
    | {
          status: 'request';
          capability: DrumRenderComparisonCapability;
          protectedObjects: Array<{ id: string; name: string }>;
      };

function normalizeText(value: string): string {
    return value
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function isLocked(track: ProjectContextTrack): boolean {
    return track.clips.some((clip) => clip.locked === true);
}

export function getDrumRenderComparisonPromptScope(
    context: ProjectContext,
    baseRevision = 'unbound'
): DrumRenderComparisonPromptScope {
    const reservedBusNames = new Set([normalizeText(DRUM_BUS_NAME), normalizeText(PARALLEL_BUS_NAME)]);
    if (context.tracks.some((track) => reservedBusNames.has(normalizeText(track.name)))) {
        return { status: 'invalid', reason: 'EX-11 requires unused Drum Bus and Parallel Compression names' };
    }
    if (!(context.availableDeviceTypes ?? []).some((device) => device.id === COMPRESSOR_DEVICE_TYPE)) {
        return { status: 'invalid', reason: 'EX-11 requires the built-in Compressor device' };
    }

    const targetByRole = new Map<DrumRoutingRole, ProjectContextTrack[]>();
    const roomTracks: ProjectContextTrack[] = [];
    const protectedObjects: Array<{ id: string; name: string }> = [];
    for (const track of context.tracks) {
        const projection = projectCanonicalTrackRole(track);
        if (projection.classification === 'ambiguous') {
            return { status: 'invalid', reason: `EX-11 track role is ambiguous: ${track.id}` };
        }
        if (projection.classification === 'non-drum') {
            protectedObjects.push({ id: track.id, name: track.name });
            continue;
        }
        if (projection.role === 'room') {
            roomTracks.push(track);
            protectedObjects.push({ id: track.id, name: `${track.name} direct-to-Master route` });
            continue;
        }
        if (!TARGET_ROLES.includes(projection.role)) {
            protectedObjects.push({ id: track.id, name: track.name });
            continue;
        }
        const roleTracks = targetByRole.get(projection.role) ?? [];
        roleTracks.push(track);
        targetByRole.set(projection.role, roleTracks);
    }

    const closeDrums: DrumRenderComparisonCapability['closeDrums'] = [];
    for (const role of TARGET_ROLES) {
        const roleTracks = targetByRole.get(role) ?? [];
        if (roleTracks.length !== 1) {
            return { status: 'invalid', reason: `EX-11 requires exactly one ${role} target` };
        }
        const track = roleTracks[0];
        if (!track) {
            return { status: 'invalid', reason: `EX-11 requires exactly one ${role} target` };
        }
        if (track.frozen === true || isLocked(track) || typeof track.outputId !== 'string') {
            return { status: 'invalid', reason: `EX-11 drum target is unavailable or protected: ${track.id}` };
        }
        closeDrums.push({
            trackId: track.id,
            trackName: track.name,
            role,
            currentOutputId: track.outputId,
        });
    }
    if (roomTracks.length !== 1 || roomTracks[0]?.outputId !== 'master') {
        return { status: 'invalid', reason: 'EX-11 requires exactly one Drum Room routed directly to Master' };
    }
    const room = roomTracks[0];

    const renderSections = RENDER_SECTION_NAMES.map((name) =>
        (context.sections ?? []).filter((section) => normalizeText(section.name) === name)
    );
    if (renderSections.some((matches) => matches.length !== 1)) {
        return { status: 'invalid', reason: 'EX-11 requires unique Verse One and Chorus One sections' };
    }
    const sections = renderSections.flatMap((matches) => matches);
    if (
        sections.some(
            (section) =>
                !Number.isFinite(section.startBeat) ||
                !Number.isFinite(section.endBeat) ||
                section.endBeat <= section.startBeat
        )
    ) {
        return { status: 'invalid', reason: 'EX-11 render sections require finite positive ranges' };
    }

    const orderedToolPlan: DrumRenderComparisonCapability['orderedToolPlan'] = [
        { name: 'createBus', arguments: { name: DRUM_BUS_NAME, binding: DRUM_BUS_BINDING } },
        ...closeDrums.map((track) => ({
            name: 'setTrackOutput',
            arguments: { trackId: track.trackId, outputId: `$${DRUM_BUS_BINDING}` },
        })),
        { name: 'createBus', arguments: { name: PARALLEL_BUS_NAME, binding: PARALLEL_BUS_BINDING } },
        {
            name: 'addDevice',
            arguments: { trackId: `$${PARALLEL_BUS_BINDING}`, deviceType: COMPRESSOR_DEVICE_TYPE },
        },
        {
            name: 'addSend',
            arguments: {
                trackId: `$${DRUM_BUS_BINDING}`,
                busId: `$${PARALLEL_BUS_BINDING}`,
                level: SEND_LEVEL,
                preFader: false,
            },
        },
        {
            name: 'setTrackGain',
            arguments: { trackId: `$${PARALLEL_BUS_BINDING}`, gain: PARALLEL_GAIN },
        },
        { name: 'renderProjectSections', arguments: { sectionIds: sections.map((section) => section.id) } },
    ];
    const capability: DrumRenderComparisonCapability = {
        schemaVersion: 1,
        baseRevision,
        closeDrums,
        protectedObjects,
        room: { trackId: room.id, trackName: room.name, currentOutputId: 'master' },
        renderSections: sections.map((section) => ({
            sectionId: section.id,
            sectionName: section.name,
            startBeat: section.startBeat,
            endBeat: section.endBeat,
        })),
        fixedValues: {
            drumBusName: DRUM_BUS_NAME,
            drumBusBinding: DRUM_BUS_BINDING,
            parallelBusName: PARALLEL_BUS_NAME,
            parallelBusBinding: PARALLEL_BUS_BINDING,
            compressorDeviceType: COMPRESSOR_DEVICE_TYPE,
            sendLevelDb: SEND_LEVEL_DB,
            sendLevel: SEND_LEVEL,
            sendPreFader: false,
            parallelGainDb: PARALLEL_GAIN_DB,
            parallelGain: PARALLEL_GAIN,
            renderSampleRate: 44_100,
            renderTailSeconds: 0,
        },
        orderedToolPlan,
    };
    return { status: 'request', capability, protectedObjects };
}
