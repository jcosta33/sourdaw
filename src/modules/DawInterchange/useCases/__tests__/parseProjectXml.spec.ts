import { describe, it, expect } from 'vitest';

import { parseProjectXml } from '../parseProjectXml';

// Canonical RFC-4122 UUIDs after the `track-` / `clip-` prefixes. The previous
// implementation truncated to `crypto.randomUUID().slice(0, 8)` for imported
// DAWproject track and clip ids — an 8-hex-char id that collides at scale and
// can alias two distinct imported tracks/clips onto one id. These regressions
// pin the full-UUID ids.
const TRACK_ID_PATTERN = /^track-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLIP_ID_PATTERN = /^clip-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function buildProjectXml(trackCount: number): string {
    const tracks: string[] = [];
    const clipLanes: string[] = [];
    for (let index = 0; index < trackCount; index++) {
        const trackId = `t${String(index)}`;
        tracks.push(
            `<Track id="${trackId}" name="Keys ${String(index)}" contentType="notes">` +
                `<Channel id="c${String(index)}"><Volume value="0.8"/><Pan value="0.5"/></Channel>` +
                `</Track>`
        );
        clipLanes.push(
            `<Clips track="${trackId}">` +
                `<Clip time="0" duration="4" name="Stab ${String(index)}">` +
                `<Notes><Note time="0" duration="1" key="60" vel="0.8"/></Notes>` +
                `</Clip>` +
                `</Clips>`
        );
    }
    return (
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Project version="1.0">` +
        `<Transport><Tempo value="120"/><TimeSignature numerator="4" denominator="4"/></Transport>` +
        `<Structure>${tracks.join('')}</Structure>` +
        `<Arrangement timeUnit="beats"><Lanes timeUnit="beats">${clipLanes.join('')}</Lanes></Arrangement>` +
        `</Project>`
    );
}

describe('parseProjectXml', () => {
    it('assigns each imported track a full-UUID id (not an 8-char truncation)', () => {
        const result = parseProjectXml(buildProjectXml(1));
        expect(result.tracks).toHaveLength(1);
        expect(result.tracks[0]?.id).toMatch(TRACK_ID_PATTERN);
    });

    it('assigns each imported clip a full-UUID id (not an 8-char truncation)', () => {
        const result = parseProjectXml(buildProjectXml(1));
        const clip = result.tracks[0]?.clips[0];
        expect(clip).toBeDefined();
        expect(clip?.id).toMatch(CLIP_ID_PATTERN);
    });

    it('does not alias distinct imported tracks or clips onto colliding ids', () => {
        const result = parseProjectXml(buildProjectXml(64));
        const trackIds = result.tracks.map((track) => track.id);
        const clipIds = result.tracks.flatMap((track) => track.clips.map((clip) => clip.id));
        expect(trackIds).toHaveLength(64);
        expect(clipIds).toHaveLength(64);
        expect(new Set(trackIds).size).toBe(64);
        expect(new Set(clipIds).size).toBe(64);
    });
});
