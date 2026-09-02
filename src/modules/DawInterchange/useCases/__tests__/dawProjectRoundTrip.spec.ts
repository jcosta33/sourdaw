import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

/**
 * No real Worker exists in the jsdom test environment, so this spec fakes
 * only the Worker transport and delegates to the real, synchronous
 * extraction core (`runDawProjectZipWorkerRequest`) — the same logic that
 * runs inside `dawProjectZip.worker.ts` in production. This keeps the round
 * trip through real ZIP bytes and real XML while avoiding the environment
 * gap; the Worker lifecycle itself is covered by
 * `extractDawProjectZipEntries.spec.ts`.
 */
vi.mock('../extractDawProjectZipEntries', async () => {
    const { runDawProjectZipWorkerRequest } = await import('../runDawProjectZipWorkerRequest');
    return {
        extractDawProjectZipEntries: (input: {
            bytes: Uint8Array<ArrayBuffer>;
            phase: 'header' | 'audio';
            restrictLimits?: unknown;
        }) =>
            Promise.resolve({
                entries: runDawProjectZipWorkerRequest({
                    bytes: input.bytes.buffer,
                    phase: input.phase,
                    restrictLimits: input.restrictLimits as never,
                }),
            }),
    };
});

import { buildDawProjectZip } from '../buildDawProjectZip';
import { parseDawProject } from '../parseDawProject';
import { serializeMetadataXml } from '../serializeMetadataXml';
import { serializeProjectXml } from '../serializeProjectXml';

function asRealmUint8(source: Uint8Array | ArrayLike<number>): Uint8Array<ArrayBuffer> {
    const view = source instanceof Uint8Array ? source : new Uint8Array(source);
    const out = new Uint8Array(view.length);
    out.set(view);
    return out;
}

const originalProjectXml = `<?xml version="1.0" encoding="UTF-8"?>
<Project version="1.0">
    <Transport>
        <Tempo value="140"/>
        <TimeSignature numerator="4" denominator="4"/>
    </Transport>
    <Structure>
        <Track id="t-audio" name="Drums" contentType="audio">
            <Channel id="c-audio">
                <Volume value="0.75"/>
                <Pan value="0.5"/>
            </Channel>
        </Track>
        <Track id="t-midi" name="Keys" contentType="notes">
            <Channel id="c-midi">
                <Volume value="0.8"/>
                <Pan value="0.5"/>
            </Channel>
        </Track>
    </Structure>
    <Arrangement timeUnit="beats">
        <Lanes timeUnit="beats">
            <Clips track="t-audio">
                <Clip time="0" duration="4" name="Loop">
                    <Audio>
                        <File path="audio/loop.wav"/>
                    </Audio>
                </Clip>
            </Clips>
            <Clips track="t-midi">
                <Clip time="4" duration="4" name="Chord">
                    <Notes>
                        <Note time="0" duration="1" key="60" vel="0.8"/>
                        <Note time="2" duration="2" key="64" vel="1"/>
                    </Notes>
                </Clip>
            </Clips>
        </Lanes>
        <Markers>
            <Marker time="8" name="Verse"/>
        </Markers>
    </Arrangement>
</Project>`;

const originalMetadataXml = `<?xml version="1.0" encoding="UTF-8"?>
<MetaData>
    <Title>Test Song</Title>
    <Artist>Sourdaw QA</Artist>
    <Comment>round-trip fixture</Comment>
</MetaData>`;

function buildFixtureZip(): ArrayBuffer {
    const wavBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]);
    const zipped = zipSync({
        'project.xml': asRealmUint8(strToU8(originalProjectXml)),
        'metadata.xml': asRealmUint8(strToU8(originalMetadataXml)),
        'audio/loop.wav': wavBytes,
    });
    const normalized = asRealmUint8(zipped);
    return normalized.buffer;
}

describe('DAWproject import → export → import round-trip', () => {
    it('preserves tracks, clips, notes, tempo, time-sig and markers across a round-trip', async () => {
        const firstImport = await parseDawProject(buildFixtureZip());

        expect(firstImport.tracks).toHaveLength(2);
        expect(firstImport.meta.title).toBe('Test Song');

        const drumTrackImport = firstImport.tracks.find((t) => t.name === 'Drums')!;
        const keysTrackImport = firstImport.tracks.find((t) => t.name === 'Keys')!;

        const audioPathByBufferId = new Map<string, string>([['buf-loop', 'audio/loop.wav']]);
        const now = Date.now();
        const projectData = {
            version: 1,
            meta: {
                name: firstImport.meta.title,
                createdAt: now,
                updatedAt: now,
                keyRoot: 0,
                scaleName: 'chromatic',
                tuning: { name: 'Equal Temperament', frequencies: [] },
            },
            transport: {
                tempo: firstImport.initialTempo,
                timeSignatureNumerator: firstImport.initialTimeSignature.numerator,
                timeSignatureDenominator: firstImport.initialTimeSignature.denominator,
                loopStart: 0,
                loopEnd: 16,
                isLooping: false,
                metronomeEnabled: false,
                metronomeVolume: 0.5,
                punchInEnabled: false,
                punchInBeat: 0,
                punchOutBeat: 0,
                countInEnabled: false,
                countInBars: 1,
                preRollEnabled: false,
                preRollBars: 1,
                masterGain: 0.8,
            },
            arrangement: {
                tracks: [
                    {
                        id: 'track-audio-1',
                        name: drumTrackImport.name,
                        kind: 'audio' as const,
                        muted: false,
                        soloed: false,
                        armed: false,
                        gain: 0.75,
                        pan: 0,
                        color: '#ef4444',
                        clips: [
                            {
                                id: 'clip-audio',
                                trackId: 'track-audio-1',
                                name: 'Loop',
                                startBeat: 0,
                                endBeat: 4,
                                type: 'audio' as const,
                                fadeInBeats: 0,
                                fadeOutBeats: 0,
                                gain: 1,
                                color: '',
                                locked: false,
                                muted: false,
                                bufferId: 'buf-loop',
                            },
                        ],
                        devices: [],
                        sends: [],
                        midiFx: [],
                        frozen: false,
                        freezeState: { status: 'unfrozen' as const },
                        parentId: null,
                        collapsed: false,
                        inputMonitoring: 'auto' as const,
                        hidden: false,
                        disabled: false,
                        height: 80,
                        outputId: 'master',
                        automationMode: 'read' as const,
                        groupId: null,
                        soloSafe: false,
                        notes: '',
                        inputId: null,
                        activeAlternativeId: 'alt-1',
                        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
                        vcaGroupId: null,
                        midiOutputTrackId: null,
                        followChordTrack: false,
                    },
                    {
                        id: 'track-midi-1',
                        name: keysTrackImport.name,
                        kind: 'midi' as const,
                        muted: false,
                        soloed: false,
                        armed: false,
                        gain: 0.8,
                        pan: 0,
                        color: '#3b82f6',
                        clips: [
                            {
                                id: 'clip-midi',
                                trackId: 'track-midi-1',
                                name: 'Chord',
                                startBeat: 4,
                                endBeat: 8,
                                type: 'midi' as const,
                                fadeInBeats: 0,
                                fadeOutBeats: 0,
                                gain: 1,
                                color: '',
                                locked: false,
                                muted: false,
                            },
                        ],
                        devices: [],
                        sends: [],
                        midiFx: [],
                        frozen: false,
                        freezeState: { status: 'unfrozen' as const },
                        parentId: null,
                        collapsed: false,
                        inputMonitoring: 'auto' as const,
                        hidden: false,
                        disabled: false,
                        height: 80,
                        outputId: 'master',
                        automationMode: 'read' as const,
                        groupId: null,
                        soloSafe: false,
                        notes: '',
                        inputId: null,
                        activeAlternativeId: 'alt-2',
                        alternatives: [{ id: 'alt-2', name: 'Alternative 1', clips: [] }],
                        vcaGroupId: null,
                        midiOutputTrackId: null,
                        followChordTrack: false,
                    },
                ],
            },
            automation: { lanes: [] },
            midi: {
                notesByClipId: {
                    'clip-midi': [
                        {
                            id: 'n1',
                            pitch: 60,
                            startBeat: 0,
                            duration: 1,
                            velocity: Math.round(0.8 * 127),
                            probability: 100,
                            pressure: 0,
                            slide: 0,
                            pitchBend: 0,
                        },
                        {
                            id: 'n2',
                            pitch: 64,
                            startBeat: 2,
                            duration: 2,
                            velocity: 127,
                            probability: 100,
                            pressure: 0,
                            slide: 0,
                            pitchBend: 0,
                        },
                    ],
                },
                ccByClipId: {},
                pitchBendByClipId: {},
            },
            mixer: { master: { gain: 0.8, pan: 0 }, buses: [] },
            markers: [{ id: 'm-1', beat: 8, name: 'Verse', color: '#f59e0b' }],
            history: { checkpoints: [] },
        };

        const projectXml = serializeProjectXml({ project: projectData, audioPathByBufferId });
        const metadataXml = serializeMetadataXml({ title: projectData.meta.name, artist: '', comment: '' });
        const zipped = buildDawProjectZip({
            projectXml,
            metadataXml,
            audioFiles: new Map([['audio/loop.wav', asRealmUint8(new Uint8Array([0x52, 0x49, 0x46, 0x46]))]]),
        });

        const buffer = asRealmUint8(zipped).buffer;
        const reimport = await parseDawProject(buffer);

        expect(reimport.initialTempo).toBe(140);
        expect(reimport.initialTimeSignature).toEqual({ numerator: 4, denominator: 4 });
        expect(reimport.tracks).toHaveLength(2);
        expect(reimport.meta.title).toBe('Test Song');

        const drums = reimport.tracks.find((t) => t.name === 'Drums');
        expect(drums?.kind).toBe('audio');
        expect(drums?.clips).toHaveLength(1);
        expect(drums?.clips[0]?.startBeat).toBe(0);
        expect(drums?.clips[0]?.endBeat).toBe(4);
        expect(drums?.clips[0]?.audioAssetPath).toBe('audio/loop.wav');

        const keys = reimport.tracks.find((t) => t.name === 'Keys');
        expect(keys?.kind).toBe('midi');
        expect(keys?.clips).toHaveLength(1);
        const midiClip = keys?.clips[0];
        expect(midiClip?.startBeat).toBe(4);
        expect(midiClip?.endBeat).toBe(8);
        expect(midiClip?.notes).toHaveLength(2);
        expect(midiClip?.notes?.[0]).toMatchObject({ pitch: 60, startBeat: 0, duration: 1 });
        expect(midiClip?.notes?.[1]).toMatchObject({ pitch: 64, startBeat: 2, duration: 2 });

        expect(reimport.markers).toEqual([{ beat: 8, name: 'Verse' }]);
    });
});
