import { trackStore } from '#/modules/Track/stores/trackStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { midiStore } from '#/modules/Midi/stores/midiStore';
import { tempoMapStore } from '#/modules/Transport/stores/tempoMapStore';
import { timeSignatureMapStore } from '#/modules/Transport/stores/timeSignatureMapStore';
import { markerStore } from '#/modules/Timeline/stores/markerStore';
import { takeLaneStore } from '#/modules/Clip/stores/takeLaneStore';
import { arrangementStore, defaultArrangementId } from '../../stores/arrangementStore';
import { defaultTransportState } from '#/modules/Transport/useCases/transportQueries';
import { type ProjectData } from '../../models/ProjectData';
import { projectStore } from '../../stores/projectStore';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { getAudioContext } from '#/modules/AudioEngine/useCases/engineAccess';
import { setSidechainRoutes } from '#/modules/AudioEngine/useCases/sidechainUseCases';
import { readProjectJson, writeProjectJson } from '../../repositories/projectRepository';
import { isNativeFileSystemAvailable, loadProjectFromFile, getProjectDirectory } from '../../repositories/nativeProjectFiles';
import { clearUndoHistory, verifyAudioBufferReferences } from './helpers';
import { newProject } from './newProject';

export async function loadProject(): Promise<boolean> {
    projectStore.set({ ...projectStore.value!, loading: true });
    try {
        if (isNativeFileSystemAvailable()) {
            try {
                const dir = await getProjectDirectory();
                const projectState = projectStore.value;
                if (projectState?.name) {
                    const nativeData = await loadProjectFromFile(`${dir}/${projectState.name}.webdaw`);
                    if (nativeData?.version === 1) {
                        writeProjectJson(JSON.stringify(nativeData));
                    }
                }
            } catch {
                // Fall through to localStorage
            }
        }

        const raw = readProjectJson();
        if (!raw) {
            newProject();
            return true;
        }

        const data = JSON.parse(raw) as ProjectData;
        if (data.version !== 1) {
            newProject();
            return true;
        }

        trackStore.set(data.tracks);
        transportStore.set({
            ...defaultTransportState,
            ...data.transport,
        });
        automationStore.set(data.automation);
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
        newProject();
        clearUndoHistory();
        return true;
    }
}
