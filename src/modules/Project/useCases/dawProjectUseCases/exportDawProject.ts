import { type DawProjectTrack, type DawProjectDocument } from '#/modules/Project/models/DawProjectTypes';

function escapeXml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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

/**
 * Export current project state to DAWproject XML format.
 * Uses string concatenation with escapeXml() for safe attribute encoding.
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
