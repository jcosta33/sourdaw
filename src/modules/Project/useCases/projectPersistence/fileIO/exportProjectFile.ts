import { automationStore } from '#/modules/Automation';
import { markerStore, takeLaneStore, trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { getAllSidechainRoutes } from '#/modules/Routing/useCases';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { arrangementStore } from '../../../stores/arrangementStore';
import { type ProjectData } from '../../../models/ProjectData';
import { projectStore } from '../../../stores/projectStore';
import { downloadProjectFile } from '../../../repositories/project/downloadProjectFile';
import { syncCurrentArrangementToStore } from '../../arrangement/helpers';

/** Collect every audioBufferId (clips + frozen buffers + track alternatives)
 * referenced by a TrackStoreState so the export can embed the raw PCM. */
function collectBufferIds(trackState: TrackStoreState | null | undefined): Set<string> {
    const ids = new Set<string>();
    for (const track of trackState?.tracks ?? []) {
        if (track.frozenBufferId) ids.add(track.frozenBufferId);
        for (const clip of track.clips) {
            if (clip.audioBufferId) ids.add(clip.audioBufferId);
        }
        for (const alt of track.alternatives) {
            for (const clip of alt.clips) {
                if (clip.audioBufferId) ids.add(clip.audioBufferId);
            }
        }
    }
    return ids;
}

export async function exportProjectFile(): Promise<void> {
    syncCurrentArrangementToStore();

    const tracks = trackStore.value;
    const transport = transportStore.value;
    const automation = automationStore.value;
    const midi = midiStore.value;
    const project = projectStore.value;
    const arrState = arrangementStore.value;

    if (!tracks || !transport || !automation || !midi || !project || !arrState) {
        return;
    }

    // Collect all audioBufferIds referenced by the project (current track state
    // and every arrangement, including non-active ones).
    const allBufferIds = new Set<string>();
    for (const id of collectBufferIds(tracks)) allBufferIds.add(id);
    for (const arr of arrState.arrangements) {
        for (const id of collectBufferIds(arr.tracks)) allBufferIds.add(id);
    }
    const audioBuffers = await audioBufferCache.exportBuffers([...allBufferIds]);

    const resolvedIds = new Set(Object.keys(audioBuffers));
    const missingCount = [...allBufferIds].filter((id) => !resolvedIds.has(id)).length;
    if (missingCount > 0) {
        notifyUser(
            `${missingCount} audio file${missingCount > 1 ? 's' : ''} could not be bundled with the export — the project may not play back correctly on another machine.`,
            'warning'
        );
    }

    const data: ProjectData = {
        version: 1,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: Date.now(),
        tracks,
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
        automation,
        midi,
        tempoMap: tempoMapStore.value ?? undefined,
        timeSignatureMap: timeSignatureMapStore.value ?? undefined,
        markers: markerStore.value ?? undefined,
        takeLanes: takeLaneStore.value ?? undefined,
        sidechainRoutes: getAllSidechainRoutes(),
        arrangements: arrState.arrangements,
        activeArrangementId: arrState.activeArrangementId,
        audioBuffers: Object.keys(audioBuffers).length > 0 ? audioBuffers : undefined,
    };

    await downloadProjectFile(data);
    notifyUser('Project exported successfully', 'info');
}