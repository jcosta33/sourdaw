import { zipSync, strToU8 } from 'fflate';
import { describe, it, expect } from 'vitest';

import { parseDawProject } from '../parseDawProject';

const metadataXml = `<?xml version="1.0" encoding="UTF-8"?>
<MetaData>
    <Title>Test Song</Title>
    <Artist>Sourdaw QA</Artist>
    <Comment>imported fixture</Comment>
</MetaData>`;

const projectXml = `<?xml version="1.0" encoding="UTF-8"?>
<Project version="1.0">
    <Application name="FakeDAW" version="1.0"/>
    <Transport>
        <Tempo value="128"/>
        <TimeSignature numerator="3" denominator="4"/>
    </Transport>
    <Structure>
        <Track id="t1" name="Drums" contentType="audio">
            <Channel id="c1">
                <Volume value="0.7"/>
                <Pan value="0.5"/>
                <Devices>
                    <Device deviceRole="builtin-gain"/>
                </Devices>
            </Channel>
        </Track>
        <Track id="t2" name="Keys" contentType="notes">
            <Channel id="c2">
                <Volume value="0.8"/>
                <Pan value="0.25"/>
            </Channel>
        </Track>
    </Structure>
    <Arrangement timeUnit="beats">
        <Lanes timeUnit="beats">
            <Clips track="t1">
                <Clip time="0" duration="4" name="Drum Loop">
                    <Audio>
                        <File path="audio/drum-loop.wav"/>
                    </Audio>
                </Clip>
            </Clips>
            <Clips track="t2">
                <Clip time="4" duration="4" name="Chord Stab">
                    <Notes>
                        <Note time="0" duration="1" key="60" vel="0.8"/>
                        <Note time="1" duration="1" key="64" vel="0.9"/>
                        <Note time="2" duration="2" key="67" vel="1"/>
                    </Notes>
                </Clip>
            </Clips>
            <Points target="tempo" timeUnit="beats">
                <RealPoint time="0" value="128"/>
                <RealPoint time="16" value="140"/>
            </Points>
        </Lanes>
        <Markers>
            <Marker time="8" name="Verse"/>
        </Markers>
    </Arrangement>
</Project>`;

/**
 * Wraps bytes in a fresh Uint8Array constructed in this module's realm.
 * fflate's internal `instanceof Uint8Array` check fails against jsdom-realm
 * Uint8Array instances (e.g. the one returned by its own `strToU8`, which
 * uses TextEncoder). Copying into a node-realm buffer fixes the mismatch.
 */
function asRealmUint8(source: Uint8Array | ArrayLike<number>): Uint8Array<ArrayBuffer> {
    const view = source instanceof Uint8Array ? source : new Uint8Array(source);
    const out = new Uint8Array(view.length);
    out.set(view);
    return out;
}

function buildDawProjectZip(): ArrayBuffer {
    const audioBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]);
    const zipped = zipSync({
        'project.xml': asRealmUint8(strToU8(projectXml)),
        'metadata.xml': asRealmUint8(strToU8(metadataXml)),
        'audio/drum-loop.wav': audioBytes,
    });
    const normalized = asRealmUint8(zipped);
    return normalized.buffer;
}

function buildMalformedProjectWithCorruptAudio(): ArrayBuffer {
    const zipped = zipSync(
        {
            'audio/broken.wav': asRealmUint8([0x52, 0x49, 0x46, 0x46]),
            'project.xml': asRealmUint8(strToU8('<Project>')),
        },
        { level: 0 }
    );
    const view = new DataView(zipped.buffer, zipped.byteOffset, zipped.byteLength);
    const dataOffset = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    zipped[dataOffset] = (zipped[dataOffset] ?? 0) ^ 0xff;
    return asRealmUint8(zipped).buffer;
}

describe('parseDawProject', () => {
    it('reads metadata, transport, tracks and clips from a synthetic fixture', () => {
        const result = parseDawProject(buildDawProjectZip());

        expect(result.meta.title).toBe('Test Song');
        expect(result.meta.artist).toBe('Sourdaw QA');
        expect(result.initialTempo).toBe(128);
        expect(result.initialTimeSignature).toEqual({ numerator: 3, denominator: 4 });
        expect(result.tracks).toHaveLength(2);

        const drumTrack = result.tracks.find((t) => t.name === 'Drums');
        expect(drumTrack).toBeDefined();
        expect(drumTrack?.kind).toBe('audio');
        expect(drumTrack?.clips).toHaveLength(1);
        const drumClip = drumTrack?.clips[0];
        expect(drumClip?.type).toBe('audio');
        expect(drumClip?.startBeat).toBe(0);
        expect(drumClip?.endBeat).toBe(4);
        expect(drumClip?.audioAssetPath).toBe('audio/drum-loop.wav');
        expect(drumTrack?.deviceTypes).toContain('builtin-gain');

        const keysTrack = result.tracks.find((t) => t.name === 'Keys');
        expect(keysTrack).toBeDefined();
        expect(keysTrack?.kind).toBe('midi');
        expect(keysTrack?.clips).toHaveLength(1);
        const midiClip = keysTrack?.clips[0];
        expect(midiClip?.type).toBe('midi');
        expect(midiClip?.startBeat).toBe(4);
        expect(midiClip?.notes).toHaveLength(3);
        const firstNote = midiClip?.notes?.[0];
        expect(firstNote?.pitch).toBe(60);
        expect(firstNote?.startBeat).toBe(0);
        expect(firstNote?.duration).toBe(1);
        expect(firstNote?.velocity).toBe(Math.round(0.8 * 127));

        expect(result.tempoChanges).toHaveLength(2);
        expect(result.tempoChanges[0]).toEqual({ beat: 0, tempo: 128 });
        expect(result.tempoChanges[1]).toEqual({ beat: 16, tempo: 140 });

        expect(result.markers).toEqual([{ beat: 8, name: 'Verse' }]);

        expect(result.audioAssets.has('audio/drum-loop.wav')).toBe(true);
    });

    it('throws a clear error when project.xml is missing', () => {
        const zipped = zipSync({ 'metadata.xml': asRealmUint8(strToU8(metadataXml)) });
        const copy = new Uint8Array(zipped.byteLength);
        copy.set(zipped);
        expect(() => parseDawProject(copy.buffer)).toThrow(/missing project\.xml/);
    });

    it('rejects malformed project XML before inflating audio assets', () => {
        expect(() => parseDawProject(buildMalformedProjectWithCorruptAudio())).toThrow(/invalid XML/i);
    });
});
