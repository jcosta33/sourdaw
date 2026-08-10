import { type DawProjectParseResult } from './dawProjectTypes';
import { parseMetadataXml } from './parseMetadataXml';
import { parseProjectXml } from './parseProjectXml';
import { readDawProjectZip } from './readDawProjectZip';

export function parseDawProject(input: ArrayBuffer): DawProjectParseResult {
    const contents = readDawProjectZip(input);
    const project = parseProjectXml(contents.projectXml);
    const meta = contents.metadataXml ? parseMetadataXml(contents.metadataXml) : { title: '', artist: '', comment: '' };
    const audioAssets = contents.readAudioAssets();

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
