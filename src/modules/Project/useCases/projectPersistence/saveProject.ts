import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { tempoMapStore } from '#/modules/Transport/stores/tempoMapStore';
import { timeSignatureMapStore } from '#/modules/Transport/stores/timeSignatureMapStore';
import { markerStore } from '#/modules/Arrangement/stores/markerStore';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';
import { arrangementStore } from '../../stores/arrangementStore';
import { syncCurrentArrangementToStore } from '../arrangement';
import { type ProjectData } from '../../models/ProjectData';
import { projectStore } from '../../stores/projectStore';
import { addToRecentProjects } from '../recentProjects';
import { getAllSidechainRoutes } from '#/modules/Routing/useCases/sidechain';
import { writeProjectJson, writeNamedProjectJson } from '../../repositories/project';
import { isNativeFileSystemAvailable, saveProjectToFile, getProjectDirectory } from '../../repositories/nativeProjectFiles';
import { notifyUser } from '#/helpers/Notification/notifyUser';

export function saveProject(): void {
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

    try {
        const json = JSON.stringify(data);
        writeProjectJson(json);
        writeNamedProjectJson(project.name, json);

        if (isNativeFileSystemAvailable()) {
            getProjectDirectory()
                .then((dir) => saveProjectToFile(`${dir}/${project.name}.webdaw`, data))
                .catch(() => {
                    /* native save is best-effort */
                });
        }

        projectStore.set({ ...project, updatedAt: data.updatedAt, dirty: false, loading: false });
        addToRecentProjects(project.name, `webdaw:project:${project.name}`);
    } catch {
        notifyUser('Failed to save project — storage may be full', 'error');
        return;
    }
}

export function renameProject(name: string): void {
    const state = projectStore.value;
    if (!state) {
        return;
    }
    projectStore.set({ ...state, name, dirty: true });
}

export function markDirty(): void {
    const state = projectStore.value;
    if (!state) {
        return;
    }
    if (!state.dirty) {
        projectStore.set({ ...state, dirty: true });
    }
}
