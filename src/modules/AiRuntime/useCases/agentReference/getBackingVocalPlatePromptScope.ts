import { type BackingVocalPlateCapability } from '../../models/BackingVocalPlateCapability';
import { type ProjectContext, type ProjectContextSection, type ProjectContextTrack } from '../../models/ProjectContext';

const BUS_NAME = 'Backing Vocal Plate';
const BUS_BINDING = 'backing-vocal-plate';
const FILTER_BINDING = 'backing-vocal-plate-filter';
const FILTER_DEVICE_TYPE = 'builtin-filter';
const PLATE_DEVICE_TYPE = 'dutch-oven';
const SEND_LEVEL_DB = -18;
const SEND_LEVEL = 10 ** (SEND_LEVEL_DB / 20);
const AUTOMATION_TAIL_BARS = 4;
const AUTOMATION_TARGET_LEVEL_DB = -10;
const RENDER_SAMPLE_RATE = 44_100;
const RENDER_TAIL_SECONDS = 0;

const REVERB_DEVICE_TYPES = new Set([
    'builtin-reverb',
    'builtin-convolution-reverb',
    'dutch-oven',
    'proof-chamber',
    'faust-zita-rev1-reverb',
    'faust-spring-reverb',
]);

type BackingVocalPlatePromptScope =
    | { status: 'none' }
    | { status: 'invalid'; reason: string }
    | {
          status: 'request';
          capability: BackingVocalPlateCapability;
          backingVocals: ProjectContextTrack[];
          chorusSections: ProjectContextSection[];
          protectedObjects: Array<{ id: string; name: string }>;
      };

function normalizeText(value: string): string {
    return value
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function isExactRequest(prompt: string): boolean {
    return (
        normalizeText(prompt) ===
        'remove reverbs from all backing vocals create one shared plate bus with eq before plate reverb and a 250 hz high pass create post fader sends at 18 db automate them to 10 db over the final four bars of every chorus protect the lead vocal render each chorus and receipt every created removed routed automated and rendered object'
    );
}

function isBackingVocal(track: ProjectContextTrack): boolean {
    if (track.kind !== 'audio' && track.kind !== 'midi') {
        return false;
    }
    const name = normalizeText(track.name);
    return /^(?:(?:backing|background|bg) (?:vocal|vocals|vox)|bgv|bvs?|bv)(?: (?:high|low|mid|left|right|l|r|double|doublet|[0-9]+))*$/u.test(
        name
    );
}

function isLeadVocal(track: ProjectContextTrack): boolean {
    if (track.kind !== 'audio' && track.kind !== 'midi') {
        return false;
    }
    return /^(?:lead (?:vocal|vocals|vox))(?: (?:main|double|left|right|l|r|[0-9]+))*$/u.test(
        normalizeText(track.name)
    );
}

function hasAmbiguousVocalRole(track: ProjectContextTrack): boolean {
    if (track.kind !== 'audio' && track.kind !== 'midi') {
        return false;
    }
    return /\b(?:vocal|vocals|vox|bgv|bvs?|bv)\b/u.test(normalizeText(track.name));
}

function isChorus(section: ProjectContextSection): boolean {
    return /^chorus(?: (?:[0-9]+|[ivx]+|one|two|three|four|five|six|seven|eight|nine|ten))?$/u.test(
        normalizeText(section.name)
    );
}

function isReverbDevice(device: ProjectContextTrack['devices'][number]): boolean {
    return REVERB_DEVICE_TYPES.has(device.type);
}

function getProtectedObjects(context: ProjectContext, backingVocals: readonly ProjectContextTrack[]) {
    const backingIds = new Set(backingVocals.map((track) => track.id));
    const protections: Array<{ id: string; name: string }> = [];
    for (const track of context.tracks) {
        if (!backingIds.has(track.id)) {
            protections.push({ id: track.id, name: track.name });
        }
        for (const device of track.devices) {
            if (!backingIds.has(track.id) || !isReverbDevice(device)) {
                protections.push({
                    id: device.id,
                    name: `${track.name} ${device.name ?? device.type}`,
                });
            }
        }
        for (const clip of track.clips) {
            protections.push({ id: clip.id, name: `${track.name} ${clip.name}` });
        }
    }
    return protections;
}

export function getBackingVocalPlatePromptScope(
    prompt: string,
    context: ProjectContext,
    baseRevision = 'unbound'
): BackingVocalPlatePromptScope {
    if (!isExactRequest(prompt)) {
        return { status: 'none' };
    }

    const backingVocals = context.tracks.filter(isBackingVocal);
    const leadVocals = context.tracks.filter(isLeadVocal);
    const ambiguousVocals = context.tracks.filter(
        (track) => hasAmbiguousVocalRole(track) && !isBackingVocal(track) && !isLeadVocal(track)
    );
    if (backingVocals.length === 0) {
        return { status: 'invalid', reason: 'EX-01 requires at least one unambiguous backing-vocal track' };
    }
    if (leadVocals.length === 0) {
        return { status: 'invalid', reason: 'EX-01 requires at least one unambiguous protected lead vocal' };
    }
    if (ambiguousVocals.length > 0) {
        return {
            status: 'invalid',
            reason: `EX-01 found ambiguous vocal roles: ${ambiguousVocals.map((track) => track.name).join(', ')}`,
        };
    }
    if (backingVocals.some((track) => track.frozen === true || track.automationMode === 'off')) {
        return { status: 'invalid', reason: 'EX-01 backing vocals must be unfrozen and automation-enabled' };
    }
    if (context.tracks.some((track) => normalizeText(track.name) === normalizeText(BUS_NAME))) {
        return { status: 'invalid', reason: `EX-01 bus name is already in use: ${BUS_NAME}` };
    }
    const availableDeviceTypes = new Set((context.availableDeviceTypes ?? []).map((device) => device.id));
    if (!availableDeviceTypes.has(FILTER_DEVICE_TYPE) || !availableDeviceTypes.has(PLATE_DEVICE_TYPE)) {
        return { status: 'invalid', reason: 'EX-01 requires the built-in Filter and Dutch Oven devices' };
    }

    const [numerator, denominator] = context.timeSignature;
    const beatsPerBar = numerator * (4 / denominator);
    const automationLengthBeats = beatsPerBar * AUTOMATION_TAIL_BARS;
    if (!Number.isFinite(automationLengthBeats) || automationLengthBeats <= 0) {
        return { status: 'invalid', reason: 'EX-01 requires one finite positive project time signature' };
    }
    const chorusSections = [...(context.sections ?? [])]
        .filter(isChorus)
        .sort((left, right) => left.startBeat - right.startBeat || left.id.localeCompare(right.id));
    if (
        chorusSections.length === 0 ||
        chorusSections.some(
            (section) =>
                !Number.isFinite(section.startBeat) || section.endBeat - section.startBeat < automationLengthBeats
        )
    ) {
        return { status: 'invalid', reason: 'EX-01 requires every chorus to span at least four complete bars' };
    }

    const removableReverbs = backingVocals.flatMap((track) =>
        track.devices.filter(isReverbDevice).map((device) => ({ track, device }))
    );
    if (removableReverbs.length === 0) {
        return { status: 'invalid', reason: 'EX-01 found no backing-vocal reverb device to remove' };
    }
    const protectedObjects = getProtectedObjects(context, backingVocals);
    const sectionIds = chorusSections.map((section) => section.id);
    const trackIds = backingVocals.map((track) => track.id);
    const orderedToolPlan: BackingVocalPlateCapability['orderedToolPlan'] = [
        ...removableReverbs.map(({ device }) => ({
            name: 'removeDevice',
            arguments: { deviceId: device.id },
        })),
        { name: 'createBus', arguments: { name: BUS_NAME, binding: BUS_BINDING } },
        {
            name: 'addDevice',
            arguments: {
                trackId: `$${BUS_BINDING}`,
                deviceType: FILTER_DEVICE_TYPE,
                binding: FILTER_BINDING,
            },
        },
        {
            name: 'setDeviceParameter',
            arguments: { deviceId: `$${FILTER_BINDING}`, paramId: 'filter-type', value: 1 },
        },
        {
            name: 'setDeviceParameter',
            arguments: { deviceId: `$${FILTER_BINDING}`, paramId: 'filter-cutoff', value: 250 },
        },
        {
            name: 'addDevice',
            arguments: {
                trackId: `$${BUS_BINDING}`,
                deviceType: PLATE_DEVICE_TYPE,
                afterDeviceId: `$${FILTER_BINDING}`,
            },
        },
        ...trackIds.map((trackId) => ({
            name: 'addSend',
            arguments: { trackId, busId: `$${BUS_BINDING}`, level: SEND_LEVEL, preFader: false },
        })),
        {
            name: 'automateSendRanges',
            arguments: {
                trackIds,
                busId: `$${BUS_BINDING}`,
                sectionIds,
                tailBars: AUTOMATION_TAIL_BARS,
                targetLevelDb: AUTOMATION_TARGET_LEVEL_DB,
            },
        },
        { name: 'renderProjectSections', arguments: { sectionIds } },
    ];
    const capability: BackingVocalPlateCapability = {
        schemaVersion: 1,
        baseRevision,
        backingVocals: backingVocals.map((track) => ({
            trackId: track.id,
            trackName: track.name,
            removableReverbDeviceIds: track.devices.filter(isReverbDevice).map((device) => device.id),
        })),
        protectedObjects,
        chorusSections: chorusSections.map((section) => ({
            sectionId: section.id,
            sectionName: section.name,
            startBeat: section.startBeat,
            endBeat: section.endBeat,
            automationStartBeat: section.endBeat - automationLengthBeats,
        })),
        fixedValues: {
            busName: BUS_NAME,
            filterDeviceType: FILTER_DEVICE_TYPE,
            filterType: 1,
            highPassHz: 250,
            plateDeviceType: PLATE_DEVICE_TYPE,
            sendLevelDb: SEND_LEVEL_DB,
            sendLevel: SEND_LEVEL,
            sendPreFader: false,
            automationTailBars: AUTOMATION_TAIL_BARS,
            automationTargetLevelDb: AUTOMATION_TARGET_LEVEL_DB,
            renderSampleRate: RENDER_SAMPLE_RATE,
            renderTailSeconds: RENDER_TAIL_SECONDS,
        },
        orderedToolPlan,
    };
    return { status: 'request', capability, backingVocals, chorusSections, protectedObjects };
}
