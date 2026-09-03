import { type DawProjectParseResult } from './dawProjectTypes';
import { parseMetadataXml } from './parseMetadataXml';
import { parseProjectXml } from './parseProjectXml';
import { readDawProjectZip } from './readDawProjectZip';

export async function parseDawProject(input: ArrayBuffer): Promise<DawProjectParseResult> {
    const contents = await readDawProjectZip(input);
    const project = parseProjectXml(contents.projectXml);
    const meta = contents.metadataXml ? parseMetadataXml(contents.metadataXml) : { title: '', artist: '', comment: '' };
    const audioAssets = await contents.readAudioAssets();

    return {
        meta,
        tracks: project.tracks,
        initialTempo: project.initialTempo,
        initialTimeSignature: project.initialTimeSignature,
        tempoChanges: project.tempoChanges,
        timeSignatureChanges: project.timeSignatureChanges,
        markers: project.markers,
        audioAssets,
    };
}
