import { DEFAULT_TEMPO_BPM, MAX_TEMPO, MIN_TEMPO } from '#/modules/Transport/stores';
import { resolveTempoAtBeat, secondsBetweenBeats } from '#/modules/Transport/useCases';
import { clampFaderGain } from '#/utils/audioLevelLaw';

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

// Match the owning Transport tempo-map store; its model bounds are private to that module.
const MIN_TEMPO_MAP_BPM = 20;
const MAX_TEMPO_MAP_BPM = 999;
const LOOP_ROUNDOFF_TOLERANCE_BEATS = 1e-9;

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
    channels: { node: XmlQuery; owner: string; kind: DawProjectParsedTrack['kind'] }[];
    rejectedContents: { node: XmlQuery; owner: string }[];
    secondsPositions: { node: XmlQuery; name: string; owner: string; seconds: number; beat: number; detail: string }[];
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
    handling: DawProjectImportWarning['handling'] = 'dropped',
    details?: string[]
): void {
    const sourceOrder = context.elementOrder.get(node.element) ?? -1;
    const existing = context.warnings.find((warning) => warning.sourceOrder === sourceOrder);
    if (existing) {
        if (handling === 'dropped' && existing.handling !== 'dropped') {
            existing.kind = kind;
            existing.handling = 'dropped';
            delete existing.details;
        }
        if (handling === 'partial' && existing.handling !== 'dropped') {
            const existingDetails = existing.details ?? [];
            const newDetails = details ?? [];
            existing.details = [...new Set([...existingDetails, ...newDetails])];
        }
        return;
    }
    const warning: DawProjectImportWarning = {
        kind,
        name,
        sourceType: node.element.tagName,
        sourceId: node.attr('id') ?? undefined,
        context: owner,
        handling,
        sourceOrder,
    };
    if (details) {
        warning.details = details;
    }
    context.warnings.push(warning);
}

function warnNamedDescendants(
    context: ParseContext,
    node: XmlQuery,
    owner: string,
    retainedClips = new Set<number>(),
    contentCovered = [CLIP, NOTE, POINTS, 'TempoAutomation', 'TimeSignatureAutomation', 'Warps'].includes(
        node.element.tagName
    )
): void {
    for (const child of node.children()) {
        const order = context.elementOrder.get(child.element) ?? -1;
        const tag = child.element.tagName;
        if (tag === CLIP && retainedClips.has(order)) {
            continue;
        }
        const rawName = child.attr('name') ?? child.attr('deviceName');
        const name = rawName?.trim() ? rawName : null;
        const clip = tag === CLIP;
        const semanticContent = [NOTES, AUDIO, 'Video', POINTS, 'Warps', MARKER].includes(tag);
        const device = node.element.tagName === DEVICES;
        const independent =
            clip ||
            device ||
            tag === 'Send' ||
            (tag === 'ClipSlot' &&
                ((child.attrBool('hasStop', false) && child.child(CLIP) === null) ||
                    Boolean(child.attr('color')) ||
                    Boolean(child.attr('comment'))));
        const report = name !== null || independent || (semanticContent && !contentCovered);
        let childOwner = owner;
        if (report) {
            const label = name ?? tag;
            if (!context.warnings.some((warning) => warning.sourceOrder === order)) {
                warn(context, child, 'unsupported-element', label, owner);
            }
            childOwner = label;
        }
        warnNamedDescendants(context, child, childOwner, retainedClips, contentCovered || clip || semanticContent);
    }
}

function warnTimelineMetadata(context: ParseContext, node: XmlQuery, owner: string, defaultName?: string): void {
    const details: string[] = [];
    const name = node.attr('name');
    if (name?.trim() && name !== node.element.tagName && name !== owner && name !== defaultName) {
        details.push('timeline name');
    }
    if (node.attr('color')) {
        details.push('timeline color');
    }
    if (node.attr('comment')) {
        details.push('timeline comment');
    }
    if (details.length > 0) {
        warn(context, node, 'unsupported-element', name ?? node.element.tagName, owner, 'partial', details);
    }
}

function hasMixerBounds(node: XmlQuery): boolean {
    const tag = node.element.tagName;
    if (tag !== VOLUME && tag !== PAN) {
        return false;
    }
    const unit = node.attr('unit');
    const normalizedPan = tag === PAN && (unit === null || unit === 'linear' || unit === 'normalized');
    return ['min', 'max'].some((name) => {
        const raw = node.attr(name);
        if (raw === null) {
            return false;
        }
        const defaultBound = name === 'min' ? 0 : 1;
        return !normalizedPan || raw.trim() === '' || Number(raw) !== defaultBound;
    });
}

function warnParameterMetadata(context: ParseContext, node: XmlQuery | null, owner: string, units: string[]): void {
    if (!node) {
        return;
    }
    const details: string[] = [];
    const name = node.attr('name');
    if (name && name !== node.element.tagName) {
        details.push('parameter name');
    }
    if (node.attr('color')) {
        details.push('parameter color');
    }
    if (node.attr('comment')) {
        details.push('parameter comment');
    }
    const unit = node.attr('unit');
    if (unit && !units.includes(unit)) {
        details.push('parameter unit');
    }
    if (hasMixerBounds(node)) {
        details.push('parameter bounds');
    }
    const value = node.attrNumber('value', 0);
    const rawValue = node.attr('value');
    if (
        (node.element.tagName === VOLUME || node.element.tagName === PAN) &&
        rawValue !== null &&
        (rawValue.trim() === '' || !Number.isFinite(node.attrNumber('value', Number.NaN)))
    ) {
        details.push('invalid parameter value');
    }
    if (node.element.tagName === VOLUME && clampFaderGain(value) !== value) {
        details.push('volume range');
    }
    if (node.element.tagName === PAN && (value < 0 || value > 1)) {
        details.push('pan range');
    }
    if (details.length > 0) {
        warn(context, node, 'unsupported-element', name ?? node.element.tagName, owner, 'partial', details);
    }
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

type TimelineUnit = 'beats' | 'seconds';

type ClipTiming = {
    startBeat: number;
    endBeat: number;
    contentUnit: TimelineUnit;
    playStartBeat: number;
    visibleDurationBeat: number | null;
    visibleEndBeat: number | null;
    tempo: number;
};

function readClipTiming(
    clip: XmlQuery,
    parentUnit: TimelineUnit,
    originBeat: number,
    tempo: number,
    contentTempo = tempo
): ClipTiming {
    // A Clip's time is on its parent timeline. Its contentTimeUnit applies to
    // the timeline inside the Clip and to playStart/playStop instead.
    const rawUnit = clip.attr('timeUnit');
    const unit = rawUnit === 'beats' || rawUnit === 'seconds' ? rawUnit : parentUnit;
    const contentUnit = readContentTimeUnit(clip, unit);
    const explicitDuration = clip.attr('duration');
    const playStop = clip.attr('playStop');
    const rawDuration =
        explicitDuration === null
            ? Math.max(0, clip.attrNumber('playStop', 0) - clip.attrNumber('playStart', 0))
            : clip.attrNumber('duration', 0);
    const durationUnit = explicitDuration === null ? contentUnit : unit;
    const startBeat = originBeat + toBeats(clip.attrNumber('time', 0), unit, tempo);
    const durationBeat = toBeats(
        Math.max(0, rawDuration),
        durationUnit,
        explicitDuration === null ? contentTempo : tempo
    );
    const endBeat = startBeat + durationBeat;
    const playStartBeat = toBeats(clip.attrNumber('playStart', 0), contentUnit, contentTempo);
    const visibleDurationBeat =
        explicitDuration === null && playStop === null
            ? null
            : Math.min(
                  durationBeat,
                  playStop === null
                      ? durationBeat
                      : toBeats(clip.attrNumber('playStop', 0), contentUnit, contentTempo) - playStartBeat
              );
    const contentOriginBeat = startBeat - playStartBeat;
    const visibleEndBeat =
        explicitDuration === null && playStop === null
            ? null
            : Math.min(
                  endBeat,
                  playStop === null
                      ? endBeat
                      : contentOriginBeat + toBeats(clip.attrNumber('playStop', 0), contentUnit, contentTempo)
              );
    return { startBeat, endBeat, contentUnit, playStartBeat, visibleDurationBeat, visibleEndBeat, tempo: contentTempo };
}

function consumerTempo(tempo: number): number {
    if (Number.isFinite(tempo) && tempo >= MIN_TEMPO && tempo <= MAX_TEMPO) {
        return tempo;
    }
    return DEFAULT_TEMPO_BPM;
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

function hasDeviceSettings(device: XmlQuery): boolean {
    for (const child of device.children()) {
        if (child.element.tagName === 'Enabled') {
            if (!child.attrBool('value', true)) {
                return true;
            }
        } else if (child.element.tagName === 'Parameters') {
            if (child.children().length > 0) {
                return true;
            }
        } else {
            return true;
        }
    }
    return false;
}

function parseChannelInfo(
    channel: XmlQuery | null,
    context: ParseContext,
    trackName: string,
    kind: DawProjectParsedTrack['kind']
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
    context.channels.push({ node: channel, owner: trackName, kind });
    for (const send of channel.child('Sends')?.children('Send') ?? []) {
        warn(context, send, 'unsupported-element', send.attr('name') ?? 'Send', trackName);
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
                hasSettings: hasDeviceSettings(device),
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

function isValidMidiKey(key: number): boolean {
    return Number.isInteger(key) && key >= 0 && key <= 127;
}

function readTimingScalar(node: XmlQuery, attribute: string, fallback: number): number | null {
    const value = node.attr(attribute);
    if (value === null) {
        return fallback;
    }
    const scalar = value.trim();
    const timingScalarPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
    return timingScalarPattern.test(scalar) && Number.isFinite(Number(scalar)) ? Number(scalar) : null;
}

function readNoteTiming(note: XmlQuery): { start: number; duration: number } | null {
    const start = readTimingScalar(note, 'time', 0);
    const duration = readTimingScalar(note, 'duration', 0.25);
    return start === null || duration === null ? null : { start, duration };
}

function parseNotesNode(
    notes: XmlQuery,
    unit: 'beats' | 'seconds',
    context: ParseContext,
    clipName: string,
    tempo: number
): DawProjectParsedMidiNote[] {
    const result: DawProjectParsedMidiNote[] = [];
    for (const note of notes.children(NOTE)) {
        const key = note.attrNumber('key', -1);
        const timing = readNoteTiming(note);
        if (!isValidMidiKey(key) || !timing) {
            warn(context, note, 'invalid-note', note.attr('name') ?? `key ${note.attr('key') ?? 'missing'}`, clipName);
            continue;
        }
        const details: string[] = [];
        if (note.attrNumber('channel', 0) !== 0) {
            details.push('MIDI channel');
        }
        if (note.attr('rel') !== null) {
            details.push('release velocity');
        }
        if (note.attr('name') !== null) {
            details.push('note name');
        }
        if (note.children().length > 0) {
            details.push('note expression');
        }
        if (details.length > 0) {
            warn(
                context,
                note,
                'unsupported-element',
                note.attr('name') ?? `key ${String(key)}`,
                clipName,
                'partial',
                details
            );
        }
        if (note.children().length > 0) {
            warnNamedDescendants(context, note, note.attr('name') ?? `key ${String(key)}`);
        }
        const velRaw = note.attrNumber('vel', 0.787);
        result.push({
            pitch: key,
            startBeat: toBeats(timing.start, unit, tempo),
            duration: toBeats(timing.duration, unit, tempo),
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

type ClipNotesContent = { notes: XmlQuery; route: XmlQuery[] };

function clipNotesContents(clip: XmlQuery): ClipNotesContent[] {
    const contents: ClipNotesContent[] = [];
    function visit(node: XmlQuery, route: XmlQuery[]): void {
        for (const child of node.children()) {
            if (child.element.tagName === NOTES) {
                contents.push({ notes: child, route: [...route, child] });
            } else if (child.element.tagName === LANES) {
                visit(child, [...route, child]);
            }
        }
    }
    // Only Lanes transparently groups this Clip's content. Notes below child
    // Clips or Warps belong to independent timelines.
    visit(clip, []);
    return contents;
}

function clipNotesContent(clip: XmlQuery): ClipNotesContent | null {
    const contents = clipNotesContents(clip);
    return contents.length === 1 ? (contents[0] ?? null) : null;
}

function clipNotesUnit(content: ClipNotesContent, contentUnit: TimelineUnit): TimelineUnit {
    return content.route.reduce((unit, node) => readTimeUnit(node, unit), contentUnit);
}

function repeatsClipLoop(clip: XmlQuery, timing: ClipTiming, transformTempo: number | null): boolean {
    const loopStart = clip.attr('loopStart');
    const loopEnd = clip.attr('loopEnd');
    if (loopStart === null && loopEnd === null) {
        return false;
    }
    if (loopStart === null || loopEnd === null || timing.visibleDurationBeat === null || transformTempo === null) {
        return true;
    }
    const loopStartBeat = toBeats(clip.attrNumber('loopStart', 0), timing.contentUnit, transformTempo);
    const loopEndBeat = toBeats(clip.attrNumber('loopEnd', 0), timing.contentUnit, transformTempo);
    const playStartBeat = toBeats(clip.attrNumber('playStart', 0), timing.contentUnit, transformTempo);
    if (loopEndBeat <= loopStartBeat) {
        return true;
    }
    // Converted decimal endpoints can differ by a few ulps at a one-pass boundary.
    return playStartBeat + timing.visibleDurationBeat - loopEndBeat > LOOP_ROUNDOFF_TOLERANCE_BEATS;
}

function hasNonIdentityWarpPoints(clip: XmlQuery, timing: ClipTiming, transformTempo: number | null): boolean {
    const warps = clip.child('Warps');
    if (!warps) {
        return false;
    }
    const timeUnit = readTimeUnit(warps, timing.contentUnit);
    const contentUnit = readContentTimeUnit(warps, timeUnit);
    return warps.children('Warp').some((warp) => {
        if (transformTempo === null) {
            return true;
        }
        const time = readTimingScalar(warp, 'time', NaN);
        const contentTime = readTimingScalar(warp, 'contentTime', NaN);
        if (time === null || contentTime === null || !Number.isFinite(time) || !Number.isFinite(contentTime)) {
            return true;
        }
        const timeBeat = toBeats(time, timeUnit, transformTempo);
        const contentBeat = toBeats(contentTime, contentUnit, transformTempo);
        return !Number.isFinite(timeBeat) || !Number.isFinite(contentBeat) || Math.abs(timeBeat - contentBeat) > 1e-9;
    });
}

function hasNonIdentityLeafWarp(clip: XmlQuery, timing: ClipTiming, transformTempo: number | null): boolean {
    const warps = clip.child('Warps');
    const points = warps?.children('Warp') ?? [];
    if (!warps || points.length === 0) {
        return false;
    }
    if (transformTempo === null || timing.visibleDurationBeat === null || points.length < 2) {
        return true;
    }
    const timeUnit = readTimeUnit(warps, timing.contentUnit);
    const contentUnit = readContentTimeUnit(warps, timeUnit);
    const converted: { time: number; contentTime: number }[] = [];
    for (const point of points) {
        const time = readTimingScalar(point, 'time', NaN);
        const contentTime = readTimingScalar(point, 'contentTime', NaN);
        if (time === null || contentTime === null) {
            return true;
        }
        const timeBeat = toBeats(time, timeUnit, transformTempo);
        const contentBeat = toBeats(contentTime, contentUnit, transformTempo);
        const previous = converted.at(-1);
        if (!Number.isFinite(timeBeat) || !Number.isFinite(contentBeat) || (previous && timeBeat <= previous.time)) {
            return true;
        }
        converted.push({ time: timeBeat, contentTime: contentBeat });
    }
    // playStart selects the outer timeline; it is not an offset in the Warp map.
    const start = toBeats(clip.attrNumber('playStart', 0), timing.contentUnit, transformTempo);
    const end = start + timing.visibleDurationBeat;
    const first = converted[0];
    const last = converted.at(-1);
    if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end < start ||
        !first ||
        !last ||
        start < first.time - LOOP_ROUNDOFF_TOLERANCE_BEATS ||
        end > last.time + LOOP_ROUNDOFF_TOLERANCE_BEATS
    ) {
        return true;
    }
    for (let index = 1; index < converted.length; index++) {
        const left = converted[index - 1]!;
        const right = converted[index]!;
        if (right.time < start || left.time > end) {
            continue;
        }
        // The map is linear between points. Checking both clipped endpoints
        // proves the complete played segment, including boundaries between points.
        for (const boundary of [Math.max(start, left.time), Math.min(end, right.time)]) {
            const fraction = (boundary - left.time) / (right.time - left.time);
            const difference =
                (left.contentTime - left.time) * (1 - fraction) + (right.contentTime - right.time) * fraction;
            if (!Number.isFinite(difference) || Math.abs(difference) > LOOP_ROUNDOFF_TOLERANCE_BEATS) {
                return true;
            }
        }
    }
    return false;
}

function parseClip(
    clip: XmlQuery,
    ownerKind: DawProjectParsedTrack['kind'],
    timing: ClipTiming,
    transformTempo: number | null,
    context: ParseContext,
    index: number,
    trackName: string,
    muted: boolean,
    sourceOffsetInexact: boolean
): DawProjectParsedClip | null {
    const { startBeat, endBeat, contentUnit, playStartBeat, tempo } = timing;
    const name = clip.attr('name') ?? `Clip ${String(index + 1)}`;
    const id = `clip-${crypto.randomUUID()}`;
    const source = { sourceId: clip.attr('id') ?? undefined, sourceOrder: context.elementOrder.get(clip.element) };
    let nonidentityWarp: boolean;
    if (clip.element.getElementsByTagName(CLIP).length > 0) {
        nonidentityWarp = hasNonIdentityWarpPoints(clip, timing, transformTempo);
    } else {
        nonidentityWarp = hasNonIdentityLeafWarp(clip, timing, transformTempo);
    }
    if (repeatsClipLoop(clip, timing, transformTempo) || nonidentityWarp) {
        warn(context, clip, 'unsupported-clip', name, trackName);
        return null;
    }
    const partialDetails: string[] = [];
    if (clip.attr('reference') !== null) {
        partialDetails.push('referenced content');
    }
    if (clip.attrNumber('fadeInTime', 0) !== 0 || clip.attrNumber('fadeOutTime', 0) !== 0) {
        partialDetails.push('fade');
    }
    if (sourceOffsetInexact) {
        partialDetails.push('source offset');
    }
    if (clip.attr('color')) {
        partialDetails.push('clip color');
    }
    if (clip.attr('comment')) {
        partialDetails.push('clip comment');
    }
    const audioNode = clip.child(AUDIO) ?? clip.child('Warps')?.child(AUDIO);
    if (audioNode?.child(FILE)?.attrBool('external', false)) {
        partialDetails.push('external audio reference');
    }
    // `playStart` is where the clip starts reading its media, in content time.
    // Kept whenever it differs from the default 0 — negative is the slip of a
    // clip left of its media start.
    const playStart = playStartBeat !== 0 ? { playStartBeat } : {};

    const notesContent = clipNotesContent(clip);
    const materialContent =
        Boolean(resolveAudioAssetPath(clip)) ||
        clip.attr('reference') !== null ||
        (notesContent !== null && notesContent.notes.children(NOTE).length > 0);
    if (
        clip.attr('duration') === null &&
        clip.attr('playStop') === null &&
        clip.element.getElementsByTagName(CLIP).length === 0 &&
        materialContent &&
        endBeat < startBeat + 0.25
    ) {
        partialDetails.push('clip extent defaulted');
    }
    if (!notesContent && clipNotesContents(clip).length > 1) {
        warn(context, clip, 'unsupported-clip', name, trackName);
        return null;
    }
    if (notesContent) {
        const notesName = notesContent.notes.attr('name');
        const notesDetails: string[] = [];
        if (notesName && notesName !== name) {
            notesDetails.push('timeline name');
        }
        if (notesContent.notes.attr('color')) {
            notesDetails.push('timeline color');
        }
        if (notesContent.notes.attr('comment')) {
            notesDetails.push('timeline comment');
        }
        if (notesDetails.length > 0) {
            warn(
                context,
                notesContent.notes,
                'unsupported-element',
                notesName ?? 'Notes',
                `${trackName} / ${name}`,
                'partial',
                notesDetails
            );
        }
        if (partialDetails.length > 0) {
            warn(context, clip, 'unsupported-element', name, trackName, 'partial', partialDetails);
        }
        return {
            id,
            ...source,
            name,
            startBeat,
            endBeat: Math.max(endBeat, startBeat + 0.25),
            type: 'midi',
            muted,
            // Notes are clip content: per the DAWproject Reference,
            // contentTimeUnit governs the content while `time` and `duration`
            // stay in the timeline unit. A Notes `timeUnit` attribute still
            // wins via readTimeUnit.
            notes: parseNotesNode(
                notesContent.notes,
                clipNotesUnit(notesContent, contentUnit),
                context,
                `${trackName} / ${name}`,
                tempo
            ),
            ...playStart,
        };
    }

    const assetPath = resolveAudioAssetPath(clip);
    if (assetPath) {
        if (audioNode) {
            warnTimelineMetadata(context, audioNode, `${trackName} / ${name}`, name);
            if (audioNode.attr('algorithm')?.trim()) {
                warn(
                    context,
                    audioNode,
                    'unsupported-element',
                    audioNode.attr('name') ?? 'Audio',
                    `${trackName} / ${name}`,
                    'partial',
                    ['warp algorithm setting']
                );
            }
        }
        const warps = clip.child('Warps');
        if (warps) {
            warnTimelineMetadata(context, warps, `${trackName} / ${name}`, name);
        }
        if (partialDetails.length > 0) {
            warn(context, clip, 'unsupported-element', name, trackName, 'partial', partialDetails);
        }
        return {
            id,
            ...source,
            name,
            startBeat,
            endBeat: Math.max(endBeat, startBeat + 0.25),
            type: 'audio',
            muted,
            audioAssetPath: assetPath,
            ...playStart,
        };
    }

    const video = clip.child('Video');
    if (video) {
        warn(context, video, 'unsupported-clip', video.child(FILE)?.attr('path') ?? name, trackName);
        return null;
    }
    if (clip.child('Warps')?.child(NOTES)) {
        warn(context, clip, 'unsupported-clip', name, trackName);
        return null;
    }

    if (ownerKind === 'midi') {
        if (partialDetails.length > 0) {
            warn(context, clip, 'unsupported-element', name, trackName, 'partial', partialDetails);
        }
        return {
            id,
            ...source,
            name,
            startBeat,
            endBeat: Math.max(endBeat, startBeat + 0.25),
            type: 'midi',
            muted,
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
    const trackDetails: string[] = [];
    if (track.attr('comment')) {
        trackDetails.push('track comment');
    }
    if (track.attr('loaded') !== null && !track.attrBool('loaded', true)) {
        trackDetails.push('inactive track state');
    }
    const rawColor = track.attr('color');
    if (rawColor && !rawColor.startsWith('#')) {
        trackDetails.push('track color');
    }
    const contentTypes = (track.attr('contentType') ?? '')
        .trim()
        .toLowerCase()
        .split(/[\s,]+/)
        .filter(Boolean);
    if (
        (contentTypes.includes('audio') && (contentTypes.includes('notes') || contentTypes.includes('midi'))) ||
        contentTypes.some((type) => type === 'video' || type === 'automation' || type === 'markers')
    ) {
        trackDetails.push('track content type');
    }
    if (trackDetails.length > 0) {
        warn(context, track, 'unsupported-element', trackName, trackName, 'partial', trackDetails);
    }
    const channelInfo = parseChannelInfo(channel, context, trackName, kind);
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
    for (const channel of structure.children(CHANNEL)) {
        const name = channel.attr('name') ?? 'Channel';
        warn(context, channel, 'unsupported-element', name, 'Structure');
        warnNamedDescendants(context, channel, name);
    }

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

function parseTempoAutomation(point: XmlQuery, unit: 'beats' | 'seconds', tempo: number): DawProjectTempoChange | null {
    const time = readTimingScalar(point, 'time', 0);
    const value = readTimingScalar(point, 'value', tempo);
    if (time === null || value === null) {
        return null;
    }
    const beat = toBeats(time, unit, tempo);
    if (!Number.isFinite(beat) || beat < 0 || value < MIN_TEMPO_MAP_BPM || value > MAX_TEMPO_MAP_BPM) {
        return null;
    }
    return {
        beat,
        tempo: value,
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

function timeSignatureChangeHydrates(change: DawProjectTimeSignatureChange): boolean {
    const parts = [change.numerator, change.denominator];
    return (
        Number.isFinite(change.beat) &&
        change.beat >= 0 &&
        parts.every((part) => Number.isInteger(part) && part >= 1 && part <= 32)
    );
}

function parseMasterTrackAutomation(
    arrangement: XmlQuery,
    context: ParseContext
): {
    tempoChanges: DawProjectTempoChange[];
    timeSignatureChanges: DawProjectTimeSignatureChange[];
    tempoPointsUseBeats: boolean;
} {
    const tempoChanges: DawProjectTempoChange[] = [];
    const timeSignatureChanges: DawProjectTimeSignatureChange[] = [];
    let tempoPointsUseBeats = true;

    for (const direct of arrangement.children()) {
        if (
            (direct.element.tagName === 'TempoAutomation' || direct.element.tagName === 'TimeSignatureAutomation') &&
            direct.children().length > 0
        ) {
            const name = direct.attr('name') ?? direct.element.tagName;
            warn(context, direct, 'unsupported-automation', name, 'Arrangement');
            warnNamedDescendants(context, direct, name);
        }
    }

    const lanesRoot = arrangement.child(LANES);
    if (!lanesRoot) {
        return { tempoChanges, timeSignatureChanges, tempoPointsUseBeats };
    }

    const containerUnit = readTimeUnit(lanesRoot, context.defaultTimeUnit);

    function walkAutomation(
        node: XmlQuery,
        unit: 'beats' | 'seconds',
        inheritedOwner: string | null,
        contentScope = false
    ): void {
        for (const child of node.children()) {
            const childUnit = readTimeUnit(child, unit);
            const ownerRef = child.attr('track') ?? child.attr('channel') ?? inheritedOwner;
            const target = child.attr('target');
            // `<Automation>` is a foreign-writer sibling of `<Points>` the
            // writer never emits, so it stays inline rather than joining the
            // shared tag map.
            if (child.element.tagName === POINTS || child.element.tagName === 'Automation') {
                if (target === 'tempo') {
                    warnTimelineMetadata(context, child, 'Arrangement', 'Tempo');
                    if (
                        contentScope &&
                        child
                            .children(REAL_POINT)
                            .some((point) => parseTempoAutomation(point, childUnit, context.tempo) !== null)
                    ) {
                        warn(
                            context,
                            child,
                            'unsupported-automation',
                            child.attr('name') ?? 'Tempo automation',
                            'Arrangement',
                            'partial',
                            ['automation scope']
                        );
                    }
                    for (const point of child.children(REAL_POINT)) {
                        const change = parseTempoAutomation(point, childUnit, context.tempo);
                        if (!change) {
                            warn(
                                context,
                                point,
                                'unsupported-automation',
                                child.attr('name') ?? 'Tempo automation',
                                'Arrangement'
                            );
                            continue;
                        }
                        if (childUnit === 'seconds') {
                            tempoPointsUseBeats = false;
                            context.secondsPositions.push({
                                node: point,
                                name: child.attr('name') ?? 'Tempo automation',
                                owner: 'Arrangement',
                                seconds: point.attrNumber('time', 0),
                                beat: change.beat,
                                detail: 'tempo position',
                            });
                        }
                        tempoChanges.push(change);
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
                    warnTimelineMetadata(context, child, 'Arrangement', 'Time Signature');
                    if (
                        contentScope &&
                        child
                            .children(TIME_SIGNATURE_POINT)
                            .some((point) =>
                                timeSignatureChangeHydrates(parseTsAutomation(point, childUnit, context.tempo))
                            )
                    ) {
                        warn(
                            context,
                            child,
                            'unsupported-automation',
                            child.attr('name') ?? 'Time signature automation',
                            'Arrangement',
                            'partial',
                            ['automation scope']
                        );
                    }
                    for (const point of child.children(TIME_SIGNATURE_POINT)) {
                        const change = parseTsAutomation(point, childUnit, context.tempo);
                        timeSignatureChanges.push(change);
                        if (!timeSignatureChangeHydrates(change)) {
                            warn(
                                context,
                                point,
                                'unsupported-automation',
                                child.attr('name') ?? 'Time signature automation',
                                'Arrangement'
                            );
                        }
                        const malformed = ['time', 'numerator', 'denominator'].some(
                            (attribute) => readTimingScalar(point, attribute, 0) === null
                        );
                        if (malformed) {
                            warn(
                                context,
                                point,
                                'unsupported-automation',
                                child.attr('name') ?? 'Time signature automation',
                                'Arrangement',
                                'partial',
                                ['time signature value']
                            );
                        }
                        if (childUnit === 'seconds') {
                            context.secondsPositions.push({
                                node: point,
                                name: child.attr('name') ?? 'Time signature automation',
                                owner: 'Arrangement',
                                seconds: point.attrNumber('time', 0),
                                beat: change.beat,
                                detail: 'time signature position',
                            });
                        }
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
                    const owner = ownerRef === null ? 'Arrangement' : (context.trackNames.get(ownerRef) ?? ownerRef);
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
            walkAutomation(
                child,
                childUnit,
                ownerRef,
                contentScope || child.element.tagName === CLIP || child.element.tagName === NOTE
            );
        }
    }

    walkAutomation(lanesRoot, containerUnit, lanesRoot.attr('track') ?? lanesRoot.attr('channel'));
    return { tempoChanges, timeSignatureChanges, tempoPointsUseBeats };
}

function parseArrangementClips(
    arrangement: XmlQuery,
    tracks: DawProjectParsedTrack[],
    context: ParseContext,
    tempoChanges: DawProjectTempoChange[],
    tempoPointsUseBeats: boolean
): void {
    const trackById = new Map(tracks.map((track) => [track.id, track] as const));
    const sortedTempoChanges = [...tempoChanges].sort((a, b) => a.beat - b.beat);
    const tempoLawChanges = tempoChanges.map((change, index) => ({
        ...change,
        id: `tempo-${String(index)}-${String(change.beat)}`,
    }));
    type Scope = {
        ownerRef: string | null;
        unit: TimelineUnit;
        originBeat: number;
        visibleStartBeat: number | null;
        visibleEndBeat: number | null;
        tempo: number | null;
    };

    // Seconds can be flattened with one scale only while the entire converted
    // window has a constant tempo. Ramps belong to the point they start at.
    function constantTempo(startBeat: number, endBeat: number): number | null {
        let tempo = context.tempo > 0 ? context.tempo : 120;
        let previous: DawProjectTempoChange | undefined;
        for (const change of sortedTempoChanges) {
            if (change.beat <= startBeat) {
                tempo = change.tempo;
                previous = change;
                continue;
            }
            if (previous?.curve === 'linear' && previous.tempo !== change.tempo && endBeat > previous.beat) {
                return null;
            }
            if (change.beat >= endBeat) {
                break;
            }
            if (change.tempo !== tempo) {
                return null;
            }
            previous = change;
        }
        return Number.isFinite(tempo) && tempo > 0 ? tempo : null;
    }

    function scopedClipTiming(clip: XmlQuery, scope: Scope): ClipTiming | null {
        if (scope.tempo === null) {
            return null;
        }
        if (
            ['time', 'duration', 'playStart', 'playStop', 'loopStart', 'loopEnd'].some(
                (attribute) => readTimingScalar(clip, attribute, 0) === null
            )
        ) {
            return null;
        }
        const rawUnit = clip.attr('timeUnit');
        const unit = rawUnit === 'beats' || rawUnit === 'seconds' ? rawUnit : scope.unit;
        const initialTiming = readClipTiming(clip, scope.unit, scope.originBeat, scope.tempo);
        const notes = clipNotesContent(clip);
        const audioSourceOffsetOnly =
            notes === null &&
            Boolean(resolveAudioAssetPath(clip)) &&
            !hasNestedClips(clip) &&
            clip.attr('duration') !== null &&
            clip.attr('playStop') === null;
        const secondsContent =
            (!audioSourceOffsetOnly && initialTiming.contentUnit === 'seconds') ||
            (notes !== null && clipNotesUnit(notes, initialTiming.contentUnit) === 'seconds');
        // Seconds-addressed tempo points still use the initial-tempo parser.
        // Their beat positions cannot prove a local seconds transform.
        if (!tempoPointsUseBeats && (unit === 'seconds' || secondsContent)) {
            return null;
        }
        const tempo = secondsContent ? constantTempo(initialTiming.startBeat, initialTiming.startBeat) : scope.tempo;
        if (tempo === null) {
            return null;
        }
        // A leaf media seek retains its initial-tempo representation. Content
        // windows and nested timelines still need the locally affine transform.
        const contentTempo = audioSourceOffsetOnly ? context.tempo : tempo;
        const timing = readClipTiming(clip, scope.unit, scope.originBeat, scope.tempo, contentTempo);
        if (
            unit === 'seconds' &&
            constantTempo(Math.min(scope.originBeat, timing.startBeat), Math.max(scope.originBeat, timing.endBeat)) !==
                scope.tempo
        ) {
            return null;
        }
        if (secondsContent) {
            const origin = timing.startBeat - timing.playStartBeat;
            let startBeat = Math.min(origin, timing.startBeat);
            let endBeat = Math.max(origin, timing.endBeat);
            if (notes && clipNotesUnit(notes, timing.contentUnit) === 'seconds') {
                for (const note of notes.notes.children(NOTE)) {
                    const noteTiming = readNoteTiming(note);
                    if (!isValidMidiKey(note.attrNumber('key', -1)) || !noteTiming) {
                        continue;
                    }
                    const noteStart = origin + toBeats(noteTiming.start, 'seconds', tempo);
                    startBeat = Math.min(startBeat, noteStart);
                    endBeat = Math.max(endBeat, noteStart + toBeats(noteTiming.duration, 'seconds', tempo));
                }
            }
            if (constantTempo(startBeat, endBeat) !== tempo) {
                return null;
            }
        }
        return timing;
    }

    function leafTransformTempo(clip: XmlQuery, timing: ClipTiming): number | null {
        if (hasNestedClips(clip)) {
            return timing.tempo;
        }
        const hasLoop = clip.attr('loopStart') !== null || clip.attr('loopEnd') !== null;
        const warps = clip.child('Warps');
        const warpPoints = warps?.children('Warp') ?? [];
        const warpTimeUnit = warps ? readTimeUnit(warps, timing.contentUnit) : timing.contentUnit;
        const warpContentUnit = warps ? readContentTimeUnit(warps, warpTimeUnit) : warpTimeUnit;
        const mixedWarp = warpPoints.length > 0 && warpTimeUnit !== warpContentUnit;
        if (!(hasLoop && timing.contentUnit === 'seconds') && !mixedWarp) {
            return timing.tempo;
        }
        if (!tempoPointsUseBeats) {
            return null;
        }
        const visibleEndBeat = timing.visibleEndBeat;
        if (
            visibleEndBeat === null ||
            !Number.isFinite(timing.startBeat) ||
            !Number.isFinite(visibleEndBeat) ||
            visibleEndBeat < timing.startBeat
        ) {
            return null;
        }
        // The source seek is represented separately. Only the visible playback
        // interval needs one affine seconds-to-beats conversion for admission.
        return constantTempo(timing.startBeat, visibleEndBeat);
    }

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

    function ownerRef(node: XmlQuery, inherited: string | null): string | null {
        return node.attr('track') ?? node.attr('channel') ?? inherited;
    }

    function consumedOwner(clip: XmlQuery, inherited: string | null): { reference: string | null; node: XmlQuery } {
        let reference = inherited;
        let node = clip;
        const notes = clipNotesContent(clip);
        const audio = clip.child(AUDIO);
        const warps = clip.child('Warps');
        const video = clip.child('Video');
        let route: (XmlQuery | null)[] = [];
        if (notes) {
            route = notes.route;
        } else if (audio) {
            route = [audio];
        } else if (warps) {
            route = [warps, warps.child(AUDIO) ?? warps.child(NOTES)];
        } else if (video) {
            route = [video];
        }
        for (const content of route) {
            if (content && (content.attr('track') !== null || content.attr('channel') !== null)) {
                reference = ownerRef(content, reference);
                node = content;
            }
        }
        return { reference, node };
    }

    function ownerName(reference: string | null, fallback: string): string {
        return reference === null ? fallback : (context.trackNames.get(reference) ?? reference);
    }

    function timelineUnit(node: XmlQuery, inherited: TimelineUnit): TimelineUnit {
        if (node.element.tagName === 'Warps') {
            return readContentTimeUnit(node, readTimeUnit(node, inherited));
        }
        return readTimeUnit(node, inherited);
    }

    function hasNestedClips(node: XmlQuery): boolean {
        return node.element.getElementsByTagName(CLIP).length > 0;
    }

    function timelineScope(node: XmlQuery, scope: Scope): Scope {
        const unit = timelineUnit(node, scope.unit);
        let tempo = scope.tempo;
        if (unit === 'seconds') {
            tempo = tempoPointsUseBeats ? constantTempo(scope.originBeat, scope.originBeat) : null;
        }
        return { ...scope, unit, tempo };
    }

    function nestedTimingIsAffine(node: XmlQuery, scope: Scope): boolean {
        let nextScope: Scope;
        if (node.element.tagName === CLIP) {
            const timing = scopedClipTiming(node, scope);
            if (!timing) {
                return false;
            }
            if (
                scope.visibleStartBeat !== null &&
                (scope.visibleEndBeat === null ||
                    timing.startBeat < scope.visibleStartBeat ||
                    Math.max(timing.endBeat, timing.startBeat + 0.25) > scope.visibleEndBeat)
            ) {
                return false;
            }
            if (hasNestedClips(node)) {
                const loopStart = node.attr('loopStart');
                const loopEnd = node.attr('loopEnd');
                const loopStartBeat = toBeats(node.attrNumber('loopStart', 0), timing.contentUnit, timing.tempo);
                const loopEndBeat = toBeats(node.attrNumber('loopEnd', 0), timing.contentUnit, timing.tempo);
                if (
                    (timing.visibleEndBeat === null && clipNotesContent(node) === null) ||
                    node.attr('reference') !== null ||
                    ((loopStart !== null || loopEnd !== null) &&
                        (timing.visibleEndBeat === null ||
                            loopStart === null ||
                            loopEnd === null ||
                            loopEndBeat <= loopStartBeat ||
                            timing.playStartBeat + (timing.visibleEndBeat - timing.startBeat) > loopEndBeat))
                ) {
                    return false;
                }
            }
            nextScope = {
                ...scope,
                unit: timing.contentUnit,
                originBeat: timing.startBeat - timing.playStartBeat,
                visibleStartBeat: timing.startBeat,
                visibleEndBeat: timing.visibleEndBeat,
                tempo: timing.tempo,
            };
        } else {
            if (node.element.tagName === 'Warps' && node.children('Warp').length > 0 && hasNestedClips(node)) {
                return false;
            }
            nextScope = timelineScope(node, scope);
        }

        const nestedTimelines = node
            .children()
            .filter((child) => hasNestedClips(child) || child.element.tagName === CLIP);
        // One rejected branch cannot invalidate an independently placeable
        // sibling. Traversal checks each branch again before publishing it.
        return (
            nestedTimelines.length === 0 ||
            (node.element.tagName === CLIP && clipNotesContent(node) !== null) ||
            nestedTimelines.some((child) => nestedTimingIsAffine(child, nextScope))
        );
    }

    const lanesRoot = arrangement.child(LANES);
    if (!lanesRoot) {
        return;
    }

    warnTimelineMetadata(context, lanesRoot, 'Arrangement');

    function walkClips(
        node: XmlQuery,
        scope: Scope,
        clipMediaHandled = false,
        ancestorMuted = false,
        insideClip = false
    ): void {
        let clipIndex = 0;
        for (const laneOrClips of node.children()) {
            const reference = ownerRef(laneOrClips, scope.ownerRef);
            const laneScope = timelineScope(laneOrClips, scope);
            if (laneOrClips.element.tagName === LANES || laneOrClips.element.tagName === CLIPS) {
                warnTimelineMetadata(context, laneOrClips, ownerName(reference, 'Arrangement'));
            }
            const enabled = laneOrClips.attr('enable')?.trim();
            const muted =
                ancestorMuted || (laneOrClips.element.tagName === CLIP && (enabled === 'false' || enabled === '0'));
            if (laneOrClips.element.tagName === AUDIO || laneOrClips.element.tagName === 'Video') {
                if (!clipMediaHandled) {
                    const name =
                        laneOrClips.attr('name') ??
                        laneOrClips.child(FILE)?.attr('path') ??
                        laneOrClips.element.tagName;
                    warn(context, laneOrClips, 'unsupported-clip', name, ownerName(reference, 'Arrangement'));
                }
                continue;
            }
            if (laneOrClips.element.tagName === MARKERS || laneOrClips.element.tagName === 'markers') {
                for (const marker of laneOrClips.children(MARKER)) {
                    warn(
                        context,
                        marker,
                        'unsupported-element',
                        marker.attr('name') ?? 'Marker',
                        ownerName(reference, 'Arrangement')
                    );
                }
                continue;
            }
            if (laneOrClips.element.tagName === NOTES && !insideClip) {
                warn(
                    context,
                    laneOrClips,
                    'unsupported-element',
                    laneOrClips.attr('name') ?? 'Notes',
                    ownerName(reference, 'Arrangement')
                );
                warnNamedDescendants(context, laneOrClips, laneOrClips.attr('name') ?? 'Notes');
                continue;
            }
            if (
                laneOrClips.element.tagName === 'ClipSlot' &&
                ((laneOrClips.attrBool('hasStop', false) && laneOrClips.child(CLIP) === null) ||
                    Boolean(laneOrClips.attr('name')?.trim()) ||
                    Boolean(laneOrClips.attr('color')?.trim()) ||
                    Boolean(laneOrClips.attr('comment')?.trim()))
            ) {
                warn(
                    context,
                    laneOrClips,
                    'unsupported-element',
                    laneOrClips.attr('name') ?? 'ClipSlot stop',
                    ownerName(reference, 'Arrangement')
                );
            }
            if (laneOrClips.element.tagName === CLIP && node.element.tagName === 'ClipSlot') {
                warn(
                    context,
                    laneOrClips,
                    'unsupported-clip',
                    laneOrClips.attr('name') ?? 'Clip',
                    ownerName(reference, 'Arrangement')
                );
                warnNamedDescendants(context, laneOrClips, laneOrClips.attr('name') ?? 'Clip');
                continue;
            }
            if (laneOrClips.element.tagName === CLIP && node.element.tagName === CLIPS) {
                const index = clipIndex++;
                const contentOwner = consumedOwner(laneOrClips, reference);
                const timing = scopedClipTiming(laneOrClips, scope);
                if (!timing || !nestedTimingIsAffine(laneOrClips, scope)) {
                    warn(
                        context,
                        laneOrClips,
                        'unsupported-clip',
                        laneOrClips.attr('name') ?? `Clip ${String(index + 1)}`,
                        ownerName(contentOwner.reference, 'Unassigned lane')
                    );
                    warnNamedDescendants(context, laneOrClips, laneOrClips.attr('name') ?? 'Clip');
                    continue;
                }
                const targetTrackId = resolveTrackId(contentOwner.reference);
                const target = targetTrackId ? trackById.get(targetTrackId) : null;
                if (target) {
                    const clip = parseClip(
                        laneOrClips,
                        target.kind,
                        timing,
                        leafTransformTempo(laneOrClips, timing),
                        context,
                        index,
                        target.name,
                        muted,
                        timing.contentUnit === 'seconds' &&
                            timing.playStartBeat !== 0 &&
                            Boolean(resolveAudioAssetPath(laneOrClips)) &&
                            timing.tempo !==
                                resolveTempoAtBeat({
                                    changes: tempoLawChanges,
                                    beat: timing.startBeat,
                                    defaultTempo: consumerTempo(context.tempo),
                                })
                    );
                    if (clip) {
                        target.clips.push(clip);
                    } else {
                        context.rejectedContents.push({ node: laneOrClips, owner: laneOrClips.attr('name') ?? 'Clip' });
                    }
                } else {
                    warn(
                        context,
                        contentOwner.node,
                        'unsupported-clip',
                        laneOrClips.attr('name') ?? 'Clip',
                        ownerName(contentOwner.reference, 'Unassigned lane')
                    );
                    context.rejectedContents.push({ node: laneOrClips, owner: laneOrClips.attr('name') ?? 'Clip' });
                }
                walkClips(
                    laneOrClips,
                    {
                        ownerRef: reference,
                        unit: timing.contentUnit,
                        originBeat: timing.startBeat - timing.playStartBeat,
                        visibleStartBeat: timing.startBeat,
                        visibleEndBeat: timing.visibleEndBeat,
                        tempo: timing.tempo,
                    },
                    true,
                    muted,
                    true
                );
                continue;
            }
            if (
                laneOrClips.element.tagName === 'Warps' &&
                ((laneOrClips.children('Warp').length > 0 && hasNestedClips(laneOrClips)) ||
                    (node.element.tagName !== CLIP && laneOrClips.child(NOTES) !== null) ||
                    (!insideClip && laneOrClips.child(AUDIO) !== null))
            ) {
                warn(
                    context,
                    laneOrClips,
                    'unsupported-clip',
                    laneOrClips.attr('name') ?? 'Warps',
                    ownerName(reference, 'Unassigned lane')
                );
                warnNamedDescendants(context, laneOrClips, laneOrClips.attr('name') ?? 'Warps');
                continue;
            }
            const childMediaHandled =
                laneOrClips.element.tagName === CLIP ||
                (node.element.tagName === CLIP && laneOrClips.element.tagName === 'Warps');
            walkClips(laneOrClips, { ...laneScope, ownerRef: reference }, childMediaHandled, muted, insideClip);
        }
    }

    walkClips(lanesRoot, {
        ownerRef: ownerRef(lanesRoot, null),
        unit: readTimeUnit(lanesRoot, context.defaultTimeUnit),
        originBeat: 0,
        visibleStartBeat: null,
        visibleEndBeat: null,
        tempo: context.tempo > 0 ? context.tempo : 120,
    });
}

function parseMarkers(
    arrangement: XmlQuery,
    unit: 'beats' | 'seconds',
    tempo: number,
    context: ParseContext
): DawProjectMarker[] {
    const markers: DawProjectMarker[] = [];
    const markersNode = arrangement.child(MARKERS);
    if (!markersNode) {
        return markers;
    }
    warnTimelineMetadata(context, markersNode, 'Arrangement');
    for (const marker of markersNode.children(MARKER)) {
        const beat = toBeats(marker.attrNumber('time', 0), unit, tempo);
        const name = marker.attr('name') ?? 'Marker';
        markers.push({ beat, name });
        const details: string[] = [];
        if (marker.attr('color')) {
            details.push('marker color');
        }
        if (marker.attr('comment')) {
            details.push('marker comment');
        }
        if (details.length > 0) {
            warn(context, marker, 'unsupported-element', name, 'Arrangement', 'partial', details);
        }
        const sourceUnit = readTimeUnit(markersNode, unit);
        if (sourceUnit === 'seconds') {
            context.secondsPositions.push({
                node: marker,
                name,
                owner: 'Arrangement',
                seconds: marker.attrNumber('time', 0),
                beat,
                detail: 'marker position',
            });
        } else if (sourceUnit !== unit && marker.attrNumber('time', 0) !== beat) {
            warn(context, marker, 'unsupported-element', name, 'Arrangement', 'partial', ['marker position']);
        }
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
        channels: [],
        rejectedContents: [],
        secondsPositions: [],
    };

    const transportNode = root.child(TRANSPORT);
    warnParameterMetadata(context, transportNode?.child(TEMPO) ?? null, 'Transport', ['bpm']);
    warnParameterMetadata(context, transportNode?.child(TIME_SIGNATURE) ?? null, 'Transport', []);
    const tempoNode = transportNode?.child(TEMPO);
    const tempoValue = tempoNode?.attr('value');
    if (
        tempoNode &&
        tempoValue !== null &&
        tempoValue !== undefined &&
        (!tempoValue.trim() ||
            !Number.isFinite(Number(tempoValue)) ||
            Number(tempoValue) < MIN_TEMPO ||
            Number(tempoValue) > MAX_TEMPO)
    ) {
        warn(context, tempoNode, 'unsupported-element', tempoNode.attr('name') ?? 'Tempo', 'Transport', 'partial', [
            'tempo',
        ]);
    }
    const signatureNode = transportNode?.child(TIME_SIGNATURE);
    if (signatureNode) {
        const numerator = signatureNode.attr('numerator');
        const denominator = signatureNode.attr('denominator');
        const badNumerator =
            numerator !== null &&
            (!numerator.trim() ||
                !Number.isInteger(Number(numerator)) ||
                Number(numerator) < 1 ||
                Number(numerator) > 32);
        const badDenominator =
            denominator !== null && (!denominator.trim() || ![2, 4, 8, 16].includes(Number(denominator)));
        if (badNumerator || badDenominator) {
            warn(
                context,
                signatureNode,
                'unsupported-element',
                signatureNode.attr('name') ?? 'TimeSignature',
                'Transport',
                'partial',
                ['time signature']
            );
        }
    }
    const structureNode = root.child(STRUCTURE);
    const tracks = structureNode ? parseStructure(structureNode, context) : [];

    const masterId = tracks.find((track) => track.kind === 'master')?.id;
    for (const channel of context.channels) {
        const details: string[] = [];
        const role = channel.node.attr('role');
        const roleMatches =
            role === 'regular' ||
            (role === 'master' && channel.kind === 'master') ||
            ((role === 'effect' || role === 'submix') && channel.kind === 'bus');
        if (role && !roleMatches) {
            details.push('channel role');
        }
        const destination = channel.node.attr('destination');
        const destinationId =
            destination === null
                ? undefined
                : (context.channelToTrackId.get(destination) ?? context.trackIdMap.get(destination));
        if (destination !== null && (!masterId || destinationId !== masterId)) {
            details.push('destination');
        }
        if (channel.node.attrBool('solo', false)) {
            details.push('solo');
        }
        const channelName = channel.node.attr('name');
        if (channelName && channelName !== channel.owner) {
            details.push('channel name');
        }
        if (channel.node.attr('color')) {
            details.push('channel color');
        }
        if (channel.node.attr('comment')) {
            details.push('channel comment');
        }
        if (channel.node.attrNumber('audioChannels', 2) !== 2) {
            details.push('channel count');
        }
        if (details.length > 0) {
            warn(
                context,
                channel.node,
                'unsupported-element',
                channel.node.attr('name') ?? 'Channel',
                channel.owner,
                'partial',
                details
            );
        }
        warnParameterMetadata(context, channel.node.child(MUTE), channel.owner, []);
        warnParameterMetadata(context, channel.node.child(SOLO), channel.owner, []);
        warnParameterMetadata(context, channel.node.child(PAN), channel.owner, ['linear', 'normalized']);
        warnParameterMetadata(context, channel.node.child(VOLUME), channel.owner, ['linear']);
    }

    const arrangementNode = root.child(ARRANGEMENT);
    let tempoChanges: DawProjectTempoChange[] = [];
    let timeSignatureChanges: DawProjectTimeSignatureChange[] = [];
    let markers: DawProjectMarker[] = [];

    if (arrangementNode) {
        context.defaultTimeUnit = readTimeUnit(arrangementNode, 'beats');
        warnTimelineMetadata(context, arrangementNode, 'Project');
        const automation = parseMasterTrackAutomation(arrangementNode, context);
        tempoChanges = automation.tempoChanges;
        timeSignatureChanges = automation.timeSignatureChanges;
        parseArrangementClips(arrangementNode, tracks, context, tempoChanges, automation.tempoPointsUseBeats);
        markers = parseMarkers(arrangementNode, context.defaultTimeUnit, context.tempo, context);
    }

    const retainedClips = new Set(
        tracks.flatMap((track) =>
            track.clips.flatMap((clip) => (clip.sourceOrder === undefined ? [] : [clip.sourceOrder]))
        )
    );
    for (const rejected of context.rejectedContents) {
        warnNamedDescendants(context, rejected.node, rejected.owner, retainedClips);
    }
    const tempoLawChanges = tempoChanges.map((change, index) => ({
        ...change,
        id: `tempo-${String(index)}-${String(change.beat)}`,
    }));
    for (const position of context.secondsPositions) {
        const actual = secondsBetweenBeats(tempoLawChanges, 0, position.beat, consumerTempo(context.tempo));
        if (Math.abs(actual - position.seconds) > 1e-9) {
            warn(context, position.node, 'unsupported-element', position.name, position.owner, 'partial', [
                position.detail,
            ]);
        }
    }
    const scenes = root.child('Scenes');
    if (scenes) {
        for (const scene of scenes.children('Scene')) {
            const sceneName = scene.attr('name') ?? 'Scene';
            warn(context, scene, 'unsupported-element', sceneName, 'Scenes');
            warnNamedDescendants(context, scene, sceneName);
        }
    }
    context.warnings.sort((a, b) => a.sourceOrder - b.sourceOrder);
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
