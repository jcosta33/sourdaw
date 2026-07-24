import { describe, it, expect } from 'vitest';

import { parseProjectXml } from '../parseProjectXml';

// Canonical RFC-4122 UUIDs after the `track-` / `clip-` prefixes. The previous
// implementation truncated to `crypto.randomUUID().slice(0, 8)` for imported
// DAWproject track and clip ids — an 8-hex-char id that collides at scale and
// can alias two distinct imported tracks/clips onto one id. These regressions
// pin the full-UUID ids.
const TRACK_ID_PATTERN = /^track-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLIP_ID_PATTERN = /^clip-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Minimal valid Project wrapper with the given inner XML and transport. */
function project(
    inner: string,
    transport = '<Transport><Tempo value="120"/><TimeSignature numerator="4" denominator="4"/></Transport>'
): string {
    return `<?xml version="1.0"?><Project version="1.0">${transport}${inner}</Project>`;
}

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

describe('parseProjectXml — transport parsing', () => {
    it('returns 120 bpm / 4-4 defaults when there is no Transport element', () => {
        const result = parseProjectXml(project('<Structure></Structure>', ''));
        expect(result.initialTempo).toBe(120);
        expect(result.initialTimeSignature).toEqual({ numerator: 4, denominator: 4 });
    });

    it('reads the initial tempo and time signature from Transport', () => {
        const transport = '<Transport><Tempo value="96"/><TimeSignature numerator="6" denominator="8"/></Transport>';
        const result = parseProjectXml(project('<Structure></Structure>', transport));
        expect(result.initialTempo).toBe(96);
        expect(result.initialTimeSignature).toEqual({ numerator: 6, denominator: 8 });
    });

    it('falls back to 120/4-4 when Transport lacks Tempo/TimeSignature children', () => {
        const result = parseProjectXml(project('<Structure></Structure>', '<Transport></Transport>'));
        expect(result.initialTempo).toBe(120);
        expect(result.initialTimeSignature).toEqual({ numerator: 4, denominator: 4 });
    });
});

describe('parseProjectXml — root validation', () => {
    it('throws when the root element is not <Project>', () => {
        expect(() => parseProjectXml('<?xml version="1.0"?><Song></Song>')).toThrow(
            /Expected root <Project> element, got <Song>/
        );
    });
});

describe('parseProjectXml — track kind classification', () => {
    it('classifies a contentType="audio" track as audio', () => {
        const result = parseProjectXml(project('<Structure><Track id="t0" contentType="audio"/></Structure>'));
        expect(result.tracks[0]?.kind).toBe('audio');
    });

    it('classifies a contentType="notes" track as midi (and "midi" substring)', () => {
        const notes = parseProjectXml(project('<Structure><Track id="t0" contentType="notes"/></Structure>'));
        expect(notes.tracks[0]?.kind).toBe('midi');
        const midi = parseProjectXml(project('<Structure><Track id="t0" contentType="midi"/></Structure>'));
        expect(midi.tracks[0]?.kind).toBe('midi');
    });

    it('classifies a track with child <Track> elements as a folder', () => {
        const result = parseProjectXml(project('<Structure><Track id="t0"><Track id="t1"/></Track></Structure>'));
        expect(result.tracks[0]?.kind).toBe('folder');
    });

    it('classifies a masterChannel-type track as master', () => {
        const result = parseProjectXml(project('<Structure><Track id="t0" type="masterChannel"/></Structure>'));
        expect(result.tracks[0]?.kind).toBe('master');
    });

    it('classifies a master="true" track as master', () => {
        const result = parseProjectXml(project('<Structure><Track id="t0" master="true"/></Structure>'));
        expect(result.tracks[0]?.kind).toBe('master');
    });

    it('classifies a bus-type track as bus', () => {
        const result = parseProjectXml(project('<Structure><Track id="t0" type="bus"/></Structure>'));
        expect(result.tracks[0]?.kind).toBe('bus');
    });

    it('falls back to audio for an unrecognised track with no children', () => {
        const result = parseProjectXml(project('<Structure><Track id="t0"/></Structure>'));
        expect(result.tracks[0]?.kind).toBe('audio');
    });
});

describe('parseProjectXml — channel info parsing', () => {
    it('returns default volume/pan/mute/solo and no devices when a track has no Channel', () => {
        const result = parseProjectXml(project('<Structure><Track id="t0"/></Structure>'));
        expect(result.tracks[0]).toMatchObject({ volume: 0.8, pan: 0, mute: false, solo: false, deviceTypes: [] });
    });

    it('maps pan 0.5→0 (centre) and 1.0→1 (right), and reads mute/solo', () => {
        const channel =
            '<Channel><Volume value="0.5"/><Pan value="1.0"/><Mute value="true"/><Solo value="true"/></Channel>';
        const result = parseProjectXml(project(`<Structure><Track id="t0">${channel}</Track></Structure>`));
        expect(result.tracks[0]).toMatchObject({ volume: 0.5, pan: 1, mute: true, solo: true });
    });

    it('maps pan 0.0→-1 (full left) and 0.25→-0.5 (off-centre, non-fixed-point)', () => {
        const left = parseProjectXml(
            project('<Structure><Track id="t0"><Channel><Pan value="0.0"/></Channel></Track></Structure>')
        );
        expect(left.tracks[0]?.pan).toBe(-1);
        const offCentre = parseProjectXml(
            project('<Structure><Track id="t0"><Channel><Pan value="0.25"/></Channel></Track></Structure>')
        );
        // 0.25*2-1 = -0.5 — a non-fixed point that pins the pan*2-1 transform
        expect(offCentre.tracks[0]?.pan).toBe(-0.5);
    });

    it('collects device role names from a Channel Devices list', () => {
        const channel = '<Channel><Devices><Plugin deviceRole="Reverb"/><Effect role="Delay"/></Devices></Channel>';
        const result = parseProjectXml(project(`<Structure><Track id="t0">${channel}</Track></Structure>`));
        expect(result.tracks[0]?.deviceTypes).toEqual(['reverb', 'delay']);
    });
});

describe('parseProjectXml — color fallback', () => {
    it('uses the track color attribute when it is a hex string', () => {
        const result = parseProjectXml(project('<Structure><Track id="t0" color="#abcdef"/></Structure>'));
        expect(result.tracks[0]?.color).toBe('#abcdef');
    });

    it('falls back to the palette by structural index for a non-hex or missing color', () => {
        // index is the track's position in the structure, not the id attribute.
        const first = parseProjectXml(project('<Structure><Track id="t0"/></Structure>'));
        expect(first.tracks[0]?.color).toBe('#ef4444'); // palette[0]
        const badColor = parseProjectXml(project('<Structure><Track id="t0" color="red"/></Structure>'));
        expect(badColor.tracks[0]?.color).toBe('#ef4444'); // still index 0
        // a second track uses palette[1]
        const two = parseProjectXml(project('<Structure><Track id="t0"/><Track id="t1"/></Structure>'));
        expect(two.tracks[1]?.color).toBe('#f97316');
    });
});

describe('parseProjectXml — folder nesting + parentId', () => {
    it('assigns parent ids so nested tracks form a tree', () => {
        const result = parseProjectXml(
            project('<Structure><Track id="parent"><Track id="child"/></Track></Structure>')
        );
        expect(result.tracks).toHaveLength(2);
        const parent = result.tracks.find((t) => t.kind === 'folder');
        const child = result.tracks.find((t) => t.parentId !== null);
        expect(child?.parentId).toBe(parent?.id);
    });
});

describe('parseProjectXml — clip parsing', () => {
    it('parses a midi clip with notes, clamping velocity to [0,1]→0..127', () => {
        const inner =
            '<Structure><Track id="t0" contentType="notes"/></Structure>' +
            '<Arrangement><Lanes><Clips track="t0">' +
            '<Clip time="0" duration="4"><Notes>' +
            '<Note time="0" duration="1" key="60" vel="2.0"/>' + // over-1 clamps to 127
            '<Note time="0" duration="1" key="-1"/>' + // negative key dropped
            '</Notes></Clip></Clips></Lanes></Arrangement>';
        const result = parseProjectXml(project(inner));
        const clip = result.tracks[0]?.clips[0];
        expect(clip?.type).toBe('midi');
        expect(clip?.notes).toHaveLength(1);
        expect(clip?.notes?.[0]).toMatchObject({ pitch: 60, velocity: 127 });
    });

    it('parses an audio clip resolving the asset path from <Audio><File path=...>', () => {
        const inner =
            '<Structure><Track id="t0" contentType="audio"/></Structure>' +
            '<Arrangement><Lanes><Clips track="t0">' +
            '<Clip time="2" duration="4"><Audio><File path="drums.wav"/></Audio></Clip>' +
            '</Clips></Lanes></Arrangement>';
        const result = parseProjectXml(project(inner));
        const clip = result.tracks[0]?.clips[0];
        expect(clip?.type).toBe('audio');
        expect(clip?.audioAssetPath).toBe('drums.wav');
        expect(clip?.startBeat).toBe(2);
    });

    it('resolves an audio asset from a Warps>Audio wrapper and a file= attr', () => {
        const inner =
            '<Structure><Track id="t0" contentType="audio"/></Structure>' +
            '<Arrangement><Lanes><Clips track="t0">' +
            '<Clip time="0" duration="1"><Warps><Audio file="vocal.wav"/></Warps></Clip>' +
            '</Clips></Lanes></Arrangement>';
        const result = parseProjectXml(project(inner));
        expect(result.tracks[0]?.clips[0]?.audioAssetPath).toBe('vocal.wav');
    });

    it('emits an empty midi clip for a midi track whose clip has no notes/asset', () => {
        const inner =
            '<Structure><Track id="t0" contentType="notes"/></Structure>' +
            '<Arrangement><Lanes><Clips track="t0"><Clip time="0" duration="2"/></Clips></Lanes></Arrangement>';
        const result = parseProjectXml(project(inner));
        const clip = result.tracks[0]?.clips[0];
        expect(clip?.type).toBe('midi');
        expect(clip?.notes).toEqual([]);
    });

    it('drops a clip on a non-midi track that has no notes and no audio asset', () => {
        const inner =
            '<Structure><Track id="t0" contentType="audio"/></Structure>' +
            '<Arrangement><Lanes><Clips track="t0"><Clip time="0" duration="2"/></Clips></Lanes></Arrangement>';
        const result = parseProjectXml(project(inner));
        expect(result.tracks[0]?.clips).toHaveLength(0);
    });

    it('derives duration from playStop when duration is absent', () => {
        const inner =
            '<Structure><Track id="t0" contentType="notes"/></Structure>' +
            '<Arrangement><Lanes><Clips track="t0">' +
            '<Clip time="1" playStop="5"><Notes><Note time="0" key="60"/></Notes></Clip>' +
            '</Clips></Lanes></Arrangement>';
        const result = parseProjectXml(project(inner));
        const clip = result.tracks[0]?.clips[0];
        // start 1, duration 4 (5-1) → end 5, but floored to >= start+0.25
        expect(clip?.startBeat).toBe(1);
        expect(clip?.endBeat).toBeGreaterThanOrEqual(5);
    });

    it('falls back to a "Clip N" name when the clip has none', () => {
        const inner =
            '<Structure><Track id="t0" contentType="notes"/></Structure>' +
            '<Arrangement><Lanes><Clips track="t0"><Clip time="0" duration="1"><Notes><Note key="60"/></Notes></Clip></Clips></Lanes></Arrangement>';
        const result = parseProjectXml(project(inner));
        expect(result.tracks[0]?.clips[0]?.name).toBe('Clip 1');
    });
});

describe('parseProjectXml — time-unit conversion', () => {
    it('converts seconds-based note times to beats using the transport tempo', () => {
        // tempo 120 → 1 beat = 0.5s. A note at time 1s, duration 0.5s → beat 2, dur 1.
        // Notes inherit seconds from the parent (no overriding timeUnit on <Notes>).
        const transport = '<Transport><Tempo value="120"/></Transport>';
        const inner =
            '<Structure><Track id="t0" contentType="notes"/></Structure>' +
            '<Arrangement timeUnit="seconds"><Lanes timeUnit="seconds"><Clips track="t0">' +
            '<Clip time="0"><Notes><Note time="1" duration="0.5" key="60"/></Notes></Clip>' +
            '</Clips></Lanes></Arrangement>';
        const result = parseProjectXml(project(inner, transport));
        const clip = result.tracks[0]?.clips[0];
        const note = clip && clip.type === 'midi' ? clip.notes?.[0] : undefined;
        // 1s at 120bpm = (1/60)*120 = 2 beats; 0.5s = (0.5/60)*120 = 1 beat
        expect(note?.startBeat).toBe(2);
        expect(note?.duration).toBe(1);
    });

    it('uses 120 bpm as a safe tempo when the transport tempo is non-positive during seconds conversion', () => {
        const transport = '<Transport><Tempo value="0"/></Transport>';
        const inner =
            '<Structure><Track id="t0" contentType="notes"/></Structure>' +
            '<Arrangement timeUnit="seconds"><Lanes timeUnit="seconds"><Clips track="t0">' +
            '<Clip time="60"><Notes><Note time="60" duration="60" key="60"/></Notes></Clip>' +
            '</Clips></Lanes></Arrangement>';
        const result = parseProjectXml(project(inner, transport));
        // 60s at 120bpm (safe fallback) = 120 beats
        const clip = result.tracks[0]?.clips[0];
        const note = clip && clip.type === 'midi' ? clip.notes?.[0] : undefined;
        expect(note?.startBeat).toBe(120);
    });
});

describe('parseProjectXml — master-track automation', () => {
    it('parses tempo automation RealPoints into tempo changes', () => {
        const inner =
            '<Structure></Structure>' +
            '<Arrangement><Lanes><Automation target="tempo"><Points target="tempo">' +
            '<RealPoint time="4" value="140"/>' +
            '</Points></Automation></Lanes></Arrangement>';
        const result = parseProjectXml(project(inner));
        expect(result.tempoChanges).toEqual([{ beat: 4, tempo: 140 }]);
    });

    it('parses time-signature automation points', () => {
        const inner =
            '<Structure></Structure>' +
            '<Arrangement><Lanes><Automation target="timeSignature"><Points target="timeSignature">' +
            '<TimeSignaturePoint time="0" numerator="7" denominator="8"/>' +
            '</Points></Automation></Lanes></Arrangement>';
        const result = parseProjectXml(project(inner));
        expect(result.timeSignatureChanges).toEqual([{ beat: 0, numerator: 7, denominator: 8 }]);
    });

    it('returns empty automation when there is no Lanes element', () => {
        const inner = '<Structure></Structure><Arrangement></Arrangement>';
        const result = parseProjectXml(project(inner));
        expect(result.tempoChanges).toEqual([]);
        expect(result.timeSignatureChanges).toEqual([]);
    });
});

describe('parseProjectXml — markers', () => {
    it('parses named markers and converts their time to beats', () => {
        const inner =
            '<Structure></Structure>' +
            '<Arrangement><Markers><Marker time="8" name="Verse"/><Marker time="16"/></Markers></Arrangement>';
        const result = parseProjectXml(project(inner));
        expect(result.markers).toEqual([
            { beat: 8, name: 'Verse' },
            { beat: 16, name: 'Marker' },
        ]);
    });

    it('returns no markers when the Arrangement has no Markers element', () => {
        const inner = '<Structure></Structure><Arrangement></Arrangement>';
        const result = parseProjectXml(project(inner));
        expect(result.markers).toEqual([]);
    });
});

describe('parseProjectXml — clip routing via channel id', () => {
    it('resolves a clip lane addressed by channel id (not just track id)', () => {
        // Track references Channel id="ch7"; clip lane uses channel="ch7"
        const inner =
            '<Structure><Track id="t0" contentType="notes"><Channel id="ch7"/></Track></Structure>' +
            '<Arrangement><Lanes><Clips channel="ch7">' +
            '<Clip time="0" duration="1"><Notes><Note key="60"/></Notes></Clip>' +
            '</Clips></Lanes></Arrangement>';
        const result = parseProjectXml(project(inner));
        expect(result.tracks[0]?.clips).toHaveLength(1);
    });

    it('drops clip lanes whose track/channel target is unknown', () => {
        const inner =
            '<Structure><Track id="t0" contentType="notes"/></Structure>' +
            '<Arrangement><Lanes><Clips track="nope">' +
            '<Clip time="0" duration="1"><Notes><Note key="60"/></Notes></Clip>' +
            '</Clips></Lanes></Arrangement>';
        const result = parseProjectXml(project(inner));
        expect(result.tracks[0]?.clips).toHaveLength(0);
    });

    it('drops clip lanes that have neither a track nor a channel target attribute', () => {
        const inner =
            '<Structure><Track id="t0" contentType="notes"/></Structure>' +
            '<Arrangement><Lanes><Clips>' +
            '<Clip time="0" duration="1"><Notes><Note key="60"/></Notes></Clip>' +
            '</Clips></Lanes></Arrangement>';
        const result = parseProjectXml(project(inner));
        expect(result.tracks[0]?.clips).toHaveLength(0);
    });
});
