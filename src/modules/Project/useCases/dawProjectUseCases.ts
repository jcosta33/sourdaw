/**
 * DAWproject Format Support
 *
 * Export/import project interop with Bitwig Studio and Studio One
 * using the open DAWproject XML format.
 *
 * DAWproject is a ZIP file containing:
 *   - project.xml (main project descriptor)
 *   - media/ folder (audio files, referenced by relative paths)
 *
 * @see https://github.com/bitwig/dawproject
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';

const logger = Container.getInstance().get(Logger);

export type DawProjectTrack = {
    id: string;
    name: string;
    type: 'audio' | 'midi' | 'bus' | 'master';
    color: string;
    volume: number;
    pan: number;
    muted: boolean;
    solo: boolean;
};

export type DawProjectClip = {
    trackId: string;
    name: string;
    startBeat: number;
    durationBeats: number;
    /** Reference to media file (relative path inside ZIP) */
    mediaRef: string | null;
    /** MIDI notes if MIDI clip */
    notes: Array<{ pitch: number; velocity: number; startBeat: number; durationBeats: number }>;
};

export type DawProjectTimeline = {
    bpm: number;
    timeSignatureNumerator: number;
    timeSignatureDenominator: number;
};

export type DawProjectDocument = {
    version: string;
    application: string;
    timeline: DawProjectTimeline;
    tracks: DawProjectTrack[];
    clips: DawProjectClip[];
};

/**
 * Export current project state to DAWproject XML format.
 */
export function exportToDawProject(
    _projectName: string,
    bpm: number,
    timeSignature: [number, number],
    tracks: Array<{
        id: string;
        name: string;
        type: string;
        color: string;
        gain: number;
        pan: number;
        muted: boolean;
        solo: boolean;
    }>,
    clips: Array<{
        trackId: string;
        name: string;
        startBeat: number;
        endBeat: number;
        type: string;
        midiNotes?: Array<{ pitch: number; velocity: number; startBeat: number; duration: number }>;
    }>
): string {
    const doc: DawProjectDocument = {
        version: '1.0',
        application: 'WebDAW',
        timeline: {
            bpm,
            timeSignatureNumerator: timeSignature[0],
            timeSignatureDenominator: timeSignature[1],
        },
        tracks: tracks.map((t) => ({
            id: t.id,
            name: t.name,
            type: t.type as DawProjectTrack['type'],
            color: t.color,
            volume: t.gain,
            pan: t.pan,
            muted: t.muted,
            solo: t.solo,
        })),
        clips: clips.map((c) => ({
            trackId: c.trackId,
            name: c.name,
            startBeat: c.startBeat,
            durationBeats: c.endBeat - c.startBeat,
            mediaRef: c.type === 'audio' ? `media/${c.name}.wav` : null,
            notes: c.midiNotes?.map((n) => ({
                pitch: n.pitch,
                velocity: n.velocity,
                startBeat: n.startBeat,
                durationBeats: n.duration,
            })) ?? [],
        })),
    };

    return generateDawProjectXml(doc);
}

/**
 * Parse a DAWproject XML string into our intermediate format.
 */
export function parseDawProjectXml(xml: string): DawProjectDocument | null {
    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xml, 'text/xml');
        const root = xmlDoc.documentElement;

        if (root.tagName !== 'DAWProject') {
            logger.warn('Invalid DAWproject: root element is not DAWProject');
            return null;
        }

        const version = root.getAttribute('version') ?? '1.0';

        // Parse timeline
        const timelineEl = root.querySelector('Timeline');
        const bpm = parseFloat(timelineEl?.getAttribute('bpm') ?? '120');
        const tsNum = parseInt(timelineEl?.getAttribute('timeSignatureNumerator') ?? '4', 10);
        const tsDen = parseInt(timelineEl?.getAttribute('timeSignatureDenominator') ?? '4', 10);

        // Parse tracks
        const tracks: DawProjectTrack[] = [];
        const trackEls = root.querySelectorAll('Tracks > Track');
        trackEls.forEach((el) => {
            tracks.push({
                id: el.getAttribute('id') ?? '',
                name: el.getAttribute('name') ?? 'Untitled',
                type: (el.getAttribute('type') as DawProjectTrack['type']) ?? 'audio',
                color: el.getAttribute('color') ?? '#808080',
                volume: parseFloat(el.getAttribute('volume') ?? '0.8'),
                pan: parseFloat(el.getAttribute('pan') ?? '0'),
                muted: el.getAttribute('muted') === 'true',
                solo: el.getAttribute('solo') === 'true',
            });
        });

        // Parse clips
        const clips: DawProjectClip[] = [];
        const clipEls = root.querySelectorAll('Clips > Clip');
        clipEls.forEach((el) => {
            const notes: DawProjectClip['notes'] = [];
            const noteEls = el.querySelectorAll('Note');
            noteEls.forEach((noteEl) => {
                notes.push({
                    pitch: parseInt(noteEl.getAttribute('pitch') ?? '60', 10),
                    velocity: parseInt(noteEl.getAttribute('velocity') ?? '100', 10),
                    startBeat: parseFloat(noteEl.getAttribute('startBeat') ?? '0'),
                    durationBeats: parseFloat(noteEl.getAttribute('duration') ?? '1'),
                });
            });

            clips.push({
                trackId: el.getAttribute('trackId') ?? '',
                name: el.getAttribute('name') ?? '',
                startBeat: parseFloat(el.getAttribute('startBeat') ?? '0'),
                durationBeats: parseFloat(el.getAttribute('duration') ?? '4'),
                mediaRef: el.getAttribute('mediaRef') ?? null,
                notes,
            });
        });

        return { version, application: 'External', timeline: { bpm, timeSignatureNumerator: tsNum, timeSignatureDenominator: tsDen }, tracks, clips };
    } catch (err) {
        logger.error(err instanceof Error ? err : new Error(`Failed to parse DAWproject XML: ${String(err)}`));
        return null;
    }
}

/**
 * Generate DAWproject XML from document model.
 */
function generateDawProjectXml(doc: DawProjectDocument): string {
    const lines: string[] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<DAWProject version="${doc.version}" application="${doc.application}">`,
        `  <Timeline bpm="${doc.timeline.bpm}" timeSignatureNumerator="${doc.timeline.timeSignatureNumerator}" timeSignatureDenominator="${doc.timeline.timeSignatureDenominator}" />`,
        '  <Tracks>',
    ];

    for (const t of doc.tracks) {
        lines.push(`    <Track id="${t.id}" name="${escapeXml(t.name)}" type="${t.type}" color="${t.color}" volume="${t.volume}" pan="${t.pan}" muted="${t.muted}" solo="${t.solo}" />`);
    }

    lines.push('  </Tracks>');
    lines.push('  <Clips>');

    for (const c of doc.clips) {
        if (c.notes.length > 0) {
            lines.push(`    <Clip trackId="${c.trackId}" name="${escapeXml(c.name)}" startBeat="${c.startBeat}" duration="${c.durationBeats}">`);
            for (const n of c.notes) {
                lines.push(`      <Note pitch="${n.pitch}" velocity="${n.velocity}" startBeat="${n.startBeat}" duration="${n.durationBeats}" />`);
            }
            lines.push('    </Clip>');
        } else {
            lines.push(`    <Clip trackId="${c.trackId}" name="${escapeXml(c.name)}" startBeat="${c.startBeat}" duration="${c.durationBeats}" mediaRef="${c.mediaRef ?? ''}" />`);
        }
    }

    lines.push('  </Clips>');
    lines.push('</DAWProject>');

    return lines.join('\n');
}

function escapeXml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
