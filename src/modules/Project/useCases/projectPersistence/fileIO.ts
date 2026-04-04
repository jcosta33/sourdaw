import { trackStore, type TrackStoreState } from '#/modules/Arrangement/stores/trackStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { tempoMapStore } from '#/modules/Transport/stores/tempoMapStore';
import { timeSignatureMapStore } from '#/modules/Transport/stores/timeSignatureMapStore';
import { markerStore } from '#/modules/Arrangement/stores/markerStore';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';
import { arrangementStore, defaultArrangementId } from '../../stores/arrangementStore';
import { syncCurrentArrangementToStore } from '../arrangement';
import { type ProjectData } from '../../models/ProjectData';
import { projectStore } from '../../stores/projectStore';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { getAudioContext } from '#/modules/AudioEngine/useCases/engineAccess';
import { getAllSidechainRoutes } from '#/modules/Routing/useCases/sidechain';
import { downloadProjectFile } from '../../repositories/project';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { clearUndoHistory, hydrateModuleStoresFromProjectData, verifyAudioBufferReferences } from './helpers';

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

export async function importProjectFile(file: File): Promise<boolean> {
    try {
        const text = await file.text();
        const data = JSON.parse(text) as ProjectData;

        if (data.version !== 1 || !data.tracks || !data.transport) {
            return false;
        }

        hydrateModuleStoresFromProjectData(data);
        projectStore.set({
            name: data.name,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            dirty: false,
            loading: false,
            initialized: true,
        });

        if (data.arrangements && data.arrangements.length > 0 && data.activeArrangementId) {
            arrangementStore.set({
                arrangements: data.arrangements,
                activeArrangementId: data.activeArrangementId,
            });
        } else {
            arrangementStore.set({
                arrangements: [
                    {
                        id: defaultArrangementId,
                        name: 'Arrangement 1',
                        tracks: data.tracks,
                        automation: data.automation,
                        midi: data.midi,
                        tempoMap: data.tempoMap,
                        timeSignatureMap: data.timeSignatureMap,
                        markers: data.markers,
                        takeLanes: data.takeLanes,
                    },
                ],
                activeArrangementId: defaultArrangementId,
            });
        }

        const ctx = getAudioContext();
        if (data.audioBuffers && Object.keys(data.audioBuffers).length > 0) {
            // Self-contained file: reconstruct buffers from embedded PCM data.
            // This also writes them to IDB so they persist for future sessions.
            await audioBufferCache.importBuffers(data.audioBuffers, ctx);
        } else {
            // Legacy file (no embedded audio): fall back to the local IDB cache,
            // but load only the buffer IDs referenced by clips in this project so
            // we don't mass-load unrelated takes from previous sessions.
            const referencedIds = (data.tracks?.tracks ?? [])
                .flatMap((t) => t.clips.map((c) => c.audioBufferId))
                .filter((id): id is string => Boolean(id));
            await audioBufferCache.restoreFromIdb(ctx, referencedIds.length > 0 ? referencedIds : undefined);
        }
        if (trackStore.value) {
            trackStore.set({ ...trackStore.value });
        }
        verifyAudioBufferReferences();
        clearUndoHistory();
        return true;
    } catch {
        return false;
    }
}
