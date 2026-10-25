import { describe, it, expect } from 'vitest';

import { tempoMapStore } from '#/modules/Transport/stores';
import { restoreTimelineMapSnapshot } from '#/modules/Transport/useCases';

import { mapToProjectData } from '../mapToProjectData';
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

    it('reports an explicit unsupported track type when it substitutes audio', () => {
        const result = parseProjectXml(
            project('<Structure><Track id="t0" name="Control" contentType="video"/></Structure>')
        );
        expect(result.warnings).toMatchObject([
            { kind: 'unsupported-track-type', name: 'video: Control', context: 'Control', handling: 'substituted' },
        ]);
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
        expect(result.warnings).toEqual([]);
    });

    it('reports one schema-valid direct Audio timeline that cannot become a clip', () => {
        const xml =
            '<?xml version="1.0"?><Project version="1.0">' +
            '<Application name="Fixture" version="1"/>' +
            '<Transport><Tempo value="120" unit="bpm"/><TimeSignature numerator="4" denominator="4"/></Transport>' +
            '<Structure><Track id="t0" name="Drums" contentType="audio"/></Structure>' +
            '<Arrangement><Lanes><Audio id="a0" track="t0" duration="4" channels="2" sampleRate="48000">' +
            '<File path="media.wav"/></Audio></Lanes></Arrangement></Project>';
        const parsed = parseProjectXml(xml);
        const mapped = mapToProjectData({
            parsed: { ...parsed, meta: { title: 'Audio', artist: '', comment: '' }, audioAssets: new Map() },
            bufferIdsByPath: new Map(),
            fileName: 'audio.dawproject',
        });

        expect(parsed.tracks[0]?.clips).toEqual([]);
        expect(mapped.arrangement.tracks.find((track) => track.name === 'Drums')?.clips).toEqual([]);
        expect(parsed.warnings).toEqual([
            {
                kind: 'unsupported-clip',
                name: 'media.wav',
                sourceType: 'Audio',
                sourceId: 'a0',
                context: 'Drums',
                handling: 'dropped',
                sourceOrder: expect.any(Number),
            },
        ]);
        expect(parsed.warnings[0]?.sourceOrder).toBeGreaterThan(0);
    });

    it('keeps nested Clips and their notes through project mapping', () => {
        const xml =
            '<?xml version="1.0"?><Project version="1.0">' +
            '<Application name="Fixture" version="1"/>' +
            '<Transport><Tempo value="120" unit="bpm"/><TimeSignature numerator="4" denominator="4"/></Transport>' +
            '<Structure><Track id="t0" name="Keys" contentType="notes"/></Structure>' +
            '<Arrangement><Lanes><Clips track="t0">' +
            '<Clip name="Container" time="0" duration="8"><Clips track="t0">' +
            '<Clip name="Nested phrase" time="2" duration="2"><Notes>' +
            '<Note time="0" duration="1" channel="0" key="67" vel="0.8"/>' +
            '</Notes></Clip></Clips></Clip></Clips></Lanes></Arrangement></Project>';
        const parsed = parseProjectXml(xml);
        const mapped = mapToProjectData({
            parsed: { ...parsed, meta: { title: 'Nested', artist: '', comment: '' }, audioAssets: new Map() },
            bufferIdsByPath: new Map(),
            fileName: 'nested.dawproject',
        });

        const clips = mapped.arrangement.tracks.find((track) => track.name === 'Keys')?.clips;
        expect(clips?.map((clip) => ({ name: clip.name, startBeat: clip.startBeat, endBeat: clip.endBeat }))).toEqual([
            { name: 'Container', startBeat: 0, endBeat: 8 },
            { name: 'Nested phrase', startBeat: 2, endBeat: 4 },
        ]);
        const nested = clips?.[1];
        expect(nested?.type).toBe('midi');
        expect(nested && mapped.midi.notesByClipId[nested.id]).toMatchObject([
            { pitch: 67, startBeat: 0, duration: 1, velocity: 102 },
        ]);
        expect(parsed.warnings).toEqual([]);
    });

    it('reports direct Audio inside nested Lanes without dropping its containing Clip', () => {
        const xml =
            '<Project version="1.0"><Application name="Fixture" version="1"/>' +
            '<Structure><Track id="t0" name="Keys" contentType="notes"/></Structure>' +
            '<Arrangement><Lanes><Clips track="t0">' +
            '<Clip name="Container" time="0" duration="8"><Lanes>' +
            '<Audio id="a0" track="t0" duration="4" channels="2" sampleRate="48000">' +
            '<File path="nested.wav"/></Audio></Lanes></Clip>' +
            '</Clips></Lanes></Arrangement></Project>';
        const parsed = parseProjectXml(xml);
        const mapped = mapToProjectData({
            parsed: { ...parsed, meta: { title: 'Nested audio', artist: '', comment: '' }, audioAssets: new Map() },
            bufferIdsByPath: new Map(),
            fileName: 'nested-audio.dawproject',
        });

        expect(mapped.arrangement.tracks.find((track) => track.name === 'Keys')?.clips).toMatchObject([
            { name: 'Container', startBeat: 0, endBeat: 8, type: 'midi' },
        ]);
        expect(parsed.warnings).toEqual([
            {
                kind: 'unsupported-clip',
                name: 'nested.wav',
                sourceType: 'Audio',
                sourceId: 'a0',
                context: 'Keys',
                handling: 'dropped',
                sourceOrder: expect.any(Number),
            },
        ]);
        expect(parsed.warnings[0]?.sourceOrder).toBeGreaterThan(0);
    });

    it('reports direct Video once and does not report its Clip wrapper twice', () => {
        const inner =
            '<Structure><Track id="t0" name="Picture" contentType="audio"/></Structure>' +
            '<Arrangement><Lanes>' +
            '<Video id="v0" name="Opening" track="t0" duration="2" channels="2" sampleRate="48000">' +
            '<File path="opening.mov"/></Video>' +
            '<Clips track="t0"><Clip name="Wrapped video" time="2" duration="2">' +
            '<Video duration="2" channels="2" sampleRate="48000"><File path="wrapped.mov"/></Video>' +
            '</Clip></Clips></Lanes></Arrangement>';
        const parsed = parseProjectXml(project(inner));

        expect(parsed.tracks[0]?.clips).toEqual([]);
        expect(parsed.warnings).toMatchObject([
            { kind: 'unsupported-clip', name: 'Opening', sourceType: 'Video', context: 'Picture' },
            { kind: 'unsupported-clip', name: 'wrapped.mov', sourceType: 'Video', context: 'Picture' },
        ]);
        expect(parsed.warnings).toHaveLength(2);
    });

    it('resolves an audio asset from a Warps>Audio wrapper and a file= attr', () => {
        const inner =
            '<Structure><Track id="t0" contentType="audio"/></Structure>' +
            '<Arrangement><Lanes><Clips track="t0">' +
            '<Clip time="0" duration="1"><Warps><Audio file="vocal.wav"/></Warps></Clip>' +
            '</Clips></Lanes></Arrangement>';
        const result = parseProjectXml(project(inner));
        expect(result.tracks[0]?.clips[0]?.audioAssetPath).toBe('vocal.wav');
        expect(result.warnings).toEqual([]);
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
        expect(result.warnings).toMatchObject([{ kind: 'unsupported-clip', sourceType: 'Clip', context: 'Track 1' }]);
    });

    it('reports each invalid MIDI note without dropping its containing clip', () => {
        const inner =
            '<Structure><Track id="t0" name="Keys" contentType="notes"/></Structure>' +
            '<Arrangement><Lanes><Clips track="t0"><Clip name="Verse" time="0" duration="2">' +
            '<Notes><Note id="bad" key="-1"/><Note key="60"/></Notes></Clip></Clips></Lanes></Arrangement>';
        const result = parseProjectXml(project(inner));
        expect(result.tracks[0]?.clips[0]?.notes).toHaveLength(1);
        expect(result.warnings).toMatchObject([
            { kind: 'invalid-note', name: 'key -1', sourceId: 'bad', context: 'Keys / Verse' },
        ]);
    });

    it('derives an omitted duration from the playStop - playStart window', () => {
        const inner =
            '<Structure><Track id="t0" contentType="notes"/></Structure>' +
            '<Arrangement><Lanes><Clips track="t0">' +
            '<Clip time="1" playStop="5"><Notes><Note time="0" key="60"/></Notes></Clip>' +
            '</Clips></Lanes></Arrangement>';
        const result = parseProjectXml(project(inner));
        const clip = result.tracks[0]?.clips[0];
        // The DAWproject Reference infers an omitted duration from the content
        // window playStop - playStart: 5 - 0 = 5 → start 1, end 6.
        expect(clip?.startBeat).toBe(1);
        expect(clip?.endBeat).toBe(6);
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

    it('reads clip note times in the clip content unit, not the timeline unit', () => {
        // The clip sits on a beats arrangement but declares
        // contentTimeUnit="seconds". Per the DAWproject Reference,
        // contentTimeUnit affects the content — the Notes here — but not the
        // clip's time and duration, which stay in beats.
        const transport = '<Transport><Tempo value="120"/></Transport>';
        const inner =
            '<Structure><Track id="t0" contentType="notes"/></Structure>' +
            '<Arrangement><Lanes><Clips track="t0">' +
            '<Clip time="0" duration="8" contentTimeUnit="seconds"><Notes>' +
            '<Note time="2.5" duration="0.5" key="60"/>' +
            '</Notes></Clip>' +
            '</Clips></Lanes></Arrangement>';
        const result = parseProjectXml(project(inner, transport));
        const clip = result.tracks[0]?.clips[0];
        // Clip window stays in the timeline unit: 0..8 beats.
        expect(clip?.startBeat).toBe(0);
        expect(clip?.endBeat).toBe(8);
        const note = clip && clip.type === 'midi' ? clip.notes?.[0] : undefined;
        // 2.5s at 120bpm = 5 beats; 0.5s = 1 beat. A timeline-unit fallback
        // would leave the note at beat 2.5 with duration 0.5.
        expect(note?.startBeat).toBe(5);
        expect(note?.duration).toBe(1);
    });
});

describe('parseProjectXml — master-track automation', () => {
    it('preserves supported tempo points inside an unsupported foreign automation wrapper', () => {
        const parsedXml = parseProjectXml(
            project(
                '<Structure></Structure><Arrangement><Lanes>' +
                    '<Automation name="Timing wrapper"><Points target="tempo">' +
                    '<RealPoint time="4" value="150"/></Points></Automation>' +
                    '</Lanes></Arrangement>'
            )
        );
        const projectData = mapToProjectData({
            parsed: {
                ...parsedXml,
                meta: { title: 'Timing', artist: '', comment: '' },
                audioAssets: new Map(),
            },
            bufferIdsByPath: new Map(),
            fileName: 'timing.dawproject',
        });

        expect(parsedXml.warnings).toMatchObject([
            {
                kind: 'unsupported-automation',
                name: 'Timing wrapper',
                sourceType: 'Automation',
                context: 'Arrangement',
                handling: 'dropped',
            },
        ]);
        expect(projectData.tempoMap).toEqual({ changes: [{ beat: 4, tempo: 150, curve: 'instant' }] });
    });

    it('parses tempo automation RealPoints into tempo changes', () => {
        const inner =
            '<Structure></Structure>' +
            '<Arrangement><Lanes><Automation target="tempo"><Points target="tempo">' +
            '<RealPoint time="4" value="140"/>' +
            '</Points></Automation></Lanes></Arrangement>';
        const result = parseProjectXml(project(inner));
        expect(result.tempoChanges).toEqual([{ beat: 4, tempo: 140, curve: 'instant' }]);
        expect(result.warnings).toEqual([]);
    });

    it('parses time-signature automation points', () => {
        const inner =
            '<Structure></Structure>' +
            '<Arrangement><Lanes><Automation target="timeSignature"><Points target="timeSignature">' +
            '<TimeSignaturePoint time="0" numerator="7" denominator="8"/>' +
            '</Points></Automation></Lanes></Arrangement>';
        const result = parseProjectXml(project(inner));
        expect(result.timeSignatureChanges).toEqual([{ beat: 0, numerator: 7, denominator: 8 }]);
        expect(result.warnings).toEqual([]);
    });

    it('keeps direct and nested tempo points once while reporting only unsupported siblings in source order', () => {
        const inner =
            '<Structure></Structure>' +
            '<Arrangement><Lanes>' +
            '<Automation target="tempo"><RealPoint time="2" value="130"/>' +
            '<Points target="tempo" timeUnit="seconds"><RealPoint time="2" value="140"/></Points>' +
            '</Automation>' +
            '<Points target="tempo"><RealPoint time="8" value="150"/></Points>' +
            '<Points name="Cutoff"><Target parameter="filter"/><RealPoint time="0" value="0.5"/></Points>' +
            '<Points name="Pan"><Target parameter="pan"/><RealPoint time="0" value="0.25"/></Points>' +
            '</Lanes></Arrangement>';
        const result = parseProjectXml(project(inner));

        expect(result.tempoChanges).toEqual([
            { beat: 2, tempo: 130, curve: 'instant' },
            { beat: 4, tempo: 140, curve: 'instant' },
            { beat: 8, tempo: 150, curve: 'instant' },
        ]);
        expect(result.warnings.map((warning) => warning.name)).toEqual(['Cutoff', 'Pan']);
        expect(result.warnings.map((warning) => warning.sourceType)).toEqual(['Points', 'Points']);
        expect(result.warnings[0]?.sourceOrder).toBeLessThan(result.warnings[1]!.sourceOrder);
    });

    it('returns empty automation when there is no Lanes element', () => {
        const inner = '<Structure></Structure><Arrangement></Arrangement>';
        const result = parseProjectXml(project(inner));
        expect(result.tempoChanges).toEqual([]);
        expect(result.timeSignatureChanges).toEqual([]);
    });

    it('reports named parameter automation and official top-level automation it cannot map', () => {
        const xml =
            '<Structure><Track id="t0" name="Lead" contentType="notes"/></Structure>' +
            '<Arrangement><TempoAutomation name="Tempo shape"><Points><RealPoint time="0" value="140"/></Points></TempoAutomation><Lanes>' +
            '<Points name="Cutoff" track="t0"><Target parameter="filter"/><RealPoint time="0" value="0.5"/></Points>' +
            '</Lanes></Arrangement>';
        const result = parseProjectXml(project(xml));
        expect(result.warnings).toMatchObject([
            { kind: 'unsupported-automation', name: 'Tempo shape', context: 'Arrangement' },
            { kind: 'unsupported-automation', name: 'Cutoff', context: 'Lead' },
        ]);
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
        expect(result.warnings).toMatchObject([{ kind: 'unsupported-clip', context: 'nope', sourceType: 'Clip' }]);
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

describe('parseProjectXml — inherited arrangement scope', () => {
    describe.each(['Audio', 'Warps/Audio'])('leaf %s source offsets', (route) => {
        const audio = '<Audio track="audio" file="audio.wav"/>';
        const content = route === 'Audio' ? audio : `<Warps track="keys">${audio}</Warps>`;

        it.each([
            {
                name: 'an active ramp',
                initialTempo: 100,
                points: '<RealPoint time="0" value="100" interpolation="linear"/><RealPoint time="16" value="140"/>',
                offset: 2,
            },
            {
                name: 'a preceding local tempo step',
                initialTempo: 120,
                points: '<RealPoint time="1" value="60"/>',
                offset: 2.4,
            },
        ])('keeps an explicit beat window and its source offset during $name', ({ initialTempo, points, offset }) => {
            const parsed = parseProjectXml(
                project(
                    '<Structure><Track id="keys" name="Keys" contentType="notes"/>' +
                        '<Track id="audio" name="Audio" contentType="audio"/></Structure>' +
                        `<Arrangement><Lanes><Points target="tempo">${points}</Points><Clips track="keys">` +
                        '<Clip name="Source window" time="4" duration="4" contentTimeUnit="seconds" playStart="1.2">' +
                        `${content}</Clip></Clips></Lanes></Arrangement>`,
                    `<Transport><Tempo value="${initialTempo}"/></Transport>`
                )
            );
            const mapped = mapToProjectData({
                parsed: { ...parsed, meta: { title: 'Source', artist: '', comment: '' }, audioAssets: new Map() },
                bufferIdsByPath: new Map([['audio.wav', 'buffer']]),
                fileName: 'source.dawproject',
            });

            expect(mapped.arrangement.tracks.find((track) => track.name === 'Keys')?.clips).toEqual([]);
            expect(mapped.arrangement.tracks.find((track) => track.name === 'Audio')?.clips).toMatchObject([
                { name: 'Source window', type: 'audio', startBeat: 4, endBeat: 8, sampleStartBeat: offset },
            ]);
            expect(parsed.warnings).toEqual([]);
        });

        it.each([
            {
                name: 'an inferred duration at a constant local tempo',
                duration: '',
                points: '<RealPoint time="4" value="60"/>',
                supported: true,
                endBeat: 9,
            },
            {
                name: 'an explicit source stop at a constant local tempo',
                duration: 'duration="2"',
                points: '<RealPoint time="4" value="60"/>',
                supported: true,
                endBeat: 10,
            },
            {
                name: 'an inferred duration during a ramp',
                duration: '',
                points: '<RealPoint time="0" value="100" interpolation="linear"/><RealPoint time="16" value="140"/>',
                supported: false,
                endBeat: 0,
            },
            {
                name: 'an inferred duration crossing a tempo step',
                duration: '',
                points: '<RealPoint time="7.5" value="60"/>',
                supported: false,
                endBeat: 0,
            },
            {
                name: 'an inferred duration with seconds-addressed tempo points',
                duration: '',
                points: '<RealPoint time="4" value="60"/>',
                tempoUnit: 'seconds',
                supported: false,
                endBeat: 0,
            },
            {
                name: 'an explicit source stop during a ramp',
                duration: 'duration="2"',
                points: '<RealPoint time="0" value="100" interpolation="linear"/><RealPoint time="16" value="140"/>',
                supported: false,
                endBeat: 0,
            },
        ])(
            'retains affine admission for $name and continues with a beat sibling',
            ({ duration, points, tempoUnit = 'beats', supported, endBeat }) => {
                const parsed = parseProjectXml(
                    project(
                        '<Structure><Track id="audio" name="Audio" contentType="audio"/></Structure>' +
                            `<Arrangement><Lanes><Points target="tempo" timeUnit="${tempoUnit}">${points}</Points>` +
                            '<Clips track="audio"><Clip id="window" name="Content window" time="8" ' +
                            `${duration} contentTimeUnit="seconds" playStart="1.2" playStop="2.2">${content}</Clip>` +
                            '<Clip name="Beat sibling" time="24" duration="1"><Audio file="audio.wav"/></Clip>' +
                            '</Clips></Lanes></Arrangement>',
                        '<Transport><Tempo value="100"/></Transport>'
                    )
                );

                if (supported) {
                    expect(parsed.tracks[0]?.clips).toMatchObject([
                        { name: 'Content window', startBeat: 8, endBeat, playStartBeat: 1.2 },
                        { name: 'Beat sibling', startBeat: 24, endBeat: 25 },
                    ]);
                    expect(parsed.warnings).toEqual([]);
                } else {
                    expect(parsed.tracks[0]?.clips.map((clip) => clip.name)).toEqual(['Beat sibling']);
                    expect(parsed.warnings).toMatchObject([
                        { kind: 'unsupported-clip', sourceId: 'window', context: 'Audio', handling: 'dropped' },
                    ]);
                    expect(parsed.warnings).toHaveLength(1);
                }
            }
        );
    });

    it.each([
        { name: 'Notes content', clipUnit: 'contentTimeUnit="seconds"', content: '<Notes><Note key="60"/></Notes>' },
        {
            name: 'Notes time-unit override',
            clipUnit: '',
            content: '<Notes timeUnit="seconds"><Note key="60"/></Notes>',
        },
        { name: 'seconds parent timeline', clipUnit: '', content: '<Audio file="audio.wav"/>', unit: 'seconds' },
        {
            name: 'seconds parent timeline with seconds-addressed tempo points',
            clipUnit: '',
            content: '<Audio file="audio.wav"/>',
            unit: 'seconds',
            tempoUnit: 'seconds',
        },
    ])(
        'still drops $name during a ramp and continues with a beat sibling',
        ({ clipUnit, content, unit = 'beats', tempoUnit = 'beats' }) => {
            const parsed = parseProjectXml(
                project(
                    '<Structure><Track id="audio" name="Audio" contentType="audio"/></Structure>' +
                        `<Arrangement><Lanes><Points target="tempo" timeUnit="${tempoUnit}">` +
                        '<RealPoint time="0" value="100" interpolation="linear"/><RealPoint time="16" value="140"/>' +
                        `</Points><Clips track="audio" timeUnit="${unit}">` +
                        `<Clip id="window" name="Content window" time="4" duration="4" ${clipUnit}>${content}</Clip>` +
                        '</Clips><Clips track="audio"><Clip name="Beat sibling" time="24" duration="1">' +
                        '<Audio file="audio.wav"/></Clip></Clips></Lanes></Arrangement>',
                    '<Transport><Tempo value="100"/></Transport>'
                )
            );

            expect(parsed.tracks[0]?.clips.map((clip) => clip.name)).toEqual(['Beat sibling']);
            expect(parsed.warnings).toMatchObject([
                { kind: 'unsupported-clip', sourceId: 'window', context: 'Audio', handling: 'dropped' },
            ]);
            expect(parsed.warnings).toHaveLength(1);
        }
    );

    it('routes the consumed Notes, Audio and Warps content to its nearest explicit owner exactly once', () => {
        const parsed = parseProjectXml(
            project(
                '<Structure><Track id="keys" name="Keys" contentType="notes"/>' +
                    '<Track id="drums" name="Drums" contentType="notes"><Channel id="drum-channel"/></Track></Structure>' +
                    '<Arrangement><Lanes track="keys"><Clips track="keys">' +
                    '<Clip track="keys" name="Notes" duration="2"><Notes track="drums"><Note key="60"/></Notes></Clip>' +
                    '<Clip name="Audio" duration="2"><Audio channel="drum-channel" file="audio.wav"/></Clip>' +
                    '<Clip name="Warps" duration="2"><Warps track="drums"><Audio file="warped.wav"/></Warps></Clip>' +
                    '<Clip name="Inner audio" duration="2"><Warps track="keys"><Audio track="drums" file="inner.wav"/></Warps></Clip>' +
                    '<Clip name="Sibling" duration="2"><Notes/></Clip>' +
                    '</Clips></Lanes></Arrangement>'
            )
        );
        const mapped = mapToProjectData({
            parsed: { ...parsed, meta: { title: 'Owners', artist: '', comment: '' }, audioAssets: new Map() },
            bufferIdsByPath: new Map([
                ['audio.wav', 'audio'],
                ['warped.wav', 'warped'],
                ['inner.wav', 'inner'],
            ]),
            fileName: 'owners.dawproject',
        });

        expect(
            mapped.arrangement.tracks.find((track) => track.name === 'Keys')?.clips.map((clip) => clip.name)
        ).toEqual(['Sibling']);
        const clips = mapped.arrangement.tracks.find((track) => track.name === 'Drums')?.clips;
        expect(clips?.map((clip) => [clip.name, clip.type])).toEqual([
            ['Notes', 'midi'],
            ['Audio', 'audio'],
            ['Warps', 'audio'],
            ['Inner audio', 'audio'],
        ]);
        expect(clips && mapped.midi.notesByClipId[clips[0]!.id]).toMatchObject([{ pitch: 60 }]);
        expect(parsed.warnings).toEqual([]);
    });

    it.each(['Notes', 'Audio', 'Warps', 'Warps/Audio'])(
        'drops unknown and empty explicit %s content owners without publishing an inherited empty clip',
        (tag) => {
            function content(reference: string, id: string): string {
                if (tag === 'Notes') {
                    return `<Notes id="${id}" track="${reference}"><Note key="60"/></Notes>`;
                }
                if (tag === 'Audio') {
                    return `<Audio id="${id}" track="${reference}" file="audio.wav"/>`;
                }
                if (tag === 'Warps/Audio') {
                    return `<Warps track="keys"><Audio id="${id}" track="${reference}" file="audio.wav"/></Warps>`;
                }
                return `<Warps id="${id}" track="${reference}"><Audio file="audio.wav"/></Warps>`;
            }
            const parsed = parseProjectXml(
                project(
                    '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                        '<Arrangement><Lanes track="keys"><Clips>' +
                        `<Clip name="Unknown" duration="2">${content('missing', 'unknown')}</Clip>` +
                        `<Clip name="Empty" duration="2">${content('', 'empty')}</Clip>` +
                        '</Clips></Lanes></Arrangement>'
                )
            );
            const mapped = mapToProjectData({
                parsed: { ...parsed, meta: { title: 'Owners', artist: '', comment: '' }, audioAssets: new Map() },
                bufferIdsByPath: new Map([['audio.wav', 'audio']]),
                fileName: 'owners.dawproject',
            });

            expect(mapped.arrangement.tracks.find((track) => track.name === 'Keys')?.clips).toEqual([]);
            expect(parsed.warnings).toMatchObject([
                {
                    kind: 'unsupported-clip',
                    sourceType: tag === 'Warps/Audio' ? 'Audio' : tag,
                    sourceId: 'unknown',
                    name: 'Unknown',
                    context: 'missing',
                    handling: 'dropped',
                },
                {
                    kind: 'unsupported-clip',
                    sourceType: tag === 'Warps/Audio' ? 'Audio' : tag,
                    sourceId: 'empty',
                    name: 'Empty',
                    context: '',
                    handling: 'dropped',
                },
            ]);
            expect(parsed.warnings).toHaveLength(2);
            expect(parsed.warnings[0]!.sourceOrder).toBeLessThan(parsed.warnings[1]!.sourceOrder);
        }
    );

    it.each([
        { name: 'preceding tempo', points: '<RealPoint time="4" value="60"/>', supported: true },
        {
            name: 'later tempo outside the window',
            points: '<RealPoint time="4" value="60"/><RealPoint time="20" value="90"/>',
            supported: true,
        },
        {
            name: 'seconds-addressed tempo map',
            points: '<RealPoint time="1" value="60"/><RealPoint time="2" value="90"/>',
            timeUnit: 'seconds',
            supported: false,
        },
        {
            name: 'tempo step across playStart',
            points: '<RealPoint time="7.5" value="60"/>',
            supported: false,
        },
        {
            name: 'tempo step inside the window',
            points: '<RealPoint time="4" value="60"/><RealPoint time="10" value="90"/>',
            supported: false,
        },
        {
            name: 'tempo ramp through the window',
            points: '<RealPoint time="4" value="60" interpolation="linear"/><RealPoint time="20" value="120"/>',
            supported: false,
        },
    ])(
        'uses or rejects the containing seconds transform for a $name before publishing it',
        ({ points, supported, timeUnit = 'beats' }) => {
            const parsed = parseProjectXml(
                project(
                    '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                        `<Arrangement><Lanes><Points target="tempo" timeUnit="${timeUnit}">${points}</Points><Clips track="keys">` +
                        '<Clip id="container" name="Container" time="8" duration="8" contentTimeUnit="seconds" playStart="1"><Clips>' +
                        '<Clip name="Seconds phrase" time="1.5" duration="1"><Notes><Note time="0" duration="0.5" key="60"/></Notes></Clip>' +
                        '</Clips></Clip><Clip name="Beat phrase" time="24" duration="1"><Notes timeUnit="beats">' +
                        '<Note key="67" duration="0.5"/></Notes></Clip></Clips></Lanes></Arrangement>'
                )
            );
            const mapped = mapToProjectData({
                parsed: { ...parsed, meta: { title: 'Seconds', artist: '', comment: '' }, audioAssets: new Map() },
                bufferIdsByPath: new Map(),
                fileName: 'seconds.dawproject',
            });
            const clips = mapped.arrangement.tracks.find((track) => track.name === 'Keys')?.clips;
            if (supported) {
                expect(clips?.map((clip) => [clip.name, clip.startBeat, clip.endBeat])).toEqual([
                    ['Container', 8, 16],
                    ['Seconds phrase', 8.5, 9.5],
                    ['Beat phrase', 24, 25],
                ]);
                const phrase = clips?.[1];
                expect(phrase && mapped.midi.notesByClipId[phrase.id]).toMatchObject([
                    { pitch: 60, startBeat: 0, duration: 0.5 },
                ]);
                expect(parsed.warnings).toEqual([]);
            } else {
                expect(clips?.map((clip) => [clip.name, clip.startBeat, clip.endBeat])).toEqual([
                    ['Beat phrase', 24, 25],
                ]);
                const phrase = clips?.[0];
                expect(phrase && mapped.midi.notesByClipId[phrase.id]).toMatchObject([{ pitch: 67, duration: 0.5 }]);
                expect(parsed.warnings).toMatchObject([
                    {
                        kind: 'unsupported-clip',
                        name: 'Container',
                        sourceId: 'container',
                        context: 'Keys',
                        handling: 'dropped',
                    },
                ]);
                expect(parsed.warnings).toHaveLength(1);
            }
        }
    );

    it('still reports unsupported direct Audio inside a seconds wrapper during a tempo ramp', () => {
        const parsed = parseProjectXml(
            project(
                '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                    '<Arrangement><Lanes track="keys"><Points target="tempo">' +
                    '<RealPoint time="4" value="60" interpolation="linear"/><RealPoint time="20" value="120"/>' +
                    '</Points><Clips><Clip name="Container" time="8" duration="8">' +
                    '<Lanes timeUnit="seconds"><Audio id="direct" file="audio.wav"/></Lanes>' +
                    '</Clip></Clips></Lanes></Arrangement>'
            )
        );

        expect(parsed.tracks[0]?.clips.map((clip) => clip.name)).toEqual(['Container']);
        expect(parsed.warnings).toMatchObject([
            { kind: 'unsupported-clip', sourceType: 'Audio', sourceId: 'direct', context: 'Keys' },
        ]);
        expect(parsed.warnings).toHaveLength(1);
    });

    it('drops non-integer and out-of-range notes while preserving MIDI boundary notes on the resolved owner', () => {
        const parsed = parseProjectXml(
            project(
                '<Structure><Track id="keys" name="Keys" contentType="notes"/><Track id="drums" name="Drums" contentType="notes"/></Structure>' +
                    '<Arrangement><Lanes track="drums"><Points target="tempo"><RealPoint time="4" value="60"/>' +
                    '<RealPoint time="20" value="90"/></Points><Clips><Clip name="Phrase" time="8" duration="2" contentTimeUnit="seconds"><Notes track="drums">' +
                    '<Note id="negative" key="-1"/><Note id="high" key="128" time="100"/><Note id="fractional" key="60.5"/>' +
                    '<Note key="0"/><Note key="127"/></Notes></Clip></Clips></Lanes></Arrangement>'
            )
        );
        const mapped = mapToProjectData({
            parsed: { ...parsed, meta: { title: 'Notes', artist: '', comment: '' }, audioAssets: new Map() },
            bufferIdsByPath: new Map(),
            fileName: 'notes.dawproject',
        });
        const clip = mapped.arrangement.tracks.find((track) => track.name === 'Drums')?.clips[0];
        expect(clip).toBeDefined();
        expect(clip && mapped.midi.notesByClipId[clip.id]?.map((note) => note.pitch)).toEqual([0, 127]);
        expect(parsed.warnings).toMatchObject([
            { kind: 'invalid-note', sourceId: 'negative', name: 'key -1', context: 'Drums / Phrase' },
            { kind: 'invalid-note', sourceId: 'high', name: 'key 128', context: 'Drums / Phrase' },
            { kind: 'invalid-note', sourceId: 'fractional', name: 'key 60.5', context: 'Drums / Phrase' },
        ]);
        expect(parsed.warnings).toHaveLength(3);
        expect(parsed.warnings.map((warning) => warning.sourceOrder)).toEqual(
            [...parsed.warnings.map((warning) => warning.sourceOrder)].sort((a, b) => a - b)
        );
    });

    it('maps a trackless Clips under its Lanes owner and names that owner in a sibling Video warning', () => {
        const xml = project(
            '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                '<Arrangement><Lanes track="keys"><Clips>' +
                '<Clip name="Phrase" time="0" duration="2"><Notes><Note time="0" duration="1" key="60"/></Notes></Clip>' +
                '</Clips><Video id="video" name="Picture" duration="2"><File path="picture.mov"/></Video></Lanes></Arrangement>'
        );
        const parsed = parseProjectXml(xml);
        const mapped = mapToProjectData({
            parsed: { ...parsed, meta: { title: 'Scopes', artist: '', comment: '' }, audioAssets: new Map() },
            bufferIdsByPath: new Map(),
            fileName: 'scopes.dawproject',
        });

        expect(mapped.arrangement.tracks.find((track) => track.name === 'Keys')?.clips).toMatchObject([
            { name: 'Phrase', startBeat: 0, endBeat: 2, type: 'midi' },
        ]);
        expect(parsed.warnings).toMatchObject([
            { kind: 'unsupported-clip', sourceType: 'Video', name: 'Picture', context: 'Keys', sourceId: 'video' },
        ]);
        expect(parsed.warnings).toHaveLength(1);
    });

    it('lets nested Lanes and Clips override the owner while invalid explicit references block inheritance', () => {
        const xml = project(
            '<Structure><Track id="keys" name="Keys" contentType="notes"/>' +
                '<Track id="drums" name="Drums" contentType="notes"><Channel id="drum-channel"/></Track></Structure>' +
                '<Arrangement><Lanes track="keys">' +
                '<Clips><Clip name="Keys phrase" time="0" duration="1"><Notes/></Clip></Clips>' +
                '<Lanes track="drums"><Clips><Clip name="Drums phrase" time="1" duration="1"><Notes/></Clip></Clips></Lanes>' +
                '<Clips channel="drum-channel"><Clip name="Channel phrase" time="2" duration="1"><Notes/></Clip></Clips>' +
                '<Clips track="missing"><Clip name="Missing phrase" time="3" duration="1"><Notes/></Clip></Clips>' +
                '<Clips track=""><Clip name="Empty phrase" time="4" duration="1"><Notes/></Clip></Clips>' +
                '<Clips><Clip name="Sibling phrase" time="5" duration="1"><Notes/></Clip></Clips>' +
                '</Lanes></Arrangement>'
        );
        const parsed = parseProjectXml(xml);

        expect(parsed.tracks.find((track) => track.name === 'Keys')?.clips.map((clip) => clip.name)).toEqual([
            'Keys phrase',
            'Sibling phrase',
        ]);
        expect(parsed.tracks.find((track) => track.name === 'Drums')?.clips.map((clip) => clip.name)).toEqual([
            'Drums phrase',
            'Channel phrase',
        ]);
        expect(parsed.warnings).toMatchObject([
            { name: 'Missing phrase', sourceType: 'Clip', context: 'missing', handling: 'dropped' },
            { name: 'Empty phrase', sourceType: 'Clip', context: '', handling: 'dropped' },
        ]);
        expect(parsed.warnings[0]?.sourceOrder).toBeLessThan(parsed.warnings[1]?.sourceOrder ?? 0);
    });

    it('places nested phrases at the containing clip origin across two levels without moving their notes', () => {
        const xml = project(
            '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                '<Arrangement><Lanes><Clips track="keys">' +
                '<Clip name="Container" time="8" duration="8"><Clips>' +
                '<Clip name="Nested" time="2" duration="4"><Clips>' +
                '<Clip name="Deep phrase" time="1" duration="1"><Notes><Note time="0" duration="1" key="67"/></Notes></Clip>' +
                '</Clips></Clip><Clip name="Phrase" time="2" duration="2"><Notes>' +
                '<Note time="0" duration="1" key="60"/></Notes></Clip>' +
                '</Clips></Clip><Clip name="Sibling" time="1" duration="1"><Notes/></Clip>' +
                '</Clips></Lanes></Arrangement>'
        );
        const parsed = parseProjectXml(xml);
        const mapped = mapToProjectData({
            parsed: { ...parsed, meta: { title: 'Nested', artist: '', comment: '' }, audioAssets: new Map() },
            bufferIdsByPath: new Map(),
            fileName: 'nested.dawproject',
        });
        const clips = mapped.arrangement.tracks.find((track) => track.name === 'Keys')?.clips;

        expect(clips?.map((clip) => [clip.name, clip.startBeat, clip.endBeat])).toEqual([
            ['Container', 8, 16],
            ['Nested', 10, 14],
            ['Deep phrase', 11, 12],
            ['Phrase', 10, 12],
            ['Sibling', 1, 2],
        ]);
        const phrase = clips?.find((clip) => clip.name === 'Phrase');
        expect(phrase && mapped.midi.notesByClipId[phrase.id]).toMatchObject([
            { pitch: 60, startBeat: 0, duration: 1 },
        ]);
        expect(parsed.warnings).toEqual([]);
    });

    it.each([
        { name: 'time', attributes: 'time="not-a-number" duration="1"' },
        { name: 'duration', attributes: 'time="0" duration="not-a-number"' },
        { name: 'time and duration', attributes: 'time="not-a-number" duration="not-a-number"' },
        { name: 'empty time', attributes: 'time="" duration="1"' },
        { name: 'whitespace duration', attributes: 'time="0" duration=" "' },
        { name: 'hexadecimal time', attributes: 'time="0x1" duration="1"' },
        { name: 'hexadecimal duration', attributes: 'time="0" duration="0x1"' },
    ])('warns and omits a nested phrase with malformed $name while preserving its siblings', ({ attributes }) => {
        const parsed = parseProjectXml(
            project(
                '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                    '<Arrangement><Lanes><Clips track="keys">' +
                    '<Clip id="container" name="Container" time="8" duration="8"><Clips>' +
                    '<Clip id="valid" name="Valid phrase" time="0" duration="1"><Notes>' +
                    '<Note time="0" duration="1" key="60"/></Notes></Clip>' +
                    '<Clip id="scientific" name="Scientific phrase" time="1e0" duration=".25"><Notes/></Clip>' +
                    `<Clip id="malformed" name="Malformed phrase" ${attributes}><Notes>` +
                    '<Note time="0" duration="1" key="62"/></Notes></Clip>' +
                    '<Clip id="optional" name="Optional defaults"><Notes/></Clip>' +
                    '</Clips></Clip></Clips></Lanes></Arrangement>'
            )
        );

        expect(parsed.tracks[0]?.clips.map((clip) => [clip.name, clip.startBeat, clip.endBeat])).toEqual([
            ['Container', 8, 16],
            ['Valid phrase', 8, 9],
            ['Scientific phrase', 9, 9.25],
            ['Optional defaults', 8, 8.25],
        ]);
        expect(parsed.warnings).toMatchObject([
            {
                kind: 'unsupported-clip',
                sourceType: 'Clip',
                sourceId: 'malformed',
                name: 'Malformed phrase',
                context: 'Keys',
                handling: 'dropped',
            },
        ]);
        expect(parsed.warnings).toHaveLength(1);
        expect(parsed.warnings[0]?.sourceOrder).toBeGreaterThan(0);
    });

    it('uses the parent content unit and playStart when placing a nested seconds phrase', () => {
        const xml = project(
            '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                '<Arrangement timeUnit="beats"><Lanes><Clips track="keys">' +
                '<Clip name="Container" time="8" duration="8" contentTimeUnit="seconds" playStart="1"><Clips>' +
                '<Clip name="Seconds phrase" time="1.5" duration="1"><Notes>' +
                '<Note time="0" duration="0.5" key="60"/></Notes></Clip>' +
                '</Clips></Clip></Clips></Lanes></Arrangement>'
        );
        const parsed = parseProjectXml(xml);
        const mapped = mapToProjectData({
            parsed: { ...parsed, meta: { title: 'Seconds', artist: '', comment: '' }, audioAssets: new Map() },
            bufferIdsByPath: new Map(),
            fileName: 'seconds.dawproject',
        });
        const phrase = mapped.arrangement.tracks
            .find((track) => track.name === 'Keys')
            ?.clips.find((clip) => clip.name === 'Seconds phrase');

        expect(phrase).toMatchObject({ startBeat: 9, endBeat: 11 });
        expect(phrase && mapped.midi.notesByClipId[phrase.id]).toMatchObject([
            { pitch: 60, startBeat: 0, duration: 1 },
        ]);
        expect(parsed.warnings).toEqual([]);
    });

    it('keeps disabled MIDI and audio material muted through nested clip scopes', () => {
        const parsed = parseProjectXml(
            project(
                '<Application name="Fixture DAW" version="1"/>' +
                    '<Structure><Track id="keys" name="Keys" contentType="notes"/>' +
                    '<Track id="audio" name="Audio" contentType="audio"/></Structure>' +
                    '<Arrangement><Lanes><Clips track="keys">' +
                    '<Clip id="midi-container" name="MIDI container" time="8" duration="8" enable="true"><Clips>' +
                    '<Clip id="midi-off" name="MIDI off" time="0" duration="1" enable="false"><Notes/></Clip>' +
                    '<Clip id="midi-zero" name="MIDI zero" time="1" duration="1" enable="0"><Notes/></Clip>' +
                    '<Clip id="midi-on" name="MIDI on" time="2" duration="1" enable="1"><Notes/></Clip>' +
                    '<Clip id="midi-default" name="MIDI default" time="3" duration="1"><Notes/></Clip>' +
                    '</Clips></Clip>' +
                    '<Clip id="midi-disabled-parent" name="Disabled parent" time="16" duration="4" enable="false"><Clips>' +
                    '<Clip id="midi-child-on" name="MIDI child on" time="1" duration="1" enable="true"><Notes/></Clip>' +
                    '</Clips></Clip></Clips>' +
                    '<Clips track="audio">' +
                    '<Clip id="audio-container" name="Audio container" time="8" duration="8"><Clips>' +
                    '<Clip id="audio-off" name="Audio off" time="0" duration="1" enable="0">' +
                    '<Audio channels="2" sampleRate="48000" duration="1"><File path="audio/off.wav"/></Audio></Clip>' +
                    '<Clip id="audio-on" name="Audio on" time="1" duration="1" enable="true">' +
                    '<Audio channels="2" sampleRate="48000" duration="1"><File path="audio/on.wav"/></Audio></Clip>' +
                    '</Clips></Clip>' +
                    '<Clip id="audio-disabled-parent" name="Audio disabled parent" time="16" duration="4" enable="0"><Clips>' +
                    '<Clip id="audio-child-on" name="Audio child on" time="1" duration="1" enable="1">' +
                    '<Audio channels="2" sampleRate="48000" duration="1"><File path="audio/child.wav"/></Audio></Clip>' +
                    '</Clips></Clip></Clips></Lanes></Arrangement>',
                ''
            )
        );
        const mapped = mapToProjectData({
            parsed: { ...parsed, meta: { title: 'Disabled clips', artist: '', comment: '' }, audioAssets: new Map() },
            bufferIdsByPath: new Map([
                ['audio/off.wav', 'off-buffer'],
                ['audio/on.wav', 'on-buffer'],
                ['audio/child.wav', 'child-buffer'],
            ]),
            fileName: 'disabled.dawproject',
        });
        const keys = parsed.tracks.find((track) => track.name === 'Keys');
        const audio = parsed.tracks.find((track) => track.name === 'Audio');
        expect(keys?.clips.map((clip) => [clip.sourceId, clip.startBeat, clip.endBeat])).toEqual([
            ['midi-container', 8, 16],
            ['midi-off', 8, 9],
            ['midi-zero', 9, 10],
            ['midi-on', 10, 11],
            ['midi-default', 11, 12],
            ['midi-disabled-parent', 16, 20],
            ['midi-child-on', 17, 18],
        ]);
        expect(audio?.clips.map((clip) => [clip.sourceId, clip.startBeat, clip.endBeat])).toEqual([
            ['audio-off', 8, 9],
            ['audio-on', 9, 10],
            ['audio-child-on', 17, 18],
        ]);
        const mappedKeys = mapped.arrangement.tracks.find((track) => track.name === 'Keys');
        const mappedAudio = mapped.arrangement.tracks.find((track) => track.name === 'Audio');
        expect(mappedKeys?.clips.map((clip) => [clip.name, clip.muted])).toEqual([
            ['MIDI container', false],
            ['MIDI off', true],
            ['MIDI zero', true],
            ['MIDI on', false],
            ['MIDI default', false],
            ['Disabled parent', true],
            ['MIDI child on', true],
        ]);
        expect(mappedAudio?.clips.map((clip) => [clip.name, clip.muted])).toEqual([
            ['Audio off', true],
            ['Audio on', false],
            ['Audio child on', true],
        ]);
        expect(parsed.warnings).toMatchObject([
            { kind: 'unsupported-clip', sourceId: 'audio-container', context: 'Audio' },
            { kind: 'unsupported-clip', sourceId: 'audio-disabled-parent', context: 'Audio' },
        ]);
        expect(parsed.warnings).toHaveLength(2);
        expect(parsed.warnings[0]!.sourceOrder).toBeLessThan(parsed.warnings[1]!.sourceOrder);
    });

    it('warns once and omits a nested repeat that cannot be placed without its loop transform', () => {
        const xml = project(
            '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                '<Arrangement><Lanes track="keys"><Clips>' +
                '<Clip id="loop" name="Looped container" time="8" duration="8" loopStart="0" loopEnd="2"><Clips>' +
                '<Clip name="Repeated phrase" time="0" duration="2"><Notes/></Clip>' +
                '</Clips></Clip></Clips></Lanes></Arrangement>'
        );
        const parsed = parseProjectXml(xml);

        expect(parsed.tracks.find((track) => track.name === 'Keys')?.clips).toEqual([]);
        expect(parsed.warnings).toMatchObject([
            { kind: 'unsupported-clip', sourceType: 'Clip', sourceId: 'loop', context: 'Keys', handling: 'dropped' },
        ]);
        expect(parsed.warnings).toHaveLength(1);
        expect(parsed.warnings[0]?.sourceOrder).toBeGreaterThan(0);
    });

    it.each([
        { name: 'outside child', attributes: 'time="5" duration="1"', content: '<Notes><Note key="67"/></Notes>' },
        { name: 'partly cropped child', attributes: 'time="3.5" duration="1"', content: '<Notes/>' },
        {
            name: 'looping child',
            attributes: 'time="1" duration="2" loopStart="0" loopEnd="0.5"',
            content: '<Clips><Clip duration="0.5"><Notes/></Clip></Clips>',
        },
        {
            name: 'referenced child',
            attributes: 'time="1" duration="2" reference="another-timeline"',
            content: '<Clips><Clip duration="1"><Notes/></Clip></Clips>',
        },
        {
            name: 'unknown child window',
            attributes: 'time="1"',
            content: '<Clips><Clip duration="1"><Notes/></Clip></Clips>',
        },
        {
            name: 'warped child',
            attributes: 'time="1" duration="2"',
            content:
                '<Warps><Clips><Clip duration="1"><Notes/></Clip></Clips>' +
                '<Warp time="0" contentTime="0"/><Warp time="2" contentTime="1"/></Warps>',
        },
        {
            name: 'non-affine seconds child',
            attributes: 'time="1" duration="1" timeUnit="seconds"',
            content: '<Notes/>',
        },
    ])('keeps an independently placeable sibling beside a nested $name', ({ attributes, content }) => {
        const parsed = parseProjectXml(
            project(
                '<Structure><Track id="keys" name="Keys" contentType="notes"/>' +
                    '<Track id="drums" name="Drums" contentType="notes"/></Structure>' +
                    '<Arrangement><Lanes track="keys"><Points target="tempo"><RealPoint time="10" value="60"/>' +
                    '</Points><Clips><Clip id="container" name="Container" time="8" duration="4"><Clips track="drums">' +
                    '<Clip id="valid" name="Valid phrase" time="0" duration="1"><Notes track="drums">' +
                    '<Note time="0" duration="1" key="60"/></Notes></Clip>' +
                    `<Clip id="rejected" name="Rejected phrase" ${attributes}>${content}</Clip>` +
                    '<Clip id="later-rejected" name="Later rejected phrase" time="6" duration="1"><Notes/></Clip>' +
                    '</Clips></Clip></Clips></Lanes></Arrangement>'
            )
        );
        const mapped = mapToProjectData({
            parsed: { ...parsed, meta: { title: 'Nested owners', artist: '', comment: '' }, audioAssets: new Map() },
            bufferIdsByPath: new Map(),
            fileName: 'nested-owners.dawproject',
        });

        expect(parsed.tracks.find((track) => track.name === 'Keys')?.clips.map((clip) => clip.name)).toEqual([
            'Container',
        ]);
        expect(parsed.tracks.find((track) => track.name === 'Drums')?.clips.map((clip) => clip.name)).toEqual([
            'Valid phrase',
        ]);
        expect(
            mapped.arrangement.tracks.find((track) => track.name === 'Keys')?.clips.map((clip) => clip.name)
        ).toEqual(['Container']);
        const clips = mapped.arrangement.tracks.find((track) => track.name === 'Drums')?.clips;
        expect(clips?.map((clip) => [clip.name, clip.startBeat, clip.endBeat])).toEqual([['Valid phrase', 8, 9]]);
        const phrase = clips?.[0];
        expect(phrase && mapped.midi.notesByClipId[phrase.id]).toMatchObject([
            { pitch: 60, startBeat: 0, duration: 1 },
        ]);
        expect(parsed.warnings).toMatchObject([
            {
                kind: 'unsupported-clip',
                sourceType: 'Clip',
                sourceId: 'rejected',
                name: 'Rejected phrase',
                context: 'Drums',
                handling: 'dropped',
            },
            {
                kind: 'unsupported-clip',
                sourceType: 'Clip',
                sourceId: 'later-rejected',
                name: 'Later rejected phrase',
                context: 'Drums',
                handling: 'dropped',
            },
        ]);
        expect(parsed.warnings).toHaveLength(2);
        expect(parsed.warnings[0]!.sourceOrder).toBeLessThan(parsed.warnings[1]!.sourceOrder);
    });

    it('rejects a warped nested route while keeping a separately affine route', () => {
        const parsed = parseProjectXml(
            project(
                '<Structure><Track id="keys" name="Keys" contentType="notes"/>' +
                    '<Track id="drums" name="Drums" contentType="notes"/></Structure>' +
                    '<Arrangement><Lanes track="keys"><Clips><Clip name="Container" time="8" duration="4">' +
                    '<Clips track="drums"><Clip name="Valid phrase" duration="1"><Notes><Note key="60"/></Notes></Clip></Clips>' +
                    '<Lanes track="drums"><Warps id="warped" name="Warped route"><Clips>' +
                    '<Clip name="Unplaceable phrase" duration="1"><Notes><Note key="67"/></Notes></Clip></Clips>' +
                    '<Warp time="0" contentTime="0"/><Warp time="4" contentTime="2"/>' +
                    '</Warps></Lanes></Clip></Clips></Lanes></Arrangement>'
            )
        );
        const mapped = mapToProjectData({
            parsed: { ...parsed, meta: { title: 'Routes', artist: '', comment: '' }, audioAssets: new Map() },
            bufferIdsByPath: new Map(),
            fileName: 'routes.dawproject',
        });

        expect(
            mapped.arrangement.tracks.find((track) => track.name === 'Keys')?.clips.map((clip) => clip.name)
        ).toEqual(['Container']);
        expect(
            mapped.arrangement.tracks
                .find((track) => track.name === 'Drums')
                ?.clips.map((clip) => [clip.name, clip.startBeat, clip.endBeat])
        ).toEqual([['Valid phrase', 8, 9]]);
        expect(parsed.warnings).toMatchObject([
            {
                kind: 'unsupported-clip',
                sourceType: 'Warps',
                sourceId: 'warped',
                name: 'Warped route',
                context: 'Drums',
                handling: 'dropped',
            },
        ]);
        expect(parsed.warnings).toHaveLength(1);
    });

    it.each([
        {
            name: 'cropped child',
            attributes: 'time="8" duration="2"',
            content: '<Clips><Clip time="2" duration="1"><Notes/></Clip></Clips>',
        },
        {
            name: 'unknown visible window',
            attributes: 'time="8"',
            content: '<Clips><Clip time="0" duration="1"><Notes/></Clip></Clips>',
        },
        {
            name: 'warped child',
            attributes: 'time="8" duration="4"',
            content:
                '<Warps contentTimeUnit="beats"><Clips><Clip time="0" duration="1"><Notes/></Clip></Clips>' +
                '<Warp time="0" contentTime="0"/><Warp time="4" contentTime="2"/></Warps>',
        },
        {
            name: 'referenced child',
            attributes: 'time="8" duration="4" reference="another-timeline"',
            content: '<Clips><Clip time="0" duration="1"><Notes/></Clip></Clips>',
        },
    ])('warns once and omits a nested $name instead of inventing a placement', ({ attributes, content }) => {
        const xml = project(
            '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                `<Arrangement><Lanes track="keys"><Clips><Clip id="container" name="Container" ${attributes}>` +
                `${content}</Clip></Clips></Lanes></Arrangement>`
        );
        const parsed = parseProjectXml(xml);

        expect(parsed.tracks[0]?.clips).toEqual([]);
        expect(parsed.warnings).toMatchObject([
            {
                kind: 'unsupported-clip',
                sourceType: 'Clip',
                sourceId: 'container',
                context: 'Keys',
                handling: 'dropped',
            },
        ]);
        expect(parsed.warnings).toHaveLength(1);
    });

    it('keeps a nested phrase inside a loop range that never repeats', () => {
        const xml = project(
            '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                '<Arrangement><Lanes track="keys"><Clips>' +
                '<Clip name="Container" time="8" duration="8" loopStart="0" loopEnd="8"><Clips>' +
                '<Clip name="Phrase" time="2" duration="2"><Notes/></Clip>' +
                '</Clips></Clip></Clips></Lanes></Arrangement>'
        );
        const parsed = parseProjectXml(xml);

        expect(parsed.tracks[0]?.clips.map((clip) => [clip.name, clip.startBeat, clip.endBeat])).toEqual([
            ['Container', 8, 16],
            ['Phrase', 10, 12],
        ]);
        expect(parsed.warnings).toEqual([]);
    });

    it.each([
        { name: 'blank time', attributes: 'time="" duration="1"' },
        { name: 'invalid duration', attributes: 'time="0" duration="bad"' },
        { name: 'hex playStart', attributes: 'time="0" duration="1" playStart="0x1"' },
        { name: 'blank playStop', attributes: 'time="0" playStop=" "' },
        { name: 'invalid loopStart', attributes: 'time="0" duration="1" loopStart="bad"' },
        { name: 'invalid loopEnd', attributes: 'time="0" duration="1" loopEnd="bad"' },
    ])('reports a top-level Clip with present malformed $name without losing siblings', ({ attributes }) => {
        const parsed = parseProjectXml(
            project(
                '<Application name="Fixture DAW" version="1"/>' +
                    '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                    '<Arrangement><Lanes><Clips track="keys">' +
                    `<Clip name="Malformed" ${attributes}><Notes/></Clip>` +
                    '<Clip name="Valid" time="2" duration="1"><Notes/></Clip>' +
                    '<Clip name="Scientific" time="3e0" duration=".5"><Notes/></Clip>' +
                    '<Clip name="Absent optional" time="4"><Notes/></Clip>' +
                    '</Clips></Lanes></Arrangement>',
                ''
            )
        );

        expect(parsed.tracks[0]?.clips.map((clip) => [clip.name, clip.startBeat, clip.endBeat])).toEqual([
            ['Valid', 2, 3],
            ['Scientific', 3, 3.5],
            ['Absent optional', 4, 4.25],
        ]);
        expect(parsed.warnings).toMatchObject([
            { kind: 'unsupported-clip', sourceType: 'Clip', name: 'Malformed', context: 'Keys', handling: 'dropped' },
        ]);
        expect(parsed.warnings).toHaveLength(1);
    });

    it('reports video-only MIDI clips once while preserving truly empty MIDI and a playable sibling', () => {
        const parsed = parseProjectXml(
            project(
                '<Application name="Fixture DAW" version="1"/>' +
                    '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                    '<Arrangement><Lanes><Clips track="keys">' +
                    '<Clip name="Video phrase" time="0" duration="2"><Video channels="2" sampleRate="48000" duration="2">' +
                    '<File path="wrapped.mov"/></Video></Clip>' +
                    '<Clip name="Empty phrase" time="2" duration="1"/>' +
                    '<Clip name="Playable" time="3" duration="1"><Notes><Note time="0" duration="1" channel="0" key="60"/></Notes></Clip>' +
                    '</Clips></Lanes></Arrangement>',
                ''
            )
        );
        const mapped = mapToProjectData({
            parsed: { ...parsed, meta: { title: 'Video', artist: '', comment: '' }, audioAssets: new Map() },
            bufferIdsByPath: new Map(),
            fileName: 'video.dawproject',
        });
        const clips = mapped.arrangement.tracks.find((track) => track.name === 'Keys')?.clips;

        expect(clips?.map((clip) => clip.name)).toEqual(['Empty phrase', 'Playable']);
        const playable = clips?.find((clip) => clip.name === 'Playable');
        expect(playable && mapped.midi.notesByClipId[playable.id]).toMatchObject([{ pitch: 60 }]);
        expect(parsed.warnings).toMatchObject([
            {
                kind: 'unsupported-clip',
                sourceType: 'Video',
                name: 'wrapped.mov',
                context: 'Keys',
                handling: 'dropped',
            },
        ]);
        expect(parsed.warnings).toHaveLength(1);
    });

    it('names the inherited and overridden owners of unsupported automation in source order', () => {
        const parsed = parseProjectXml(
            project(
                '<Application name="Fixture DAW" version="1"/>' +
                    '<Structure><Track id="lead" name="Lead" contentType="notes"/><Track id="drums" name="Drums" contentType="notes"/></Structure>' +
                    '<Arrangement><Lanes track="lead">' +
                    '<Points name="Cutoff"><Target expression="timbre"/><RealPoint time="0" value="0.5"/></Points>' +
                    '<Lanes track="drums"><Points name="Resonance"><Target expression="formant"/>' +
                    '<RealPoint time="1" value="0.6"/></Points></Lanes>' +
                    '<Points name="Unknown" track="missing"><Target expression="pressure"/>' +
                    '<RealPoint time="2" value="0.7"/></Points>' +
                    '</Lanes></Arrangement>',
                ''
            )
        );

        expect(parsed.warnings).toMatchObject([
            { kind: 'unsupported-automation', name: 'Cutoff', sourceType: 'Points', context: 'Lead' },
            { kind: 'unsupported-automation', name: 'Resonance', sourceType: 'Points', context: 'Drums' },
            { kind: 'unsupported-automation', name: 'Unknown', sourceType: 'Points', context: 'missing' },
        ]);
        expect(parsed.warnings).toHaveLength(3);
        expect(parsed.warnings.map((warning) => warning.sourceOrder)).toEqual(
            [...parsed.warnings.map((warning) => warning.sourceOrder)].sort((a, b) => a - b)
        );
    });

    it('maps a disabled Clip through a single Lanes/Notes owner without an empty inherited clip', () => {
        const parsed = parseProjectXml(
            project(
                '<Application name="Fixture DAW" version="1"/>' +
                    '<Structure><Track id="keys" name="Keys" contentType="notes"/><Track id="drums" name="Drums" contentType="notes"/></Structure>' +
                    '<Arrangement><Lanes><Clips track="keys">' +
                    '<Clip name="Wrapped" time="8" duration="4" enable="false"><Lanes track="drums"><Notes>' +
                    '<Note time="0" duration="1" channel="0" key="60"/></Notes></Lanes></Clip>' +
                    '<Clip name="Sibling" time="12" duration="1"><Notes><Note time="0" duration="1" channel="0" key="64"/></Notes></Clip>' +
                    '</Clips></Lanes></Arrangement>',
                ''
            )
        );
        const mapped = mapToProjectData({
            parsed: { ...parsed, meta: { title: 'Wrapped', artist: '', comment: '' }, audioAssets: new Map() },
            bufferIdsByPath: new Map(),
            fileName: 'wrapped.dawproject',
        });
        const keys = mapped.arrangement.tracks.find((track) => track.name === 'Keys')?.clips;
        const drums = mapped.arrangement.tracks.find((track) => track.name === 'Drums')?.clips;

        expect(keys?.map((clip) => clip.name)).toEqual(['Sibling']);
        expect(drums).toMatchObject([{ name: 'Wrapped', startBeat: 8, endBeat: 12, muted: true, type: 'midi' }]);
        const wrapped = drums?.[0];
        expect(wrapped && mapped.midi.notesByClipId[wrapped.id]).toMatchObject([{ pitch: 60, startBeat: 0 }]);
        expect(parsed.warnings).toEqual([]);
    });

    it('retains a muted Lanes/Notes phrase beside omitted automation on its nearest content owner', () => {
        const parsed = parseProjectXml(
            project(
                '<Structure><Track id="keys" name="Keys" contentType="notes"/><Track id="drums" name="Drums" contentType="notes"/></Structure>' +
                    '<Arrangement><Lanes><Clips track="keys">' +
                    '<Clip name="Mixed phrase" time="8" duration="4" enable="false"><Lanes track="keys">' +
                    '<Notes track="drums"><Note time=".5" duration="1" key="60"/></Notes>' +
                    '<Points id="cutoff" name="Cutoff"><Target expression="timbre"/><RealPoint time="0" value=".5"/></Points>' +
                    '</Lanes></Clip><Clip name="Sibling" time="12" duration="1"><Notes/></Clip>' +
                    '</Clips></Lanes></Arrangement>'
            )
        );
        const mapped = mapToProjectData({
            parsed: { ...parsed, meta: { title: 'Mixed', artist: '', comment: '' }, audioAssets: new Map() },
            bufferIdsByPath: new Map(),
            fileName: 'mixed.dawproject',
        });
        const drums = mapped.arrangement.tracks.find((track) => track.name === 'Drums')?.clips;
        expect(
            mapped.arrangement.tracks.find((track) => track.name === 'Keys')?.clips.map((clip) => clip.name)
        ).toEqual(['Sibling']);
        expect(drums).toMatchObject([{ name: 'Mixed phrase', startBeat: 8, endBeat: 12, muted: true, type: 'midi' }]);
        const phrase = drums?.[0];
        expect(phrase && mapped.midi.notesByClipId[phrase.id]).toMatchObject([
            { pitch: 60, startBeat: 0.5, duration: 1 },
        ]);
        expect(parsed.warnings).toMatchObject([
            {
                kind: 'unsupported-automation',
                sourceType: 'Points',
                sourceId: 'cutoff',
                name: 'Cutoff',
                context: 'Keys',
            },
        ]);
        expect(parsed.warnings).toHaveLength(1);
    });

    it.each([
        { time: 'not-a-number', duration: 'still-not-a-number' },
        { time: '100', duration: 'still-not-a-number' },
        { time: 'not-a-number', duration: '100' },
        { time: '0x10', duration: '1' },
        { time: '0', duration: '' },
    ])(
        'drops malformed note timing $time / $duration without extending the seconds clip window',
        ({ time, duration }) => {
            const parsed = parseProjectXml(
                project(
                    '<Structure><Track id="drums" name="Drums" contentType="notes"/></Structure>' +
                        '<Arrangement><Lanes track="drums"><Points target="tempo"><RealPoint time="4" value="60"/>' +
                        '<RealPoint time="20" value="90"/></Points><Clips>' +
                        '<Clip name="Phrase" time="8" duration="2" contentTimeUnit="seconds"><Notes>' +
                        `<Note id="bad" name="Malformed note" key="60" time="${time}" duration="${duration}"/>` +
                        '<Note key="64" time="5e-1" duration=".25"/><Note key="67"/>' +
                        '</Notes></Clip></Clips></Lanes></Arrangement>'
                )
            );
            expect(parsed.tracks[0]?.clips).toMatchObject([
                {
                    name: 'Phrase',
                    startBeat: 8,
                    endBeat: 10,
                    notes: [
                        { pitch: 64, startBeat: 0.5, duration: 0.25 },
                        { pitch: 67, startBeat: 0, duration: 0.25 },
                    ],
                },
            ]);
            expect(parsed.warnings).toMatchObject([
                {
                    kind: 'invalid-note',
                    name: 'Malformed note',
                    sourceId: 'bad',
                    sourceType: 'Note',
                    context: 'Drums / Phrase',
                },
            ]);
            expect(parsed.warnings).toHaveLength(1);
        }
    );

    it.each([
        '<Notes><Note key="60"/></Notes><Notes><Note key="64"/></Notes>',
        '<Lanes><Notes><Note key="60"/></Notes><Notes><Note key="64"/></Notes></Lanes>',
        '<Notes><Note key="60"/></Notes><Lanes><Notes><Note key="64"/></Notes></Lanes>',
        '<Lanes><Lanes><Notes><Note key="60"/></Notes><Notes><Note key="64"/></Notes></Lanes></Lanes>',
        '<Lanes><Notes><Note key="60"/></Notes><Lanes><Notes><Note key="64"/></Notes></Lanes></Lanes>',
    ])('reports ambiguous multiple Notes content without silently selecting a phrase: %s', (content) => {
        const parsed = parseProjectXml(
            project(
                '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                    `<Arrangement><Lanes><Clips track="keys"><Clip name="Ambiguous" duration="2">${content}</Clip>` +
                    '<Clip name="Sibling" time="2" duration="1"><Notes/></Clip></Clips></Lanes></Arrangement>'
            )
        );
        expect(parsed.tracks[0]?.clips.map((clip) => clip.name)).toEqual(['Sibling']);
        expect(parsed.warnings).toMatchObject([
            { kind: 'unsupported-clip', sourceType: 'Clip', name: 'Ambiguous', context: 'Keys', handling: 'dropped' },
        ]);
        expect(parsed.warnings).toHaveLength(1);
    });

    it.each([2, 4])(
        'preserves a muted Notes phrase through %i recursive Lanes with its owner and seconds unit',
        (depth) => {
            let content =
                '<Notes><Note time=".5" duration=".5" key="60"/></Notes>' +
                '<Points id="cutoff" name="Cutoff"><Target expression="timbre"/><RealPoint time="0" value=".5"/></Points>';
            content = `<Lanes track="drums" timeUnit="seconds">${content}</Lanes>`;
            for (let level = 1; level < depth; level++) {
                content = `<Lanes track="keys" timeUnit="beats">${content}</Lanes>`;
            }
            const parsed = parseProjectXml(
                project(
                    '<Structure><Track id="keys" name="Keys" contentType="notes"/><Track id="drums" name="Drums" contentType="notes"/></Structure>' +
                        '<Arrangement><Lanes><Clips track="keys">' +
                        `<Clip name="Recursive phrase" time="8" duration="4" enable="false">${content}</Clip>` +
                        '<Clip name="Sibling" time="12" duration="1"><Notes><Note key="64"/></Notes></Clip>' +
                        '</Clips></Lanes></Arrangement>'
                )
            );
            const mapped = mapToProjectData({
                parsed: { ...parsed, meta: { title: 'Recursive', artist: '', comment: '' }, audioAssets: new Map() },
                bufferIdsByPath: new Map(),
                fileName: 'recursive.dawproject',
            });
            expect(
                mapped.arrangement.tracks.find((track) => track.name === 'Keys')?.clips.map((clip) => clip.name)
            ).toEqual(['Sibling']);
            const drums = mapped.arrangement.tracks.find((track) => track.name === 'Drums')?.clips;
            expect(drums).toMatchObject([
                { name: 'Recursive phrase', startBeat: 8, endBeat: 12, muted: true, type: 'midi' },
            ]);
            const phrase = drums?.[0];
            expect(phrase && mapped.midi.notesByClipId[phrase.id]).toMatchObject([
                { pitch: 60, startBeat: 1, duration: 1 },
            ]);
            expect(parsed.warnings).toMatchObject([
                {
                    kind: 'unsupported-automation',
                    sourceType: 'Points',
                    sourceId: 'cutoff',
                    name: 'Cutoff',
                    context: 'Drums',
                },
            ]);
            expect(parsed.warnings).toHaveLength(1);
        }
    );

    it.each([
        { unit: '', supported: false },
        { unit: 'timeUnit="beats"', supported: true },
    ])('checks the recursive Notes extent with its effective unit $unit', ({ unit, supported }) => {
        const parsed = parseProjectXml(
            project(
                '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                    '<Arrangement><Lanes><Points target="tempo"><RealPoint time="10" value="60"/></Points><Clips track="keys">' +
                    '<Clip name="Recursive phrase" time="8" duration="1"><Lanes><Lanes timeUnit="seconds">' +
                    `<Notes ${unit}><Note key="60" time="1" duration="1"/></Notes></Lanes></Lanes></Clip>` +
                    '<Clip name="Sibling" time="12" duration="1"><Notes/></Clip></Clips></Lanes></Arrangement>'
            )
        );
        expect(parsed.tracks[0]?.clips.map((clip) => clip.name)).toEqual(
            supported ? ['Recursive phrase', 'Sibling'] : ['Sibling']
        );
        expect(parsed.warnings.map((warning) => warning.name)).toEqual(supported ? [] : ['Recursive phrase']);
    });

    it.each(['missing', ''])('does not inherit past an explicit recursive Notes owner %s', (owner) => {
        const parsed = parseProjectXml(
            project(
                '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                    '<Arrangement><Lanes><Clips track="keys"><Clip name="Unassigned" duration="2">' +
                    `<Lanes><Lanes track="${owner}"><Notes><Note key="60"/></Notes></Lanes></Lanes></Clip>` +
                    '<Clip name="Sibling" time="2" duration="1"><Notes/></Clip></Clips></Lanes></Arrangement>'
            )
        );
        expect(parsed.tracks[0]?.clips.map((clip) => clip.name)).toEqual(['Sibling']);
        expect(parsed.warnings).toMatchObject([
            { kind: 'unsupported-clip', name: 'Unassigned', context: owner, sourceType: 'Lanes' },
        ]);
        expect(parsed.warnings).toHaveLength(1);
    });

    it('keeps recursive Notes separate from nested child Clips and Warps timelines', () => {
        const parsed = parseProjectXml(
            project(
                '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                    '<Arrangement><Lanes><Clips track="keys"><Clip name="Parent" time="8" duration="4" enable="false">' +
                    '<Lanes><Lanes><Notes><Note key="60"/></Notes>' +
                    '<Clips><Clip name="Child" time="1" duration="1"><Notes><Note key="64"/></Notes></Clip></Clips>' +
                    '<Warps><Notes><Note key="67"/></Notes></Warps>' +
                    '</Lanes></Lanes></Clip></Clips></Lanes></Arrangement>'
            )
        );
        expect(parsed.tracks[0]?.clips).toMatchObject([
            { name: 'Parent', startBeat: 8, endBeat: 12, muted: true, notes: [{ pitch: 60 }] },
            { name: 'Child', startBeat: 9, endBeat: 10, muted: true, notes: [{ pitch: 64 }] },
        ]);
        expect(parsed.tracks[0]?.clips).toHaveLength(2);
        expect(parsed.warnings).toMatchObject([
            { kind: 'unsupported-clip', sourceType: 'Warps', name: 'Warps', context: 'Keys', handling: 'dropped' },
        ]);
        expect(parsed.warnings).toHaveLength(1);
    });

    it('warns for dropped warped Notes beside a supported muted phrase and an outside child', () => {
        const parsed = parseProjectXml(
            project(
                '<Structure><Track id="keys" name="Keys" contentType="notes"/>' +
                    '<Track id="drums" name="Drums" contentType="notes"/></Structure>' +
                    '<Arrangement><Lanes><Clips track="keys">' +
                    '<Clip name="Parent" time="8" duration="4" enable="false"><Lanes track="drums">' +
                    '<Notes><Note time=".5" duration="1" channel="0" key="60"/></Notes>' +
                    '<Warps id="warped" track="drums" contentTimeUnit="beats"><Notes>' +
                    '<Note time="0" duration="1" channel="0" key="67"/></Notes>' +
                    '<Warp time="0" contentTime="0"/><Warp time="4" contentTime="2"/></Warps>' +
                    '<Clips><Clip name="Outside" time="5" duration="1"><Notes>' +
                    '<Note time="0" duration="1" channel="0" key="64"/></Notes></Clip></Clips>' +
                    '</Lanes></Clip>' +
                    '<Clip name="Independent" time="20" duration="1"><Notes>' +
                    '<Note time="0" duration=".5" channel="0" key="72"/></Notes></Clip>' +
                    '</Clips></Lanes></Arrangement>'
            )
        );
        const mapped = mapToProjectData({
            parsed: { ...parsed, meta: { title: 'Nested', artist: '', comment: '' }, audioAssets: new Map() },
            bufferIdsByPath: new Map(),
            fileName: 'nested.dawproject',
        });
        const keys = mapped.arrangement.tracks.find((track) => track.name === 'Keys')?.clips;
        const drums = mapped.arrangement.tracks.find((track) => track.name === 'Drums')?.clips;

        expect(keys).toMatchObject([{ name: 'Independent', startBeat: 20, endBeat: 21 }]);
        expect(drums).toMatchObject([{ name: 'Parent', startBeat: 8, endBeat: 12, muted: true }]);
        const phrase = drums?.[0];
        expect(phrase && mapped.midi.notesByClipId[phrase.id]).toMatchObject([
            { pitch: 60, startBeat: 0.5, duration: 1 },
        ]);
        const independent = keys?.[0];
        expect(independent && mapped.midi.notesByClipId[independent.id]).toMatchObject([{ pitch: 72 }]);
        expect(
            Object.values(mapped.midi.notesByClipId)
                .flat()
                .map((note) => note.pitch)
                .sort((left, right) => left - right)
        ).toEqual([60, 72]);
        expect(parsed.warnings).toMatchObject([
            {
                kind: 'unsupported-clip',
                sourceType: 'Warps',
                sourceId: 'warped',
                name: 'Warps',
                context: 'Drums',
                handling: 'dropped',
            },
            { kind: 'unsupported-clip', sourceType: 'Clip', name: 'Outside', context: 'Drums', handling: 'dropped' },
        ]);
        expect(parsed.warnings).toHaveLength(2);
        expect(parsed.warnings[0]!.sourceOrder).toBeGreaterThan(0);
        expect(parsed.warnings[0]!.sourceOrder).toBeLessThan(parsed.warnings[1]!.sourceOrder);
    });

    it('keeps a muted recursive Notes phrase when its only child Clip falls outside the parent window', () => {
        const parsed = parseProjectXml(
            project(
                '<Structure><Track id="keys" name="Keys" contentType="notes"/><Track id="drums" name="Drums" contentType="notes"/></Structure>' +
                    '<Arrangement><Lanes><Clips track="keys">' +
                    '<Clip name="Parent" time="8" duration="4" enable="false"><Lanes track="drums">' +
                    '<Notes><Note time=".5" duration="1" channel="0" key="60"/></Notes>' +
                    '<Clips><Clip name="Outside" time="5" duration="1"><Notes><Note time="0" duration="1" channel="0" key="64"/></Notes></Clip></Clips>' +
                    '</Lanes></Clip>' +
                    '<Clip name="Independent" time="20" duration="1"><Notes><Note time="0" duration=".5" channel="0" key="67"/></Notes></Clip>' +
                    '</Clips></Lanes></Arrangement>'
            )
        );
        const mapped = mapToProjectData({
            parsed: { ...parsed, meta: { title: 'Nested', artist: '', comment: '' }, audioAssets: new Map() },
            bufferIdsByPath: new Map(),
            fileName: 'nested.dawproject',
        });
        const keys = mapped.arrangement.tracks.find((track) => track.name === 'Keys')?.clips;
        const drums = mapped.arrangement.tracks.find((track) => track.name === 'Drums')?.clips;

        expect(keys).toMatchObject([{ name: 'Independent', startBeat: 20, endBeat: 21 }]);
        expect(drums).toMatchObject([{ name: 'Parent', startBeat: 8, endBeat: 12, muted: true }]);
        const phrase = drums?.[0];
        expect(phrase && mapped.midi.notesByClipId[phrase.id]).toMatchObject([
            { pitch: 60, startBeat: 0.5, duration: 1 },
        ]);
        expect(parsed.warnings).toMatchObject([
            { kind: 'unsupported-clip', sourceType: 'Clip', name: 'Outside', context: 'Drums', handling: 'dropped' },
        ]);
        expect(parsed.warnings).toHaveLength(1);
        expect(parsed.warnings[0]?.sourceId).toBeUndefined();
    });

    it('keeps an accepted Notes phrase when an unplaceable child timeline is added', () => {
        function importPhrase(nestedClips: string) {
            const parsed = parseProjectXml(
                project(
                    '<Structure><Track id="keys" name="Keys" contentType="notes"/>' +
                        '<Track id="drums" name="Drums" contentType="notes"/></Structure>' +
                        '<Arrangement><Lanes><Clips track="keys">' +
                        '<Clip name="Parent Phrase" time="8" playStart="1" enable="false"><Lanes track="drums">' +
                        `<Notes><Note time="1" duration=".25" channel="0" key="60"/></Notes>${nestedClips}</Lanes></Clip>` +
                        '<Clip name="Independent Keys" time="20" duration="1"><Notes>' +
                        '<Note time="0" duration="1" channel="0" key="72"/></Notes></Clip>' +
                        '</Clips></Lanes></Arrangement>'
                )
            );
            const mapped = mapToProjectData({
                parsed: { ...parsed, meta: { title: 'Nested', artist: '', comment: '' }, audioAssets: new Map() },
                bufferIdsByPath: new Map(),
                fileName: 'nested.dawproject',
            });
            const keys = mapped.arrangement.tracks.find((track) => track.name === 'Keys')?.clips;
            const drums = mapped.arrangement.tracks.find((track) => track.name === 'Drums')?.clips;
            const phrase = drums?.[0];
            return {
                parsed,
                keys: keys?.map((clip) => [clip.name, clip.startBeat, clip.endBeat]),
                drums: drums?.map((clip) => [
                    clip.name,
                    clip.startBeat,
                    clip.endBeat,
                    clip.midiOffsetBeats,
                    clip.muted,
                ]),
                notes:
                    phrase &&
                    mapped.midi.notesByClipId[phrase.id]?.map((note) => [note.pitch, note.startBeat, note.duration]),
            };
        }

        const control = importPhrase('');
        expect(control.keys).toEqual([['Independent Keys', 20, 21]]);
        expect(control.drums).toEqual([['Parent Phrase', 8, 8.25, 1, true]]);
        expect(control.notes).toEqual([[60, 1, 0.25]]);
        expect(control.parsed.warnings).toEqual([]);

        const withChild = importPhrase(
            '<Clips><Clip name="Nested Branch" time="1" duration="1"><Notes>' +
                '<Note time="0" duration="1" channel="0" key="64"/></Notes></Clip></Clips>'
        );
        expect(withChild.keys).toEqual(control.keys);
        expect(withChild.drums).toEqual(control.drums);
        expect(withChild.notes).toEqual(control.notes);
        expect(withChild.parsed.warnings).toMatchObject([
            {
                kind: 'unsupported-clip',
                sourceType: 'Clip',
                name: 'Nested Branch',
                context: 'Drums',
                handling: 'dropped',
            },
        ]);
        expect(withChild.parsed.warnings).toHaveLength(1);
    });

    it.each([
        { time: 'not-a-number', unit: 'beats' },
        { time: '1e309', unit: 'beats' },
        { time: 'not-a-number', unit: 'seconds' },
        { time: '1e309', unit: 'seconds' },
    ])('omits a malformed $unit tempo point at $time before converting valid seconds notes', ({ time, unit }) => {
        const parsed = parseProjectXml(
            project(
                '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                    `<Arrangement><Lanes><Points name="Tempo shape" target="tempo" timeUnit="${unit}">` +
                    `<RealPoint id="bad-tempo" time="${time}" value="60"/></Points>` +
                    '<Clips track="keys"><Clip name="Seconds phrase" duration="4"><Lanes><Lanes timeUnit="seconds">' +
                    '<Notes><Note key="60" time="1" duration=".5"/></Notes></Lanes></Lanes></Clip>' +
                    '</Clips></Lanes></Arrangement>'
            )
        );
        expect(parsed.tempoChanges).toEqual([]);
        expect(parsed.tracks[0]?.clips).toMatchObject([
            { name: 'Seconds phrase', notes: [{ pitch: 60, startBeat: 2, duration: 1 }] },
        ]);
        expect(parsed.warnings).toMatchObject([
            {
                kind: 'unsupported-automation',
                sourceType: 'RealPoint',
                sourceId: 'bad-tempo',
                name: 'Tempo shape',
                context: 'Arrangement',
            },
        ]);
        expect(parsed.warnings).toHaveLength(1);
    });

    it('validates both present tempo scalars while retaining decimal, scientific, default and ramp siblings', () => {
        const parsed = parseProjectXml(
            project(
                '<Structure/><Arrangement><Lanes><Points name="Tempo shape" target="tempo">' +
                    '<RealPoint id="bad-value" time="0" value="not-a-number"/>' +
                    '<RealPoint id="bad-both" time="1e309" value="1e309"/>' +
                    '<RealPoint id="empty-time" time="" value="60"/>' +
                    '<RealPoint id="hex-value" time="0" value="0x40"/>' +
                    '<RealPoint/>' +
                    '<RealPoint time="+2.5e0" value="1.3e2" interpolation="linear"/>' +
                    '<RealPoint time="4." value="140"/>' +
                    '</Points></Lanes></Arrangement>'
            )
        );
        expect(parsed.tempoChanges).toEqual([
            { beat: 0, tempo: 120, curve: 'instant' },
            { beat: 2.5, tempo: 130, curve: 'linear' },
            { beat: 4, tempo: 140, curve: 'instant' },
        ]);
        expect(parsed.warnings.map((warning) => warning.sourceId)).toEqual([
            'bad-value',
            'bad-both',
            'empty-time',
            'hex-value',
        ]);
        expect(
            parsed.warnings.every(
                (warning) =>
                    warning.kind === 'unsupported-automation' &&
                    warning.sourceType === 'RealPoint' &&
                    warning.name === 'Tempo shape'
            )
        ).toBe(true);
        expect(parsed.warnings.map((warning) => warning.sourceOrder)).toEqual(
            [...parsed.warnings.map((warning) => warning.sourceOrder)].sort((a, b) => a - b)
        );
    });

    it.each([
        { time: '0', value: '19' },
        { time: '0', value: '1000' },
        { time: '-1', value: '60' },
    ])('rejects a tempo point outside store bounds before converting seconds: $time / $value', ({ time, value }) => {
        const parsed = parseProjectXml(
            project(
                '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                    '<Arrangement timeUnit="seconds"><Lanes><Points name="Tempo shape" target="tempo" timeUnit="beats">' +
                    `<RealPoint id="invalid-tempo" time="${time}" value="${value}"/>` +
                    '<RealPoint time="20" value="150"/></Points><Clips track="keys">' +
                    '<Clip name="Seconds phrase" time="4" duration="2" contentTimeUnit="seconds"><Notes>' +
                    '<Note time="1" duration=".5" channel="0" key="60"/></Notes></Clip>' +
                    '<Clip name="Beat sibling" timeUnit="beats" time="20" duration="1"><Notes>' +
                    '<Note time="0" duration=".5" channel="0" key="64"/></Notes></Clip>' +
                    '</Clips></Lanes></Arrangement>'
            )
        );
        const mapped = mapToProjectData({
            parsed: { ...parsed, meta: { title: 'Tempo', artist: '', comment: '' }, audioAssets: new Map() },
            bufferIdsByPath: new Map(),
            fileName: 'tempo.dawproject',
        });
        const clips = mapped.arrangement.tracks.find((track) => track.name === 'Keys')?.clips;

        expect(parsed.tempoChanges).toEqual([{ beat: 20, tempo: 150, curve: 'instant' }]);
        expect(parsed.warnings.map((warning) => warning.name)).toEqual(['Tempo shape']);
        expect(parsed.tracks[0]?.clips).toMatchObject([
            { name: 'Seconds phrase', startBeat: 8, endBeat: 12 },
            { name: 'Beat sibling', startBeat: 20, endBeat: 21 },
        ]);
        expect(clips).toMatchObject([
            { name: 'Seconds phrase', startBeat: 8, endBeat: 12 },
            { name: 'Beat sibling', startBeat: 20, endBeat: 21 },
        ]);
        const phrase = clips?.[0];
        expect(phrase && mapped.midi.notesByClipId[phrase.id]).toMatchObject([
            { pitch: 60, startBeat: 2, duration: 1 },
        ]);
        expect(parsed.warnings).toMatchObject([
            {
                kind: 'unsupported-automation',
                sourceType: 'RealPoint',
                sourceId: 'invalid-tempo',
                name: 'Tempo shape',
                context: 'Arrangement',
            },
        ]);
        expect(parsed.warnings).toHaveLength(1);
        const validChange = { id: 'valid-tempo', beat: 20, tempo: 150, curve: 'instant' };
        try {
            restoreTimelineMapSnapshot({
                tempoMap: {
                    changes: [
                        { id: 'invalid-tempo', beat: Number(time), tempo: Number(value), curve: 'instant' },
                        validChange,
                    ],
                },
            });
            expect(tempoMapStore.value?.changes).toEqual([validChange]);
        } finally {
            restoreTimelineMapSnapshot({});
        }
    });

    it.each([20, 999])('admits tempo-map boundary %i in both importer and owner store', (tempo) => {
        const parsed = parseProjectXml(
            project(
                '<Structure/><Arrangement><Lanes><Points target="tempo">' +
                    `<RealPoint time="0" value="${String(tempo)}"/>` +
                    '<RealPoint time="8" value="120"/></Points></Lanes></Arrangement>'
            )
        );
        const change = { id: `boundary-${String(tempo)}`, ...parsed.tempoChanges[0] };
        try {
            expect(parsed.tempoChanges).toEqual([
                { beat: 0, tempo, curve: 'instant' },
                { beat: 8, tempo: 120, curve: 'instant' },
            ]);
            restoreTimelineMapSnapshot({ tempoMap: { changes: [change] } });
            expect(tempoMapStore.value?.changes).toEqual([change]);
            expect(parsed.warnings).toEqual([]);
        } finally {
            restoreTimelineMapSnapshot({});
        }
    });

    it('names Video and its file after substituting an unsupported video track', () => {
        const parsed = parseProjectXml(
            project(
                '<Structure><Track id="video" name="Picture" contentType="video"/></Structure>' +
                    '<Arrangement><Lanes track="video"><Clips><Clip name="Picture clip" duration="2">' +
                    '<Video id="picture"><File path="picture.mov"/></Video></Clip></Clips></Lanes></Arrangement>'
            )
        );
        expect(parsed.tracks[0]?.clips).toEqual([]);
        expect(parsed.warnings).toMatchObject([
            { kind: 'unsupported-track-type', name: 'video: Picture', context: 'Picture', handling: 'substituted' },
            {
                kind: 'unsupported-clip',
                sourceType: 'Video',
                sourceId: 'picture',
                name: 'picture.mov',
                context: 'Picture',
            },
        ]);
        expect(parsed.warnings).toHaveLength(2);
        expect(parsed.warnings.map((warning) => warning.sourceOrder)).toEqual(
            [...parsed.warnings.map((warning) => warning.sourceOrder)].sort((a, b) => a - b)
        );
    });

    it('reports a warped Notes route without publishing an invented empty clip', () => {
        const parsed = parseProjectXml(
            project(
                '<Application name="Fixture DAW" version="1"/>' +
                    '<Structure><Track id="keys" name="Keys" contentType="notes"/><Track id="drums" name="Drums" contentType="notes"/></Structure>' +
                    '<Arrangement><Lanes><Clips track="keys">' +
                    '<Clip name="Warped notes" time="4" duration="4"><Warps track="drums" contentTimeUnit="beats"><Notes>' +
                    '<Note time="0" duration="1" channel="0" key="67"/></Notes>' +
                    '<Warp time="0" contentTime="0"/><Warp time="4" contentTime="4"/></Warps></Clip>' +
                    '<Clip name="Sibling" time="8" duration="1"><Notes><Note time="0" duration="1" channel="0" key="64"/></Notes></Clip>' +
                    '</Clips></Lanes></Arrangement>',
                ''
            )
        );

        expect(parsed.tracks.find((track) => track.name === 'Keys')?.clips.map((clip) => clip.name)).toEqual([
            'Sibling',
        ]);
        expect(parsed.tracks.find((track) => track.name === 'Drums')?.clips).toEqual([]);
        expect(parsed.warnings).toMatchObject([
            {
                kind: 'unsupported-clip',
                sourceType: 'Clip',
                name: 'Warped notes',
                context: 'Drums',
                handling: 'dropped',
            },
        ]);
        expect(parsed.warnings).toHaveLength(1);
    });

    it('reports a direct repeating Notes leaf while retaining its plain and nonrepeating siblings', () => {
        const parsed = parseProjectXml(
            project(
                '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                    '<Arrangement><Lanes><Clips track="keys">' +
                    '<Clip id="repeat" name="Repeating phrase" time="0" duration="8" loopStart="0" loopEnd="4">' +
                    '<Notes><Note time="0" duration="1" key="60"/></Notes></Clip>' +
                    '<Clip id="plain" name="Plain phrase" time="8" duration="2"><Notes>' +
                    '<Note time="0" duration="1" key="62"/></Notes></Clip>' +
                    '<Clip id="one-pass" name="One pass" time="10" duration="4" loopStart="0" loopEnd="4">' +
                    '<Notes><Note time="0" duration="1" key="64"/></Notes></Clip>' +
                    '</Clips></Lanes></Arrangement>'
            )
        );

        expect(parsed.tracks[0]?.clips.map((clip) => clip.name)).toEqual(['Plain phrase', 'One pass']);
        expect(parsed.warnings).toMatchObject([
            {
                kind: 'unsupported-clip',
                sourceType: 'Clip',
                sourceId: 'repeat',
                name: 'Repeating phrase',
                context: 'Keys',
                handling: 'dropped',
            },
        ]);
        expect(parsed.warnings).toHaveLength(1);
    });

    it.each([
        { unit: 'beats at zero offset', contentTimeUnit: '', playStart: '0', loopStart: '0', loopEnd: '4' },
        {
            unit: 'seconds at zero offset',
            contentTimeUnit: ' contentTimeUnit="seconds"',
            playStart: '0',
            loopStart: '0',
            loopEnd: '2',
        },
        { unit: 'beats at nonzero offset', contentTimeUnit: '', playStart: '1', loopStart: '1', loopEnd: '5' },
        {
            unit: 'seconds at nonzero offset',
            contentTimeUnit: ' contentTimeUnit="seconds"',
            playStart: '0.5',
            loopStart: '0.5',
            loopEnd: '2.5',
        },
    ])(
        'keeps a fractional-start one-pass Notes loop in $unit and still rejects a real repeat',
        ({ contentTimeUnit, playStart, loopStart, loopEnd }) => {
            const parsed = parseProjectXml(
                project(
                    '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                        '<Arrangement><Lanes timeUnit="beats"><Clips track="keys">' +
                        `<Clip id="one-pass" name="One pass" time="28.2" duration="4"${contentTimeUnit} playStart="${playStart}" loopStart="${loopStart}" loopEnd="${loopEnd}">` +
                        '<Notes><Note time="0" duration="0.5" key="60"/></Notes></Clip>' +
                        '<Clip id="plain" name="Plain" time="32.2" duration="1"><Notes>' +
                        '<Note time="0" duration="0.5" key="62"/></Notes></Clip>' +
                        `<Clip id="repeat" name="Real repeat" time="36.2" duration="4.125"${contentTimeUnit} playStart="${playStart}" loopStart="${loopStart}" loopEnd="${loopEnd}">` +
                        '<Notes><Note time="0" duration="0.5" key="64"/></Notes></Clip>' +
                        '</Clips></Lanes></Arrangement>'
                )
            );

            expect(parsed.tracks[0]?.clips.map((clip) => [clip.name, clip.notes?.[0]?.pitch])).toEqual([
                ['One pass', 60],
                ['Plain', 62],
            ]);
            expect(parsed.warnings).toMatchObject([
                {
                    kind: 'unsupported-clip',
                    sourceType: 'Clip',
                    sourceId: 'repeat',
                    name: 'Real repeat',
                    context: 'Keys',
                    handling: 'dropped',
                },
            ]);
            expect(parsed.warnings).toHaveLength(1);
        }
    );

    it.each([
        { unit: 'beats near the start', time: '1', contentTimeUnit: '', playStart: '1.1', loopEnd: '3.3' },
        { unit: 'beats later', time: '28.2', contentTimeUnit: '', playStart: '0.1', loopEnd: '2.3' },
        {
            unit: 'seconds content',
            time: '28.2',
            contentTimeUnit: ' contentTimeUnit="seconds"',
            playStart: '0.05',
            loopEnd: '1.15',
        },
    ])(
        'keeps a decimal one-pass Notes loop in $unit but omits a 0.0001-beat repeat',
        ({ time, contentTimeUnit, playStart, loopEnd }) => {
            const parsed = parseProjectXml(
                project(
                    '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                        '<Arrangement><Lanes timeUnit="beats"><Clips track="keys">' +
                        `<Clip id="one-pass" name="One pass" time="${time}" duration="2.2"${contentTimeUnit} playStart="${playStart}" loopStart="${playStart}" loopEnd="${loopEnd}">` +
                        '<Notes><Note time="0" duration="0.5" key="60"/></Notes></Clip>' +
                        `<Clip id="plain" name="Plain" time="${time}" duration="1"><Notes>` +
                        '<Note time="0" duration="0.5" key="62"/></Notes></Clip>' +
                        `<Clip id="repeat" name="Real repeat" time="${time}" duration="2.2001"${contentTimeUnit} playStart="${playStart}" loopStart="${playStart}" loopEnd="${loopEnd}">` +
                        '<Notes><Note time="0" duration="0.5" key="64"/></Notes></Clip>' +
                        '</Clips></Lanes></Arrangement>'
                )
            );

            expect(parsed.tracks[0]?.clips.map((clip) => [clip.name, clip.notes?.[0]?.pitch])).toEqual([
                ['One pass', 60],
                ['Plain', 62],
            ]);
            expect(parsed.warnings).toMatchObject([
                {
                    kind: 'unsupported-clip',
                    sourceId: 'repeat',
                    name: 'Real repeat',
                    context: 'Keys',
                    handling: 'dropped',
                },
            ]);
            expect(parsed.warnings).toHaveLength(1);
        }
    );

    it('keeps a decimal one-pass parent and nested Notes child while omitting a genuine repeating parent', () => {
        const parsed = parseProjectXml(
            project(
                '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                    '<Arrangement><Lanes timeUnit="beats"><Clips track="keys">' +
                    '<Clip id="parent" name="Parent" time="1" duration="2.2" playStart="1.1" loopStart="1.1" loopEnd="3.3">' +
                    '<Clips><Clip name="Child" time="1.1" duration="1"><Notes>' +
                    '<Note time="0" duration="0.5" key="67"/></Notes></Clip></Clips></Clip>' +
                    '<Clip id="repeat-parent" name="Repeat parent" time="5" duration="2.2001" playStart="1.1" loopStart="1.1" loopEnd="3.3">' +
                    '<Clips><Clip name="Lost child" time="1.1" duration="1"><Notes>' +
                    '<Note time="0" duration="0.5" key="69"/></Notes></Clip></Clips></Clip>' +
                    '</Clips></Lanes></Arrangement>'
            )
        );

        expect(parsed.tracks[0]?.clips.map((clip) => [clip.name, clip.notes?.[0]?.pitch])).toEqual([
            ['Parent', undefined],
            ['Child', 67],
        ]);
        expect(parsed.warnings).toMatchObject([
            {
                kind: 'unsupported-clip',
                sourceId: 'repeat-parent',
                name: 'Repeat parent',
                context: 'Keys',
                handling: 'dropped',
            },
        ]);
        expect(parsed.warnings).toHaveLength(1);
    });

    it('still refuses a direct Notes loop whose end does not follow its start', () => {
        const parsed = parseProjectXml(
            project(
                '<Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>' +
                    '<Arrangement><Lanes><Clips track="keys">' +
                    '<Clip id="invalid-loop" name="Invalid loop" time="1" duration="1" loopStart="2" loopEnd="2">' +
                    '<Notes><Note time="0" duration="0.5" key="60"/></Notes></Clip>' +
                    '<Clip name="Plain" time="2" duration="1"><Notes>' +
                    '<Note time="0" duration="0.5" key="62"/></Notes></Clip>' +
                    '</Clips></Lanes></Arrangement>'
            )
        );

        expect(parsed.tracks[0]?.clips.map((clip) => clip.name)).toEqual(['Plain']);
        expect(parsed.warnings).toMatchObject([
            { kind: 'unsupported-clip', sourceId: 'invalid-loop', name: 'Invalid loop', context: 'Keys' },
        ]);
        expect(parsed.warnings).toHaveLength(1);
    });

    it('reports a direct nonidentity warped Audio leaf while retaining identity and plain siblings', () => {
        const parsed = parseProjectXml(
            project(
                '<Structure><Track id="audio" name="Audio" contentType="audio"/></Structure>' +
                    '<Arrangement><Lanes><Clips track="audio">' +
                    '<Clip id="warped" name="Stretched take" time="0" duration="4"><Warps timeUnit="beats" contentTimeUnit="seconds">' +
                    '<Audio file="stretched.wav"/><Warp time="0" contentTime="0"/>' +
                    '<Warp time="4" contentTime="1"/></Warps></Clip>' +
                    '<Clip id="identity" name="Identity take" time="4" duration="4"><Warps timeUnit="beats" contentTimeUnit="seconds">' +
                    '<Audio file="identity.wav"/><Warp time="0" contentTime="0"/>' +
                    '<Warp time="4" contentTime="2"/></Warps></Clip>' +
                    '<Clip id="plain-audio" name="Plain take" time="8" duration="4"><Audio file="plain.wav"/></Clip>' +
                    '</Clips></Lanes></Arrangement>'
            )
        );

        expect(parsed.tracks[0]?.clips.map((clip) => [clip.name, clip.audioAssetPath])).toEqual([
            ['Identity take', 'identity.wav'],
            ['Plain take', 'plain.wav'],
        ]);
        expect(parsed.warnings).toMatchObject([
            {
                kind: 'unsupported-clip',
                sourceType: 'Clip',
                sourceId: 'warped',
                name: 'Stretched take',
                context: 'Audio',
                handling: 'dropped',
            },
        ]);
        expect(parsed.warnings).toHaveLength(1);
    });
});
