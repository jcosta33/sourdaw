import { clampFaderGain } from '#/utils/audioLevelLaw';

import { type ProjectClip, type ProjectData, type ProjectMidiNote, type ProjectTrack } from './projectDataContract';

export type SerializeProjectXmlInput = {
    project: ProjectData;
    audioPathByBufferId: Map<string, string>;
};

function escapeXml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

function contentTypeForKind(kind: ProjectTrack['kind']): string {
    if (kind === 'audio') {
        return 'audio';
    }
    if (kind === 'midi') {
        return 'notes';
    }
    if (kind === 'master') {
        return 'mix';
    }
    if (kind === 'bus') {
        return 'audio';
    }
    return 'tracks';
}

/**
 * The `type` attribute the parser reads to recover a channel role.
 *
 * `contentType` cannot carry it: master is "mix" and a bus is indistinguishable
 * from an audio track, so a round-trip demoted both to plain audio tracks
 * (audit M-261). Empty for the kinds `contentType` already identifies, so
 * ordinary tracks keep the exact element they had before.
 *
 * Provenance: the token names are not invented here — `parseProjectXml`'s
 * `classifyTrackKind` already accepted `type="masterChannel"`, `master="true"`
 * and `type="bus"` from foreign files. Only the writer was missing, so this
 * closes the loop with the vocabulary the reader already had. Judgement call
 * worth a second opinion: whether emitting a non-DAWproject-standard `type`
 * attribute is acceptable, or whether the role belongs on `<Channel role=…>`
 * as the DAWproject spec puts it — the latter would need the parser to learn a
 * new location as well.
 */
function typeAttributeForKind(kind: ProjectTrack['kind']): string {
    if (kind === 'master') {
        return ' type="masterChannel"';
    }
    if (kind === 'bus') {
        return ' type="bus"';
    }
    return '';
}

function formatNumber(value: number): string {
    if (!Number.isFinite(value)) {
        return '0';
    }
    const rounded = Math.round(value * 1_000_000) / 1_000_000;
    return Number.isInteger(rounded) ? rounded.toFixed(0) : String(rounded);
}

function renderDevicesXml(devices: ProjectTrack['devices'], indent: string): string {
    if (devices.length === 0) {
        return '';
    }
    const lines: string[] = [];
    lines.push(`${indent}<Devices>`);
    for (const device of devices) {
        lines.push(
            `${indent}    <Device deviceRole="${escapeXml(device.type)}" name="${escapeXml(device.name)}" bypassed="${String(device.bypassed)}"/>`
        );
    }
    lines.push(`${indent}</Devices>`);
    return lines.join('\n');
}

/**
 * `<Volume>` carries the track's linear amplitude, and the fader's range is
 * `[0, FADER_MAX_GAIN]` — so the export clamp is the fader law, not unity.
 * Pinning it at 1 flattened every track carrying make-up gain down to unity on
 * the way out, silently and with no warning, so a round trip through
 * interchange lost up to 6 dB per track. Nothing in the interchange schema
 * requires a volume of at most 1; `mapToProjectData` reads the same range back.
 */
function renderChannelXml(track: ProjectTrack, indent: string): string {
    const volume = clampFaderGain(track.gain);
    const pan = Math.max(-1, Math.min(1, track.pan));
    const normalizedPan = (pan + 1) / 2;
    const parts: string[] = [];
    parts.push(`${indent}<Channel id="${escapeXml(`${track.id}-channel`)}">`);
    parts.push(`${indent}    <Volume value="${formatNumber(volume)}"/>`);
    parts.push(`${indent}    <Pan value="${formatNumber(normalizedPan)}"/>`);
    parts.push(`${indent}    <Mute value="${String(track.muted)}"/>`);
    parts.push(`${indent}    <Solo value="${String(track.soloed)}"/>`);
    const devicesXml = renderDevicesXml(track.devices, `${indent}    `);
    if (devicesXml) {
        parts.push(devicesXml);
    }
    parts.push(`${indent}</Channel>`);
    return parts.join('\n');
}

type TrackTreeNode = {
    track: ProjectTrack;
    children: TrackTreeNode[];
};

function buildTrackTree(tracks: ReadonlyArray<ProjectTrack>): TrackTreeNode[] {
    const nodes = new Map<string, TrackTreeNode>();
    for (const track of tracks) {
        nodes.set(track.id, { track, children: [] });
    }
    const roots: TrackTreeNode[] = [];
    for (const track of tracks) {
        const node = nodes.get(track.id)!;
        if (track.parentId && nodes.has(track.parentId)) {
            nodes.get(track.parentId)!.children.push(node);
        } else {
            roots.push(node);
        }
    }
    return roots;
}

function renderTrackNode(node: TrackTreeNode, indent: string): string {
    const { track, children } = node;
    const parts: string[] = [];
    parts.push(
        `${indent}<Track id="${escapeXml(track.id)}" name="${escapeXml(track.name)}" contentType="${contentTypeForKind(track.kind)}"${typeAttributeForKind(track.kind)} color="${escapeXml(track.color || '#64748b')}">`
    );
    parts.push(renderChannelXml(track, `${indent}    `));
    for (const child of children) {
        parts.push(renderTrackNode(child, `${indent}    `));
    }
    parts.push(`${indent}</Track>`);
    return parts.join('\n');
}

function renderNotesXml(notes: ProjectMidiNote[], indent: string): string {
    if (notes.length === 0) {
        return `${indent}<Notes/>`;
    }
    const lines: string[] = [];
    lines.push(`${indent}<Notes>`);
    for (const note of notes) {
        const vel = Math.max(0, Math.min(1, note.velocity / 127));
        lines.push(
            `${indent}    <Note time="${formatNumber(note.startBeat)}" duration="${formatNumber(note.duration)}" key="${String(note.pitch)}" vel="${formatNumber(vel)}"/>`
        );
    }
    lines.push(`${indent}</Notes>`);
    return lines.join('\n');
}

function renderClipXml(
    clip: ProjectClip,
    notesByClipId: Record<string, ProjectMidiNote[]>,
    audioPathByBufferId: Map<string, string>,
    indent: string
): string {
    const duration = Math.max(0, clip.endBeat - clip.startBeat);
    const header = `${indent}<Clip time="${formatNumber(clip.startBeat)}" duration="${formatNumber(duration)}" name="${escapeXml(clip.name)}"`;
    if (clip.type === 'audio') {
        const path = clip.bufferId ? audioPathByBufferId.get(clip.bufferId) : undefined;
        if (!path) {
            return `${header}/>`;
        }
        const lines: string[] = [];
        lines.push(`${header}>`);
        lines.push(`${indent}    <Audio>`);
        lines.push(`${indent}        <File path="${escapeXml(path)}"/>`);
        lines.push(`${indent}    </Audio>`);
        lines.push(`${indent}</Clip>`);
        return lines.join('\n');
    }

    const notes = clip.notes ?? notesByClipId[clip.id] ?? [];
    const lines: string[] = [];
    lines.push(`${header}>`);
    lines.push(renderNotesXml(notes, `${indent}    `));
    lines.push(`${indent}</Clip>`);
    return lines.join('\n');
}

function renderClipsLane(
    track: ProjectTrack,
    notesByClipId: Record<string, ProjectMidiNote[]>,
    audioPathByBufferId: Map<string, string>,
    indent: string
): string {
    if (track.clips.length === 0) {
        return '';
    }
    const lines: string[] = [];
    lines.push(`${indent}<Clips track="${escapeXml(track.id)}" timeUnit="beats">`);
    for (const clip of track.clips) {
        lines.push(renderClipXml(clip, notesByClipId, audioPathByBufferId, `${indent}    `));
    }
    lines.push(`${indent}</Clips>`);
    return lines.join('\n');
}

function renderTempoPoints(project: ProjectData, indent: string): string {
    const tempoChanges = project.tempoMap?.changes ?? [];
    if (tempoChanges.length === 0) {
        return `${indent}<Points target="tempo" timeUnit="beats">
${indent}    <RealPoint time="0" value="${formatNumber(project.transport.tempo)}"/>
${indent}</Points>`;
    }
    const lines: string[] = [];
    lines.push(`${indent}<Points target="tempo" timeUnit="beats">`);
    for (const change of tempoChanges) {
        lines.push(
            `${indent}    <RealPoint time="${formatNumber(change.beat)}" value="${formatNumber(change.tempo)}"/>`
        );
    }
    lines.push(`${indent}</Points>`);
    return lines.join('\n');
}

function renderTimeSignaturePoints(project: ProjectData, indent: string): string {
    const changes = project.timeSignatureMap?.changes ?? [];
    if (changes.length === 0) {
        return `${indent}<Points target="timeSignature" timeUnit="beats">
${indent}    <TimeSignaturePoint time="0" numerator="${String(project.transport.timeSignatureNumerator)}" denominator="${String(project.transport.timeSignatureDenominator)}"/>
${indent}</Points>`;
    }
    const lines: string[] = [];
    lines.push(`${indent}<Points target="timeSignature" timeUnit="beats">`);
    for (const change of changes) {
        lines.push(
            `${indent}    <TimeSignaturePoint time="${formatNumber(change.beat)}" numerator="${String(change.numerator)}" denominator="${String(change.denominator)}"/>`
        );
    }
    lines.push(`${indent}</Points>`);
    return lines.join('\n');
}

function renderMarkersXml(project: ProjectData, indent: string): string {
    if (project.markers.length === 0) {
        return '';
    }
    const lines: string[] = [];
    lines.push(`${indent}<Markers>`);
    for (const marker of project.markers) {
        lines.push(`${indent}    <Marker time="${formatNumber(marker.beat)}" name="${escapeXml(marker.name)}"/>`);
    }
    lines.push(`${indent}</Markers>`);
    return lines.join('\n');
}

export function serializeProjectXml(input: SerializeProjectXmlInput): string {
    const { project, audioPathByBufferId } = input;
    const tracks = project.arrangement.tracks;
    const notesByClipId = project.midi.notesByClipId;

    const structureTree = buildTrackTree(tracks);
    const structureXml = structureTree.map((node) => renderTrackNode(node, '        ')).join('\n');

    const clipsLanes = tracks
        .filter((track) => track.clips.length > 0)
        .map((track) => renderClipsLane(track, notesByClipId, audioPathByBufferId, '            '))
        .filter((lane) => lane.length > 0)
        .join('\n');

    const tempoPoints = renderTempoPoints(project, '            ');
    const tsPoints = renderTimeSignaturePoints(project, '            ');
    const markersXml = renderMarkersXml(project, '        ');

    return `<?xml version="1.0" encoding="UTF-8"?>
<Project version="1.0">
    <Application name="Sourdaw" version="0.1.0"/>
    <Transport>
        <Tempo value="${formatNumber(project.transport.tempo)}"/>
        <TimeSignature numerator="${String(project.transport.timeSignatureNumerator)}" denominator="${String(project.transport.timeSignatureDenominator)}"/>
    </Transport>
    <Structure>
${structureXml}
    </Structure>
    <Arrangement timeUnit="beats">
        <Lanes timeUnit="beats">
${clipsLanes}
${tempoPoints}
${tsPoints}
        </Lanes>
${markersXml}
    </Arrangement>
</Project>`;
}
