import { markerStore, takeLaneStore, trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';
import { audioBufferToWav, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';

import { type ProjectData } from '../../models/ProjectData';
import { arrangementStore } from '../../stores/arrangementStore';
import { projectStore } from '../../stores/projectStore';
import { syncCurrentArrangementToStore } from '../arrangement/syncCurrentArrangementToStore';

import { buildDawProjectZip } from './buildDawProjectZip';
import { serializeMetadataXml } from './serializeMetadataXml';
import { serializeProjectXml } from './serializeProjectXml';

export type ExportDawProjectOutput = Promise<{
    bytes: Uint8Array;
    fileName: string;
}>;

function collectAudioBufferIds(trackState: TrackStoreState | null | undefined): string[] {
    const ids = new Set<string>();
    for (const track of trackState?.tracks ?? []) {
        for (const clip of track.clips) {
            if (clip.audioBufferId) {
                ids.add(clip.audioBufferId);
            }
        }
    }
    return [...ids];
}

function sanitizeForPath(value: string): string {
    return value.replaceAll(/[^a-zA-Z0-9_-]/g, '_');
}

export async function exportDawProject(): ExportDawProjectOutput {
    syncCurrentArrangementToStore();

    const tracksState = trackStore.value;
    const transport = transportStore.value;
    const midi = midiStore.value;
    const project = projectStore.value;
    const arrState = arrangementStore.value;

    if (!tracksState || !transport || !midi || !project || !arrState) {
        throw new Error('Cannot export DAWproject: project state is not fully loaded.');
    }

    const bufferIds = collectAudioBufferIds(tracksState);
    const audioPathByBufferId = new Map<string, string>();
    const audioFiles = new Map<string, Uint8Array>();

    for (const id of bufferIds) {
        const buffer = getCachedAudioBuffer({ bufferId: id });
        if (!buffer) {
            continue;
        }
        const fileName = `${sanitizeForPath(id)}.wav`;
        const relativePath = `audio/${fileName}`;
        const wav = await audioBufferToWav(buffer, 24);
        audioFiles.set(relativePath, new Uint8Array(wav));
        audioPathByBufferId.set(id, relativePath);
    }

    const projectData: ProjectData = {
        version: 1,
        meta: {
            name: project.name,
            createdAt: project.createdAt,
            updatedAt: Date.now(),
            keyRoot: project.keyRoot,
            scaleName: project.scaleName,
            tuning: project.tuning,
        },
        transport: {
            tempo: transport.tempo,
            timeSignatureNumerator: transport.timeSignatureNumerator,
            timeSignatureDenominator: transport.timeSignatureDenominator,
            loopStart: transport.loopStart,
            loopEnd: transport.loopEnd,
            isLooping: transport.isLooping,
            metronomeEnabled: transport.metronomeEnabled,
            metronomeVolume: transport.metronomeVolume,
            punchInEnabled: transport.punchInEnabled,
            punchInBeat: transport.punchInBeat,
            punchOutBeat: transport.punchOutBeat,
            countInEnabled: transport.countInEnabled,
            countInBars: transport.countInBars,
            preRollEnabled: transport.preRollEnabled,
            preRollBars: transport.preRollBars,
            masterGain: transport.masterGain,
        },
        arrangement: { tracks: tracksState.tracks },
        automation: automationStore.value ?? { lanes: [] },
        mixer: { master: { gain: 0.8, pan: 0 }, buses: [] },
        midi: {
            notesByClipId: Object.fromEntries(
                Object.entries(midi.notesByClipId).map(([clipId, notes]) => [
                    clipId,
                    notes.map((n) => ({
                        id: n.id,
                        pitch: n.pitch,
                        startBeat: n.startBeat,
                        duration: n.duration,
                        velocity: n.velocity,
                        probability: n.probability ?? 100,
                        pressure: n.pressure ?? 0,
                        slide: n.slide ?? 0,
                        pitchBend: n.pitchBend ?? 0,
                    })),
                ])
            ),
            ccByClipId: midi.ccByClipId,
            pitchBendByClipId: midi.pitchBendByClipId,
        },
        tempoMap: tempoMapStore.value ?? undefined,
        timeSignatureMap: timeSignatureMapStore.value ?? undefined,
        markers: (markerStore.value?.markers ?? []).map((m) => ({
            id: m.id,
            beat: m.beat,
            name: m.name ?? 'Untitled',
            color: m.color,
        })),
        takeLanes: takeLaneStore.value ?? undefined,
        sidechainRoutes: undefined,
        arrangements: arrState.arrangements,
        activeArrangementId: arrState.activeArrangementId,
        history: { checkpoints: [] },
    };

    const projectXml = serializeProjectXml({
        project: projectData,
        audioPathByBufferId,
    });

    const metadataXml = serializeMetadataXml({
        title: project.name,
        artist: '',
        comment: '',
    });

    const bytes = buildDawProjectZip({
        projectXml,
        metadataXml,
        audioFiles,
    });

    const fileName = `${sanitizeForPath(project.name || 'Sourdaw_Export')}.dawproject`;
    return { bytes, fileName };
}
