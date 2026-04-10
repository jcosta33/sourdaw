import { trackStore, markerStore, takeLaneStore } from '#/modules/Arrangement';
import {
    transportStore,
    tempoMapStore,
    timeSignatureMapStore,
    defaultTransportState,
} from '#/modules/Transport';
import { automationStore } from '#/modules/Automation';
import { midiStore } from '#/modules/MIDI';
import { setSidechainRoutes } from '#/modules/Routing';
import { audioBufferCache } from '#/modules/AudioEngine';
import { undoStore } from '#/modules/Command';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { type ProjectData } from '../../models/ProjectData';

export function clearUndoHistory(): void {
    undoStore.set({ past: [], future: [] });
}

/**
 * Resets all cross-module stores to their initial/empty state.
 * Called when creating a new blank project.
 */
export function resetModuleStoresToDefault(): void {
    trackStore.set({ tracks: [], selectedTrackId: null });
    transportStore.set(defaultTransportState);
    automationStore.set({ lanes: [] });
    midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    tempoMapStore.set({ changes: [] });
    timeSignatureMapStore.set({ changes: [] });
    markerStore.set({ markers: [], sections: [] });
    takeLaneStore.set({ lanes: [] });
    setSidechainRoutes([]);
}

/**
 * Hydrates all cross-module stores from a loaded ProjectData object.
 * Called when loading a recent project or importing a project file.
 * Optional fields are only applied when present in the data.
 */
export function hydrateModuleStoresFromProjectData(data: ProjectData): void {
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
}

export function verifyAudioBufferReferences(): void {
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
