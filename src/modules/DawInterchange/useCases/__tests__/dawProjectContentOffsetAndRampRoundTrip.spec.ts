import { describe, expect, it } from 'vitest';

import { type DawProjectParseResult } from '../dawProjectTypes';
import { mapToProjectData } from '../mapToProjectData';
import { parseProjectXml } from '../parseProjectXml';
import { type ProjectData } from '../projectDataContract';
import { serializeProjectXml } from '../serializeProjectXml';

const AUDIO_PATH = 'audio/take.wav';

// A foreign DAWproject: the audio clip plays its file from 2 beats in
// (`playStart`), the MIDI clip carries the same content offset, one clip is
// slipped left of its media start (`playStart` -1), one clip declares seconds
// content (`contentTimeUnit`), one clip carries no `duration` and one tempo
// ramps linearly from 100 to 140 BPM over 16 beats.
const foreignProjectXml = `<?xml version="1.0" encoding="UTF-8"?>
<Project version="1.0">
    <Transport>
        <Tempo value="100"/>
        <TimeSignature numerator="4" denominator="4"/>
    </Transport>
    <Structure>
        <Track id="t-audio" name="Vox" contentType="audio">
            <Channel id="c-audio"><Volume value="0.8"/><Pan value="0.5"/></Channel>
        </Track>
        <Track id="t-midi" name="Keys" contentType="notes">
            <Channel id="c-midi"><Volume value="0.8"/><Pan value="0.5"/></Channel>
        </Track>
        <Track id="t-slip" name="Slipped" contentType="audio">
            <Channel id="c-slip"><Volume value="0.8"/><Pan value="0.5"/></Channel>
        </Track>
        <Track id="t-units" name="Windows" contentType="audio">
            <Channel id="c-units"><Volume value="0.8"/><Pan value="0.5"/></Channel>
        </Track>
    </Structure>
    <Arrangement timeUnit="beats">
        <Lanes timeUnit="beats">
            <Clips track="t-audio">
                <Clip time="4" duration="4" playStart="2" name="Trimmed take">
                    <Audio><File path="${AUDIO_PATH}"/></Audio>
                </Clip>
            </Clips>
            <Clips track="t-midi">
                <Clip time="0" duration="4" playStart="2" name="Offset keys">
                    <Notes>
                        <Note time="0" duration="1" key="60" vel="0.8"/>
                    </Notes>
                </Clip>
            </Clips>
            <Clips track="t-slip">
                <Clip time="2" duration="4" playStart="-1" name="Slipped left">
                    <Audio><File path="${AUDIO_PATH}"/></Audio>
                </Clip>
            </Clips>
            <Clips track="t-units">
                <Clip time="4" duration="4" contentTimeUnit="seconds" playStart="1.2" name="Seconds window">
                    <Audio><File path="${AUDIO_PATH}"/></Audio>
                </Clip>
                <Clip time="4" playStart="2" playStop="6" name="Inferred window">
                    <Audio><File path="${AUDIO_PATH}"/></Audio>
                </Clip>
            </Clips>
            <Points target="tempo" timeUnit="beats">
                <RealPoint time="0" value="100" interpolation="linear"/>
                <RealPoint time="16" value="140" interpolation="hold"/>
            </Points>
        </Lanes>
    </Arrangement>
</Project>`;

function toParseResult(xml: string): DawProjectParseResult {
    return {
        ...parseProjectXml(xml),
        meta: { title: 'Round trip', artist: '', comment: '' },
        audioAssets: new Map(),
    };
}

function importXml(xml: string): ProjectData {
    return mapToProjectData({
        parsed: toParseResult(xml),
        bufferIdsByPath: new Map([[AUDIO_PATH, 'buffer-take']]),
        fileName: 'round-trip.dawproject',
    });
}

function audioClipOf(project: ProjectData) {
    const clip = project.arrangement.tracks.flatMap((track) => track.clips).find((c) => c.type === 'audio');
    if (!clip) {
        throw new Error('expected the imported audio clip');
    }
    return clip;
}

function midiClipOf(project: ProjectData) {
    const clip = project.arrangement.tracks.flatMap((track) => track.clips).find((c) => c.type === 'midi');
    if (!clip) {
        throw new Error('expected the imported midi clip');
    }
    return clip;
}

function audioClipNamed(project: ProjectData, name: string) {
    const clip = project.arrangement.tracks
        .flatMap((track) => track.clips)
        .find((c) => c.type === 'audio' && c.name === name);
    if (!clip) {
        throw new Error(`expected the imported audio clip "${name}"`);
    }
    return clip;
}

function exportAndReimport(project: ProjectData): ProjectData {
    const exported = serializeProjectXml({
        project,
        audioPathByBufferId: new Map([['buffer-take', AUDIO_PATH]]),
    });
    return importXml(exported);
}

describe('DAWproject clip content offset and tempo ramp', () => {
    it('imports a clip that starts playing its file part-way in at that offset', () => {
        const project = importXml(foreignProjectXml);

        expect(audioClipOf(project).sampleStartBeat).toBe(2);
    });

    it('imports a linear tempo ramp as a ramp, not a step', () => {
        const project = importXml(foreignProjectXml);

        expect(project.tempoMap?.changes[0]).toMatchObject({ beat: 0, tempo: 100, curve: 'linear' });
    });

    it('keeps a split right half and a tempo ramp through Sourdaw export and re-import', () => {
        const project = importXml(foreignProjectXml);
        const clip = audioClipOf(project);
        clip.sampleStartBeat = 2;
        project.tempoMap = {
            changes: [
                { beat: 0, tempo: 100, curve: 'linear' },
                { beat: 16, tempo: 140, curve: 'instant' },
            ],
        };

        const exported = serializeProjectXml({
            project,
            audioPathByBufferId: new Map([['buffer-take', AUDIO_PATH]]),
        });
        const reimported = importXml(exported);

        expect(audioClipOf(reimported).sampleStartBeat).toBe(2);
        expect(reimported.tempoMap?.changes[0]).toMatchObject({ beat: 0, tempo: 100, curve: 'linear' });
    });

    it('imports a midi clip at its content offset and keeps it through export and re-import', () => {
        const project = importXml(foreignProjectXml);

        expect(midiClipOf(project).notes).toHaveLength(1);
        expect(midiClipOf(project).midiOffsetBeats).toBe(2);

        const reimported = exportAndReimport(project);

        expect(midiClipOf(reimported).midiOffsetBeats).toBe(2);
    });

    it('imports a negative content offset and keeps it through export and re-import', () => {
        const project = importXml(foreignProjectXml);

        expect(audioClipNamed(project, 'Slipped left').sampleStartBeat).toBe(-1);

        const reimported = exportAndReimport(project);

        expect(audioClipNamed(reimported, 'Slipped left').sampleStartBeat).toBe(-1);
    });

    it('reads time and duration in the timeline unit while contentTimeUnit scopes only the offset', () => {
        const project = importXml(foreignProjectXml);
        const clip = audioClipNamed(project, 'Seconds window');

        // time="4" duration="4" stay beats despite contentTimeUnit="seconds";
        // playStart="1.2" seconds at the transport tempo of 100 BPM is 2 beats.
        expect(clip.startBeat).toBe(4);
        expect(clip.endBeat).toBe(8);
        expect(clip.sampleStartBeat).toBe(2);
    });

    it('infers an omitted duration as the playStop - playStart window', () => {
        const project = importXml(foreignProjectXml);
        const clip = audioClipNamed(project, 'Inferred window');

        // No duration attribute: playStop="6" - playStart="2" is a 4-beat
        // window starting at time="4".
        expect(clip.startBeat).toBe(4);
        expect(clip.endBeat).toBe(8);
    });
});
