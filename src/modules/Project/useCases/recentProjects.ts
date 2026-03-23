import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { LocalStorageStorage } from '#/helpers/Store/Storage/LocalStorageStorage';
import { trackStore } from '#/modules/Track/stores/trackStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { midiStore } from '#/modules/Midi/stores/midiStore';
import { tempoMapStore } from '#/modules/Transport/stores/tempoMapStore';
import { timeSignatureMapStore } from '#/modules/Transport/stores/timeSignatureMapStore';
import { markerStore } from '#/modules/Timeline/stores/markerStore';
import { takeLaneStore } from '#/modules/Clip/stores/takeLaneStore';
import { setSidechainRoutes } from '#/modules/AudioEngine/useCases/sidechainUseCases';
import { defaultTransportState } from '#/modules/Transport/useCases/transportQueries';
import { type ProjectData, RECENT_PROJECTS_KEY } from '../models/ProjectData';
import { projectStore } from '../stores/projectStore';
import { readNamedProjectJson, writeProjectJson } from '../repositories/projectRepository/storageOperations';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { getAudioContext } from '#/modules/AudioEngine/useCases/engineAccess';
import { undoStore } from '#/modules/Command/stores/undoStore';
import { notifyUser } from '#/helpers/Notification/notifyUser';

const logger = Container.getInstance().get(Logger);

const MAX_RECENT = 10;

const recentProjectsStorage = new LocalStorageStorage<RecentProjectEntry[]>(
    RECENT_PROJECTS_KEY as 'webdaw:recent-projects'
);

export type RecentProjectEntry = {
    name: string;
    key: string;
    updatedAt: number;
};

export function getRecentProjects(): RecentProjectEntry[] {
    return recentProjectsStorage.get() ?? [];
}

export function addToRecentProjects(name: string, key: string): void {
    try {
        const entries = getRecentProjects().filter((e) => e.key !== key);
        entries.unshift({ name, key, updatedAt: Date.now() });
        recentProjectsStorage.set(entries.slice(0, MAX_RECENT));
    } catch (error) {
        logger.warn(`Failed to update recent projects: ${error}`);
    }
}

export function removeFromRecentProjects(key: string): void {
    try {
        recentProjectsStorage.set(getRecentProjects().filter((e) => e.key !== key));
    } catch (error) {
        logger.warn(`Failed to remove from recent projects: ${error}`);
    }
}

export async function loadRecentProject(key: string): Promise<boolean> {
    try {
        const raw = readNamedProjectJson(key);
        if (!raw) {
            logger.warn(`No project data found for key: ${key}`);
            return false;
        }

        const data = JSON.parse(raw) as ProjectData;
        if (data.version !== 1) {
            logger.warn(`Unsupported project version for key: ${key}`);
            return false;
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

        writeProjectJson(raw);

        await audioBufferCache.restoreFromIdb(getAudioContext());
        if (trackStore.value) {
            trackStore.set({ ...trackStore.value });
        }
        verifyAudioBufferReferences();
        undoStore.set({ past: [], future: [] });

        return true;
    } catch (error) {
        logger.error(new Error('Failed to load recent project', { cause: error }));
        return false;
    }
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
