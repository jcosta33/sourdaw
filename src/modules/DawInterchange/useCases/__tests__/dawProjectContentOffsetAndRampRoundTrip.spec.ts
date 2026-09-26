import { describe, expect, it } from 'vitest';

import { type DawProjectParseResult } from '../dawProjectTypes';
import { mapToProjectData } from '../mapToProjectData';
import { parseProjectXml } from '../parseProjectXml';
import { type ProjectData } from '../projectDataContract';
import { serializeProjectXml } from '../serializeProjectXml';

const AUDIO_PATH = 'audio/take.wav';

// A foreign DAWproject: the audio clip plays its file from 2 beats in
// (`playStart`), and the tempo ramps linearly from 100 to 140 BPM over 16 beats.
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
    </Structure>
    <Arrangement timeUnit="beats">
        <Lanes timeUnit="beats">
            <Clips track="t-audio">
                <Clip time="4" duration="4" playStart="2" name="Trimmed take">
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
});
