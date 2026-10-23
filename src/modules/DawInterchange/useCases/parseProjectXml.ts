import { DEFAULT_TEMPO_BPM } from '#/modules/Transport/stores';

import {
    type DawProjectDeviceSource,
    type DawProjectImportWarning,
    type DawProjectMarker,
    type DawProjectParsedClip,
    type DawProjectParsedMidiNote,
    type DawProjectParsedTrack,
    type DawProjectTempoChange,
    type DawProjectTimeSignatureChange,
} from './dawProjectTypes';
import { DAW_PROJECT_XML_TAGS } from './dawProjectXmlTagNames';
import { parseXml } from './parse-xml';
import { wrap, type XmlQuery } from './xmlHelpers';

const {
    ARRANGEMENT,
    AUDIO,
    CHANNEL,
    CLIP,
    CLIPS,
    DEVICES,
    FILE,
    LANES,
    MARKER,
    MARKERS,
    MUTE,
    NOTE,
    NOTES,
    PAN,
    POINTS,
    PROJECT,
    REAL_POINT,
    SOLO,
    STRUCTURE,
    TEMPO,
    TIME_SIGNATURE,
    TIME_SIGNATURE_POINT,
    TRACK,
    TRANSPORT,
    VOLUME,
} = DAW_PROJECT_XML_TAGS;

type ParseContext = {
    /** Map from track XML id to our own stable id. */
    trackIdMap: Map<string, string>;
    /** Map from channel XML id (used in mixer / track `destination`) to track id. */
    channelToTrackId: Map<string, string>;
    /** Default time unit for nested timelines where the attribute is absent. */
    defaultTimeUnit: 'beats' | 'seconds';
    /** Initial tempo in bpm — used to convert seconds to beats when needed. */
    tempo: number;
    trackNames: Map<string, string>;
    elementOrder: Map<Element, number>;
    warnings: DawProjectImportWarning[];
};

export type ParsedProjectXml = {
    tracks: DawProjectParsedTrack[];
    tempoChanges: DawProjectTempoChange[];
    timeSignatureChanges: DawProjectTimeSignatureChange[];
    initialTempo: number;
    initialTimeSignature: { numerator: number; denominator: number };
    markers: DawProjectMarker[];
    warnings: DawProjectImportWarning[];
};

function warn(
    context: ParseContext,
    node: XmlQuery,
    kind: DawProjectImportWarning['kind'],
    name: string,
    owner: string,
    handling: DawProjectImportWarning['handling'] = 'dropped'
): void {
    context.warnings.push({
        kind,
        name,
        sourceType: node.element.tagName,
        sourceId: node.attr('id') ?? undefined,
        context: owner,
        handling,
        sourceOrder: context.elementOrder.get(node.element) ?? -1,
    });
}

const DEFAULT_COLOR_PALETTE = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

function pickFallbackColor(index: number): string {
    return DEFAULT_COLOR_PALETTE[index % DEFAULT_COLOR_PALETTE.length]!;
}

function toBeats(value: number, unit: 'beats' | 'seconds', tempo: number): number {
    if (unit === 'beats') {
        return value;
    }
    const safeTempo = tempo > 0 ? tempo : 120;
    return (value / 60) * safeTempo;
}

function readTimeUnit(node: XmlQuery, fallback: 'beats' | 'seconds'): 'beats' | 'seconds' {
    const raw = node.attr('timeUnit') ?? node.attr('contentTimeUnit');
    if (raw === 'beats' || raw === 'seconds') {
        return raw;
    }
    return fallback;
}

/** Unit of a clip's content-position attributes (`playStart`): the clip's own
 * `contentTimeUnit` when it declares one, otherwise the unit its timeline
 * positions already resolved against. */
function readContentTimeUnit(node: XmlQuery, fallback: 'beats' | 'seconds'): 'beats' | 'seconds' {
    const raw = node.attr('contentTimeUnit');
    if (raw === 'beats' || raw === 'seconds') {
        return raw;
    }
    return fallback;
}

function parseTransport(transport: XmlQuery | null): {
    tempo: number;
    numerator: number;
    denominator: number;
} {
    if (!transport) {
        return { tempo: 120, numerator: 4, denominator: 4 };
    }
    const tempoNode = transport.child(TEMPO);
    const tsNode = transport.child(TIME_SIGNATURE);
    const tempo = tempoNode?.attrNumber('value', DEFAULT_TEMPO_BPM) ?? DEFAULT_TEMPO_BPM;
    const numerator = tsNode?.attrNumber('numerator', 4) ?? 4;
    const denominator = tsNode?.attrNumber('denominator', 4) ?? 4;
    return { tempo, numerator, denominator };
}

function classifyTrackKind(track: XmlQuery, context: ParseContext, trackName: string): DawProjectParsedTrack['kind'] {
    // An explicit channel role wins over `contentType`. A bus carries
    // contentType="audio" — that is what audio flows through it — so reading
    // contentType first classified every bus as a plain audio track and lost
    // the role on every round-trip (audit M-261).
    const groupType = track.attr('type');
    if (groupType === 'masterChannel' || track.attr('master') === 'true') {
        return 'master';
    }
    if (groupType === 'bus') {
        return 'bus';
    }
    const role = track.attr('contentType') ?? '';
    const loweredRole = role.toLowerCase();
    if (loweredRole.includes('audio')) {
        return 'audio';
    }
    if (loweredRole.includes('notes') || loweredRole.includes('midi')) {
        return 'midi';
    }
    const hasChildTrack = track.children(TRACK).length > 0;
    if (hasChildTrack) {
        return 'folder';
    }
    if (groupType || role) {
        warn(context, track, 'unsupported-track-type', `${groupType ?? role}: ${trackName}`, trackName, 'substituted');
    }
    return 'audio';
}

function parseChannelInfo(
    channel: XmlQuery | null,
    context: ParseContext
): {
    volume: number;
    pan: number;
    mute: boolean;
    solo: boolean;
    deviceTypes: string[];
    deviceSources: DawProjectDeviceSource[];
} {
    if (!channel) {
        return { volume: 0.8, pan: 0, mute: false, solo: false, deviceTypes: [], deviceSources: [] };
    }
    const volumeNode = channel.child(VOLUME);
    const panNode = channel.child(PAN);
    const muteNode = channel.child(MUTE);
    const soloNode = channel.child(SOLO);
    const volume = volumeNode?.attrNumber('value', 0.8) ?? 0.8;
    const pan = panNode?.attrNumber('value', 0.5) ?? 0.5;
    const mute = muteNode?.attrBool('value', false) ?? false;
    const solo = soloNode?.attrBool('value', false) ?? false;

    const devicesNode = channel.child(DEVICES);
    const deviceTypes: string[] = [];
    const deviceSources: DawProjectDeviceSource[] = [];
    if (devicesNode) {
        for (const device of devicesNode.children()) {
            const deviceRole = device.attr('deviceRole') ?? device.attr('role') ?? device.element.tagName;
            deviceTypes.push(deviceRole.toLowerCase());
            deviceSources.push({
                name: device.attr('deviceName') ?? device.attr('name') ?? deviceRole,
                sourceType: device.element.tagName,
                sourceId: device.attr('id') ?? device.attr('deviceID') ?? undefined,
                sourceOrder: context.elementOrder.get(device.element) ?? -1,
                hasSettings: device.children().length > 0,
            });
        }
    }

    return {
        volume,
        pan: pan * 2 - 1,
        mute,
        solo,
        deviceTypes,
        deviceSources,
    };
}

function parseNotesNode(
    notes: XmlQuery,
    unit: 'beats' | 'seconds',
    context: ParseContext,
    clipName: string
): DawProjectParsedMidiNote[] {
    const result: DawProjectParsedMidiNote[] = [];
    for (const note of notes.children(NOTE)) {
        const key = note.attrNumber('key', -1);
        if (key < 0) {
            warn(context, note, 'invalid-note', note.attr('name') ?? `key ${note.attr('key') ?? 'missing'}`, clipName);
            continue;
        }
        const rawStart = note.attrNumber('time', 0);
        const rawDuration = note.attrNumber('duration', 0.25);
        const velRaw = note.attrNumber('vel', 0.787);
        result.push({
            pitch: key,
            startBeat: toBeats(rawStart, unit, context.tempo),
            duration: toBeats(rawDuration, unit, context.tempo),
            velocity: Math.round(Math.max(0, Math.min(1, velRaw)) * 127),
        });
    }
    return result;
}

function resolveAudioAssetPath(clip: XmlQuery): string | undefined {
    // `<Warps>` is a foreign-writer variant of `<Audio>` the writer never
    // emits, so it stays inline rather than joining the shared tag map.
    const audioNode = clip.child(AUDIO) ?? clip.child('Warps')?.child(AUDIO) ?? null;
    if (!audioNode) {
        return undefined;
    }
    const fileNode = audioNode.child(FILE);
    const path = fileNode?.attr('path') ?? audioNode.attr('file') ?? audioNode.attr('path') ?? null;
    return path ?? undefined;
}

function parseClip(
    clip: XmlQuery,
    ownerKind: DawProjectParsedTrack['kind'],
    parentUnit: 'beats' | 'seconds',
    context: ParseContext,
    index: number,
    trackName: string
): DawProjectParsedClip | null {
    // `time` and `duration` read in the clip's timeline unit: its own
    // `timeUnit` attribute or the enclosing scope's. The generic
    // `readTimeUnit` also accepts `contentTimeUnit`, which the DAWproject
    // Reference scopes to the content positions (`playStart`, `playStop`) —
    // letting it decide the timeline unit reads a beats-positioned window of a
    // seconds-content clip as if it were seconds.
    const rawUnit = clip.attr('timeUnit');
    const unit = rawUnit === 'beats' || rawUnit === 'seconds' ? rawUnit : parentUnit;
    const rawStart = clip.attrNumber('time', 0);
    const contentUnit = readContentTimeUnit(clip, unit);
    const explicitDuration = clip.attr('duration');
    // An omitted duration is the content window `playStop - playStart` in the
    // content unit; an explicit `duration` reads in the timeline unit like
    // `time`. Absent endpoints default to 0, so a clip carrying neither infers
    // a length of 0.
    const rawDuration =
        explicitDuration === null
            ? Math.max(0, clip.attrNumber('playStop', 0) - clip.attrNumber('playStart', 0))
            : clip.attrNumber('duration', 0);

    const durationUnit = explicitDuration === null ? contentUnit : unit;
    const startBeat = toBeats(rawStart, unit, context.tempo);
    const endBeat = startBeat + toBeats(Math.max(0, rawDuration), durationUnit, context.tempo);
    const name = clip.attr('name') ?? `Clip ${String(index + 1)}`;
    const id = `clip-${crypto.randomUUID()}`;
    const source = { sourceId: clip.attr('id') ?? undefined, sourceOrder: context.elementOrder.get(clip.element) };
    // `playStart` is where the clip starts reading its media, in content time.
    // Kept whenever it differs from the default 0 — negative is the slip of a
    // clip left of its media start.
    const playStartBeat = toBeats(clip.attrNumber('playStart', 0), contentUnit, context.tempo);
    const playStart = playStartBeat !== 0 ? { playStartBeat } : {};

    const notesNode = clip.child(NOTES);
    if (notesNode) {
        return {
            id,
            ...source,
            name,
            startBeat,
            endBeat: Math.max(endBeat, startBeat + 0.25),
            type: 'midi',
            // Notes are clip content: per the DAWproject Reference,
            // contentTimeUnit governs the content while `time` and `duration`
            // stay in the timeline unit. A Notes `timeUnit` attribute still
            // wins via readTimeUnit.
            notes: parseNotesNode(notesNode, readTimeUnit(notesNode, contentUnit), context, `${trackName} / ${name}`),
            ...playStart,
        };
    }

    const assetPath = resolveAudioAssetPath(clip);
    if (assetPath) {
        return {
            id,
            ...source,
            name,
            startBeat,
            endBeat: Math.max(endBeat, startBeat + 0.25),
            type: 'audio',
            audioAssetPath: assetPath,
            ...playStart,
        };
    }

    if (ownerKind === 'midi') {
        return {
            id,
            ...source,
            name,
            startBeat,
            endBeat: Math.max(endBeat, startBeat + 0.25),
            type: 'midi',
            notes: [],
            ...playStart,
        };
    }

    warn(context, clip, 'unsupported-clip', name, trackName);
    return null;
}

function parseTrack(
    track: XmlQuery,
    parentId: string | null,
    index: number,
    context: ParseContext
): {
    track: DawProjectParsedTrack;
    children: XmlQuery[];
} {
    const xmlId = track.attr('id') ?? `track-${String(index)}`;
    const trackName = track.attr('name') ?? `Track ${String(index + 1)}`;
    const stableId = `track-${crypto.randomUUID()}`;
    context.trackIdMap.set(xmlId, stableId);
    context.trackNames.set(xmlId, trackName);

    const channel = track.child(CHANNEL);
    if (channel) {
        const channelId = channel.attr('id');
        if (channelId) {
            context.channelToTrackId.set(channelId, stableId);
            context.trackNames.set(channelId, trackName);
        }
    }

    const kind = classifyTrackKind(track, context, trackName);
    const channelInfo = parseChannelInfo(channel, context);
    const colorAttr = track.attr('color');
    const color = colorAttr && colorAttr.startsWith('#') ? colorAttr : pickFallbackColor(index);

    const parsed: DawProjectParsedTrack = {
        id: stableId,
        name: trackName,
        kind,
        color,
        parentId,
        volume: channelInfo.volume,
        pan: channelInfo.pan,
        mute: channelInfo.mute,
        solo: channelInfo.solo,
        clips: [],
        deviceTypes: channelInfo.deviceTypes,
        deviceSources: channelInfo.deviceSources,
    };

    return { track: parsed, children: track.children(TRACK) };
}

function parseStructure(structure: XmlQuery, context: ParseContext): DawProjectParsedTrack[] {
    const flat: DawProjectParsedTrack[] = [];

    type QueueEntry = { node: XmlQuery; parentId: string | null };
    const queue: QueueEntry[] = structure.children(TRACK).map((node) => ({ node, parentId: null }));

    let index = 0;
    while (queue.length > 0) {
        const entry = queue.shift();
        if (!entry) {
            break;
        }
        const { track, children } = parseTrack(entry.node, entry.parentId, index, context);
        flat.push(track);
        for (const child of children) {
            queue.push({ node: child, parentId: track.id });
        }
        index++;
    }
    return flat;
}

function parseTempoAutomation(point: XmlQuery, unit: 'beats' | 'seconds', tempo: number): DawProjectTempoChange {
    return {
        beat: toBeats(point.attrNumber('time', 0), unit, tempo),
        tempo: point.attrNumber('value', tempo),
        curve: point.attr('interpolation') === 'linear' ? 'linear' : 'instant',
    };
}

function parseTsAutomation(point: XmlQuery, unit: 'beats' | 'seconds', tempo: number): DawProjectTimeSignatureChange {
    return {
        beat: toBeats(point.attrNumber('time', 0), unit, tempo),
        numerator: point.attrNumber('numerator', 4),
        denominator: point.attrNumber('denominator', 4),
    };
}

function parseMasterTrackAutomation(
    arrangement: XmlQuery,
    context: ParseContext
): { tempoChanges: DawProjectTempoChange[]; timeSignatureChanges: DawProjectTimeSignatureChange[] } {
    const tempoChanges: DawProjectTempoChange[] = [];
    const timeSignatureChanges: DawProjectTimeSignatureChange[] = [];

    for (const direct of arrangement.children()) {
        if (
            (direct.element.tagName === 'TempoAutomation' || direct.element.tagName === 'TimeSignatureAutomation') &&
            direct.children().length > 0
        ) {
            warn(
                context,
                direct,
                'unsupported-automation',
                direct.attr('name') ?? direct.element.tagName,
                'Arrangement'
            );
        }
    }

    const lanesRoot = arrangement.child(LANES);
    if (!lanesRoot) {
        return { tempoChanges, timeSignatureChanges };
    }

    const containerUnit = readTimeUnit(lanesRoot, context.defaultTimeUnit);

    function walkAutomation(node: XmlQuery, unit: 'beats' | 'seconds'): void {
        for (const child of node.children()) {
            const childUnit = readTimeUnit(child, unit);
            const target = child.attr('target');
            // `<Automation>` is a foreign-writer sibling of `<Points>` the
            // writer never emits, so it stays inline rather than joining the
            // shared tag map.
            if (child.element.tagName === POINTS || child.element.tagName === 'Automation') {
                if (target === 'tempo') {
                    for (const point of child.children(REAL_POINT)) {
                        tempoChanges.push(parseTempoAutomation(point, childUnit, context.tempo));
                    }
                    for (const point of child
                        .children()
                        .filter(
                            (entry) =>
                                entry.element.tagName !== REAL_POINT &&
                                entry.element.tagName !== POINTS &&
                                entry.element.tagName !== 'Target'
                        )) {
                        warn(
                            context,
                            point,
                            'unsupported-automation',
                            child.attr('name') ?? 'Tempo automation',
                            'Arrangement'
                        );
                    }
                } else if (target === 'timeSignature') {
                    for (const point of child.children(TIME_SIGNATURE_POINT)) {
                        timeSignatureChanges.push(parseTsAutomation(point, childUnit, context.tempo));
                    }
                    for (const point of child
                        .children()
                        .filter(
                            (entry) =>
                                entry.element.tagName !== TIME_SIGNATURE_POINT &&
                                entry.element.tagName !== POINTS &&
                                entry.element.tagName !== 'Target'
                        )) {
                        warn(
                            context,
                            point,
                            'unsupported-automation',
                            child.attr('name') ?? 'Time signature automation',
                            'Arrangement'
                        );
                    }
                } else {
                    const targetNode = child.child('Target');
                    const targetName =
                        targetNode?.attr('parameter') ?? targetNode?.attr('expression') ?? target ?? null;
                    const trackRef = child.attr('track') ?? child.attr('channel');
                    const owner = (trackRef && context.trackNames.get(trackRef)) ?? 'Arrangement';
                    warn(
                        context,
                        child,
                        'unsupported-automation',
                        child.attr('name') ?? targetName ?? 'Automation',
                        owner
                    );
                    // A foreign Automation wrapper may contain supported Points.
                    if (child.element.tagName === POINTS) {
                        continue;
                    }
                }
            }
            walkAutomation(child, childUnit);
        }
    }

    walkAutomation(lanesRoot, containerUnit);
    return { tempoChanges, timeSignatureChanges };
}

function parseArrangementClips(arrangement: XmlQuery, tracks: DawProjectParsedTrack[], context: ParseContext): void {
    const trackById = new Map(tracks.map((track) => [track.id, track] as const));
    function resolveTrackId(candidate: string | null): string | null {
        if (candidate === null) {
            return null;
        }
        if (context.trackIdMap.has(candidate)) {
            return context.trackIdMap.get(candidate) ?? null;
        }
        if (context.channelToTrackId.has(candidate)) {
            return context.channelToTrackId.get(candidate) ?? null;
        }
        return null;
    }

    const lanesRoot = arrangement.child(LANES);
    if (!lanesRoot) {
        return;
    }

    const containerUnit = readTimeUnit(lanesRoot, context.defaultTimeUnit);

    function walkClips(node: XmlQuery, unit: 'beats' | 'seconds', clipMediaHandled = false): void {
        for (const laneOrClips of node.children()) {
            const laneUnit = readTimeUnit(laneOrClips, unit);
            if (laneOrClips.element.tagName === AUDIO || laneOrClips.element.tagName === 'Video') {
                if (!clipMediaHandled) {
                    const trackRef = laneOrClips.attr('track') ?? laneOrClips.attr('channel');
                    const owner = (trackRef && context.trackNames.get(trackRef)) ?? trackRef ?? 'Arrangement';
                    const name =
                        laneOrClips.attr('name') ??
                        laneOrClips.child(FILE)?.attr('path') ??
                        laneOrClips.element.tagName;
                    warn(context, laneOrClips, 'unsupported-clip', name, owner);
                }
                continue;
            }
            if (laneOrClips.element.tagName === CLIPS) {
                const targetAttr = laneOrClips.attr('track') ?? laneOrClips.attr('channel');
                const targetTrackId = resolveTrackId(targetAttr);
                const target = targetTrackId ? trackById.get(targetTrackId) : null;
                if (target) {
                    const clipNodes = laneOrClips.children(CLIP);
                    for (let index = 0; index < clipNodes.length; index++) {
                        const clipNode = clipNodes[index]!;
                        const clip = parseClip(clipNode, target.kind, laneUnit, context, index, target.name);
                        if (clip) {
                            target.clips.push(clip);
                        }
                    }
                } else {
                    for (const clipNode of laneOrClips.children(CLIP)) {
                        const owner = targetAttr
                            ? (context.trackNames.get(targetAttr) ?? targetAttr)
                            : 'Unassigned lane';
                        warn(context, clipNode, 'unsupported-clip', clipNode.attr('name') ?? 'Clip', owner);
                    }
                }
            }
            const childMediaHandled =
                laneOrClips.element.tagName === CLIP ||
                (node.element.tagName === CLIP && laneOrClips.element.tagName === 'Warps');
            walkClips(laneOrClips, laneUnit, childMediaHandled);
        }
    }

    walkClips(lanesRoot, containerUnit);
}

function parseMarkers(arrangement: XmlQuery, unit: 'beats' | 'seconds', tempo: number): DawProjectMarker[] {
    const markers: DawProjectMarker[] = [];
    const markersNode = arrangement.child(MARKERS);
    if (!markersNode) {
        return markers;
    }
    for (const marker of markersNode.children(MARKER)) {
        const beat = toBeats(marker.attrNumber('time', 0), unit, tempo);
        markers.push({ beat, name: marker.attr('name') ?? 'Marker' });
    }
    return markers;
}

export function parseProjectXml(xml: string): ParsedProjectXml {
    const doc = parseXml(xml);
    const rootElement = doc.documentElement;
    if (!rootElement || rootElement.tagName !== PROJECT) {
        throw new Error(`Expected root <${PROJECT}> element, got <${rootElement?.tagName ?? 'null'}>`);
    }
    const root = wrap(rootElement);

    const transport = parseTransport(root.child(TRANSPORT));
    const context: ParseContext = {
        trackIdMap: new Map(),
        channelToTrackId: new Map(),
        defaultTimeUnit: 'beats',
        tempo: transport.tempo,
        trackNames: new Map(),
        elementOrder: new Map(Array.from(rootElement.getElementsByTagName('*')).map((node, index) => [node, index])),
        warnings: [],
    };

    const structureNode = root.child(STRUCTURE);
    const tracks = structureNode ? parseStructure(structureNode, context) : [];

    const arrangementNode = root.child(ARRANGEMENT);
    let tempoChanges: DawProjectTempoChange[] = [];
    let timeSignatureChanges: DawProjectTimeSignatureChange[] = [];
    let markers: DawProjectMarker[] = [];

    if (arrangementNode) {
        context.defaultTimeUnit = readTimeUnit(arrangementNode, 'beats');
        const automation = parseMasterTrackAutomation(arrangementNode, context);
        tempoChanges = automation.tempoChanges;
        timeSignatureChanges = automation.timeSignatureChanges;
        parseArrangementClips(arrangementNode, tracks, context);
        markers = parseMarkers(arrangementNode, context.defaultTimeUnit, context.tempo);
    }

    return {
        tracks,
        tempoChanges,
        timeSignatureChanges,
        initialTempo: transport.tempo,
        initialTimeSignature: { numerator: transport.numerator, denominator: transport.denominator },
        markers,
        warnings: context.warnings,
    };
}
