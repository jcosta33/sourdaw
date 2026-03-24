import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { tempoMapStore } from '#/modules/Transport/stores/tempoMapStore';
import { timeSignatureMapStore } from '#/modules/Transport/stores/timeSignatureMapStore';
import { markerStore } from '#/modules/Arrangement/stores/markerStore';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';
import { arrangementStore, defaultArrangementId } from '../../stores/arrangementStore';
import { syncCurrentArrangementToStore } from '../arrangementUseCases';
import { defaultTransportState } from '#/modules/Transport/useCases/transportQueries';
import { type ProjectData } from '../../models/ProjectData';
import { projectStore } from '../../stores/projectStore';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { getAudioContext } from '#/modules/AudioEngine/useCases/engineAccess';
import { getAllSidechainRoutes, setSidechainRoutes } from '#/modules/Routing/useCases/sidechainUseCases';
import { downloadProjectFile } from '../../repositories/projectRepository';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { clearUndoHistory, verifyAudioBufferReferences } from './helpers';

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

        trackStore.set(data.tracks);
        transportStore.set({
            ...defaultTransportState,
            ...data.transport,
        });
        if (data.automation) {
            automationStore.set(data.automation);
        }
        if (data.midi) {
            midiStore.set(data.midi);
        }
        if (data.tempoMap) {
            tempoMapStore.set(data.tempoMap);
        }
        if (data.timeSignatureMap) {
            timeSignatureMapStore.set(data.timeSignatureMap);
        }
        if (data.markers) {
            markerStore.set(data.markers);
        }
        if (data.takeLanes) {
            takeLaneStore.set(data.takeLanes);
        }
        if (data.sidechainRoutes && data.sidechainRoutes.length > 0) {
            setSidechainRoutes(data.sidechainRoutes);
        }
        projectStore.set({
            name: data.name,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            dirty: false,
            loading: false,
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

        await audioBufferCache.restoreFromIdb(getAudioContext());
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
