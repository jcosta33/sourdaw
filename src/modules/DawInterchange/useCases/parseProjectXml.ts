import {
    type DawProjectMarker,
    type DawProjectParsedClip,
    type DawProjectParsedMidiNote,
    type DawProjectParsedTrack,
    type DawProjectTempoChange,
    type DawProjectTimeSignatureChange,
} from './dawProjectTypes';
import { parseXml } from './parse-xml';
import { wrap, type XmlQuery } from './xmlHelpers';

type ParseContext = {
    /** Map from track XML id to our own stable id. */
    trackIdMap: Map<string, string>;
    /** Map from channel XML id (used in mixer / track `destination`) to track id. */
    channelToTrackId: Map<string, string>;
    /** Default time unit for nested timelines where the attribute is absent. */
    defaultTimeUnit: 'beats' | 'seconds';
    /** Initial tempo in bpm — used to convert seconds to beats when needed. */
    tempo: number;
};

export type ParsedProjectXml = {
    tracks: DawProjectParsedTrack[];
    tempoChanges: DawProjectTempoChange[];
    timeSignatureChanges: DawProjectTimeSignatureChange[];
    initialTempo: number;
    initialTimeSignature: { numerator: number; denominator: number };
    markers: DawProjectMarker[];
};

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

function parseTransport(transport: XmlQuery | null): {
    tempo: number;
    numerator: number;
    denominator: number;
} {
    if (!transport) {
        return { tempo: 120, numerator: 4, denominator: 4 };
    }
    const tempoNode = transport.child('Tempo');
    const tsNode = transport.child('TimeSignature');
    const tempo = tempoNode?.attrNumber('value', 120) ?? 120;
    const numerator = tsNode?.attrNumber('numerator', 4) ?? 4;
    const denominator = tsNode?.attrNumber('denominator', 4) ?? 4;
    return { tempo, numerator, denominator };
}

function classifyTrackKind(track: XmlQuery): DawProjectParsedTrack['kind'] {
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
    const hasChildTrack = track.children('Track').length > 0;
    if (hasChildTrack) {
        return 'folder';
    }
    return 'audio';
}

function parseChannelInfo(channel: XmlQuery | null): {
    volume: number;
    pan: number;
    mute: boolean;
    solo: boolean;
    deviceTypes: string[];
} {
    if (!channel) {
        return { volume: 0.8, pan: 0, mute: false, solo: false, deviceTypes: [] };
    }
    const volumeNode = channel.child('Volume');
    const panNode = channel.child('Pan');
    const muteNode = channel.child('Mute');
    const soloNode = channel.child('Solo');
    const volume = volumeNode?.attrNumber('value', 0.8) ?? 0.8;
    const pan = panNode?.attrNumber('value', 0.5) ?? 0.5;
    const mute = muteNode?.attrBool('value', false) ?? false;
    const solo = soloNode?.attrBool('value', false) ?? false;

    const devicesNode = channel.child('Devices');
    const deviceTypes: string[] = [];
    if (devicesNode) {
        for (const device of devicesNode.children()) {
            const deviceRole = device.attr('deviceRole') ?? device.attr('role') ?? device.element.tagName;
            deviceTypes.push(deviceRole.toLowerCase());
        }
    }

    return {
        volume,
        pan: pan * 2 - 1,
        mute,
        solo,
        deviceTypes,
    };
}

function parseNotesNode(notes: XmlQuery, unit: 'beats' | 'seconds', tempo: number): DawProjectParsedMidiNote[] {
    const result: DawProjectParsedMidiNote[] = [];
    for (const note of notes.children('Note')) {
        const key = note.attrNumber('key', -1);
        if (key < 0) {
            continue;
        }
        const rawStart = note.attrNumber('time', 0);
        const rawDuration = note.attrNumber('duration', 0.25);
        const velRaw = note.attrNumber('vel', 0.787);
        result.push({
            pitch: key,
            startBeat: toBeats(rawStart, unit, tempo),
            duration: toBeats(rawDuration, unit, tempo),
            velocity: Math.round(Math.max(0, Math.min(1, velRaw)) * 127),
        });
    }
    return result;
}

function resolveAudioAssetPath(clip: XmlQuery): string | undefined {
    const audioNode = clip.child('Audio') ?? clip.child('Warps')?.child('Audio') ?? null;
    if (!audioNode) {
        return undefined;
    }
    const fileNode = audioNode.child('File');
    const path = fileNode?.attr('path') ?? audioNode.attr('file') ?? audioNode.attr('path') ?? null;
    return path ?? undefined;
}

function parseClip(
    clip: XmlQuery,
    ownerKind: DawProjectParsedTrack['kind'],
    parentUnit: 'beats' | 'seconds',
    context: ParseContext,
    index: number
): DawProjectParsedClip | null {
    const unit = readTimeUnit(clip, parentUnit);
    const rawStart = clip.attrNumber('time', 0);
    const explicitDuration = clip.attr('duration');
    const rawDuration =
        explicitDuration === null
            ? Math.max(0, clip.attrNumber('playStop', rawStart) - rawStart)
            : clip.attrNumber('duration', 0);

    const startBeat = toBeats(rawStart, unit, context.tempo);
    const endBeat = startBeat + toBeats(Math.max(0, rawDuration), unit, context.tempo);
    const name = clip.attr('name') ?? `Clip ${String(index + 1)}`;
    const id = `clip-${crypto.randomUUID()}`;

    const notesNode = clip.child('Notes');
    if (notesNode) {
        return {
            id,
            name,
            startBeat,
            endBeat: Math.max(endBeat, startBeat + 0.25),
            type: 'midi',
            notes: parseNotesNode(notesNode, readTimeUnit(notesNode, unit), context.tempo),
        };
    }

    const assetPath = resolveAudioAssetPath(clip);
    if (assetPath) {
        return {
            id,
            name,
            startBeat,
            endBeat: Math.max(endBeat, startBeat + 0.25),
            type: 'audio',
            audioAssetPath: assetPath,
        };
    }

    if (ownerKind === 'midi') {
        return {
            id,
            name,
            startBeat,
            endBeat: Math.max(endBeat, startBeat + 0.25),
            type: 'midi',
            notes: [],
        };
    }

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
    const stableId = `track-${crypto.randomUUID()}`;
    context.trackIdMap.set(xmlId, stableId);

    const channel = track.child('Channel');
    if (channel) {
        const channelId = channel.attr('id');
        if (channelId) {
            context.channelToTrackId.set(channelId, stableId);
        }
    }

    const kind = classifyTrackKind(track);
    const channelInfo = parseChannelInfo(channel);
    const colorAttr = track.attr('color');
    const color = colorAttr && colorAttr.startsWith('#') ? colorAttr : pickFallbackColor(index);

    const parsed: DawProjectParsedTrack = {
        id: stableId,
        name: track.attr('name') ?? `Track ${String(index + 1)}`,
        kind,
        color,
        parentId,
        volume: channelInfo.volume,
        pan: channelInfo.pan,
        mute: channelInfo.mute,
        solo: channelInfo.solo,
        clips: [],
        deviceTypes: channelInfo.deviceTypes,
    };

    return { track: parsed, children: track.children('Track') };
}

function parseStructure(structure: XmlQuery, context: ParseContext): DawProjectParsedTrack[] {
    const flat: DawProjectParsedTrack[] = [];

    type QueueEntry = { node: XmlQuery; parentId: string | null };
    const queue: QueueEntry[] = structure.children('Track').map((node) => ({ node, parentId: null }));

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

    const lanesRoot = arrangement.child('Lanes');
    if (!lanesRoot) {
        return { tempoChanges, timeSignatureChanges };
    }

    const containerUnit = readTimeUnit(lanesRoot, context.defaultTimeUnit);

    function walkAutomation(node: XmlQuery, unit: 'beats' | 'seconds'): void {
        for (const child of node.children()) {
            const childUnit = readTimeUnit(child, unit);
            const target = child.attr('target');
            if (child.element.tagName === 'Points' || child.element.tagName === 'Automation') {
                if (target === 'tempo') {
                    for (const point of child.children('RealPoint')) {
                        tempoChanges.push(parseTempoAutomation(point, childUnit, context.tempo));
                    }
                } else if (target === 'timeSignature') {
                    for (const point of child.children('TimeSignaturePoint')) {
                        timeSignatureChanges.push(parseTsAutomation(point, childUnit, context.tempo));
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

    const lanesRoot = arrangement.child('Lanes');
    if (!lanesRoot) {
        return;
    }

    const containerUnit = readTimeUnit(lanesRoot, context.defaultTimeUnit);

    function walkClips(node: XmlQuery, unit: 'beats' | 'seconds'): void {
        for (const laneOrClips of node.children()) {
            const laneUnit = readTimeUnit(laneOrClips, unit);
            if (laneOrClips.element.tagName === 'Clips') {
                const targetAttr = laneOrClips.attr('track') ?? laneOrClips.attr('channel');
                const targetTrackId = resolveTrackId(targetAttr);
                const target = targetTrackId ? trackById.get(targetTrackId) : null;
                if (target) {
                    const clipNodes = laneOrClips.children('Clip');
                    for (let index = 0; index < clipNodes.length; index++) {
                        const clipNode = clipNodes[index]!;
                        const clip = parseClip(clipNode, target.kind, laneUnit, context, index);
                        if (clip) {
                            target.clips.push(clip);
                        }
                    }
                }
            }
            walkClips(laneOrClips, laneUnit);
        }
    }

    walkClips(lanesRoot, containerUnit);
}

function parseMarkers(arrangement: XmlQuery, unit: 'beats' | 'seconds', tempo: number): DawProjectMarker[] {
    const markers: DawProjectMarker[] = [];
    const markersNode = arrangement.child('Markers');
    if (!markersNode) {
        return markers;
    }
    for (const marker of markersNode.children('Marker')) {
        const beat = toBeats(marker.attrNumber('time', 0), unit, tempo);
        markers.push({ beat, name: marker.attr('name') ?? 'Marker' });
    }
    return markers;
}

export function parseProjectXml(xml: string): ParsedProjectXml {
    const doc = parseXml(xml);
    const rootElement = doc.documentElement;
    if (!rootElement || rootElement.tagName !== 'Project') {
        throw new Error(`Expected root <Project> element, got <${rootElement?.tagName ?? 'null'}>`);
    }
    const root = wrap(rootElement);

    const transport = parseTransport(root.child('Transport'));
    const context: ParseContext = {
        trackIdMap: new Map(),
        channelToTrackId: new Map(),
        defaultTimeUnit: 'beats',
        tempo: transport.tempo,
    };

    const structureNode = root.child('Structure');
    const tracks = structureNode ? parseStructure(structureNode, context) : [];

    const arrangementNode = root.child('Arrangement');
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
    };
}
