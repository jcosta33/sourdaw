import { trackStore } from '#/modules/Track/stores/trackStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { automationStore } from '#/modules/Track/stores/automationStore';
import { midiStore } from '#/modules/Track/stores/midiStore';
import { tempoMapStore } from '#/modules/Transport/stores/tempoMapStore';
import { timeSignatureMapStore } from '#/modules/Transport/stores/timeSignatureMapStore';
import { markerStore } from '#/modules/Timeline/stores/markerStore';
import { takeLaneStore } from '#/modules/Track/stores/takeLaneStore';
import { arrangementStore, defaultArrangementId } from '../stores/arrangementStore';
import { syncCurrentArrangementToStore } from './arrangementUseCases';
import { defaultTransportState } from '#/modules/Transport/useCases/transportQueries';
import { type ProjectData } from '../models/ProjectData';
import { projectStore } from '../stores/projectStore';

import { addToRecentProjects } from './recentProjects';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { getAudioContext } from '#/modules/AudioEngine/useCases/engineAccess';
import { undoStore } from '#/modules/Command/stores/undoStore';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { getAllSidechainRoutes, setSidechainRoutes } from '#/modules/AudioEngine/useCases/sidechainUseCases';
import { addTrack as addTrackUseCase } from '#/modules/Track/useCases/addTrack';
import {
    readProjectJson,
    writeProjectJson,
    removeProjectJson,
    writeNamedProjectJson,
    downloadProjectFile,
} from '../repositories/projectRepository';
import {
    isNativeFileSystemAvailable,
    saveProjectToFile,
    loadProjectFromFile,
    getProjectDirectory,
} from './nativeProjectFiles';

function clearUndoHistory(): void {
    undoStore.set({ past: [], future: [] });
}

function verifyAudioBufferReferences(): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const missingClips: string[] = [];
    for (const track of state.tracks) {
        for (const clip of track.clips) {
            if (clip.type === 'audio' && clip.audioBufferId && !audioBufferCache.has(clip.audioBufferId)) {
                missingClips.push(clip.name);
            }
        }
    }

    if (missingClips.length > 0) {
        const clipList =
            missingClips.length <= 3
                ? missingClips.join(', ')
                : `${missingClips.slice(0, 3).join(', ')} and ${missingClips.length - 3} more`;
        notifyUser(`Missing audio buffers for: ${clipList} — re-import the audio files`, 'warning');
    }
}

export function saveProject(): void {
    // Make sure the active arrangement reflects recent track changes in the project file
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
        // Keep active stores at root for backwards compatibility and ease of access
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

        // Also save to native file system when available (Tauri)
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

export async function loadProject(): Promise<boolean> {
    projectStore.set({ ...projectStore.value!, loading: true });
    try {
        // Try native file system first (Tauri)
        if (isNativeFileSystemAvailable()) {
            try {
                const dir = await getProjectDirectory();
                const projectState = projectStore.value;
                if (projectState?.name) {
                    const nativeData = await loadProjectFromFile(`${dir}/${projectState.name}.webdaw`);
                    if (nativeData?.version === 1) {
                        // Write into localStorage so the existing load path processes it
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

        // Initialize arrangementStore with the saved arrangements (or fallback to backwards compat)
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

export function newProject(name = 'Untitled Project'): void {
    trackStore.set({ tracks: [], selectedTrackId: null });
    transportStore.set(defaultTransportState);
    automationStore.set({ lanes: [] });
    midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    tempoMapStore.set({ changes: [] });
    timeSignatureMapStore.set({ changes: [] });
    markerStore.set({ markers: [], sections: [] });
    takeLaneStore.set({ lanes: [] });
    setSidechainRoutes([]);

    arrangementStore.set({
        arrangements: [
            {
                id: defaultArrangementId,
                name: 'Arrangement 1',
                tracks: { tracks: [], selectedTrackId: null },
                automation: { lanes: [] },
                midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            },
        ],
        activeArrangementId: defaultArrangementId,
    });

    // Always seed a master track
    addTrackUseCase({ name: 'Master', kind: 'master' });
    projectStore.set({
        name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dirty: false,
        loading: false,
    });
    removeProjectJson();
    audioBufferCache.clear();
    clearUndoHistory();
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
