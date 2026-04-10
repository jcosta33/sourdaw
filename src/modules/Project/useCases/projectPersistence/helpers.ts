import { inject } from '#/infra/di/inject';
import { markerStore, takeLaneStore, trackStore } from '#/modules/Arrangement';
import { audioBufferCache } from '#/modules/AudioEngine';
import { automationStore } from '#/modules/Automation';
import { undoStore } from '#/modules/Command';
import { midiStore } from '#/modules/MIDI';
import { setSidechainRoutes } from '#/modules/Routing';
import {
    defaultTransportState,
    tempoMapStore,
    timeSignatureMapStore,
    transportStore,
} from '#/modules/Transport';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { type ProjectData } from '../../models/ProjectData';

export const clearUndoHistory = inject({ undoStore })(({ undoStore: store }) => {
    return function clearUndoHistory(): void {
        store.set({ past: [], future: [] });
    };
});

const moduleStoreResetDependencies = {
    trackStore,
    transportStore,
    automationStore,
    midiStore,
    tempoMapStore,
    timeSignatureMapStore,
    markerStore,
    takeLaneStore,
    setSidechainRoutes,
    defaultTransportState,
} as const;

/**
 * Resets all cross-module stores to their initial/empty state.
 * Called when creating a new blank project.
 */
export const resetModuleStoresToDefault = inject(moduleStoreResetDependencies)(
    ({
        trackStore: tracks,
        transportStore: transport,
        automationStore: automation,
        midiStore: midi,
        tempoMapStore: tempoMap,
        timeSignatureMapStore: timeSigMap,
        markerStore: markers,
        takeLaneStore: takeLanes,
        setSidechainRoutes: setRoutes,
        defaultTransportState: defaultTransport,
    }) =>
        function resetModuleStoresToDefault(): void {
            tracks.set({ tracks: [], selectedTrackId: null });
            transport.set(defaultTransport);
            automation.set({ lanes: [] });
            midi.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
            tempoMap.set({ changes: [] });
            timeSigMap.set({ changes: [] });
            markers.set({ markers: [], sections: [] });
            takeLanes.set({ lanes: [] });
            setRoutes([]);
        }
);

/**
 * Hydrates all cross-module stores from a loaded ProjectData object.
 * Called when loading a recent project or importing a project file.
 * Optional fields are only applied when present in the data.
 */
export const hydrateModuleStoresFromProjectData = inject(moduleStoreResetDependencies)(
    ({
        trackStore: tracks,
        transportStore: transport,
        automationStore: automation,
        midiStore: midi,
        tempoMapStore: tempoMap,
        timeSignatureMapStore: timeSigMap,
        markerStore: markers,
        takeLaneStore: takeLanes,
        setSidechainRoutes: setRoutes,
        defaultTransportState: defaultTransport,
    }) =>
        function hydrateModuleStoresFromProjectData(data: ProjectData): void {
            tracks.set(data.tracks);
            transport.set({
                ...defaultTransport,
                ...data.transport,
            });
            if (data.automation) {
                automation.set(data.automation);
            }
            if (data.midi) {
                midi.set(data.midi);
            }
            if (data.tempoMap) {
                tempoMap.set(data.tempoMap);
            }
            if (data.timeSignatureMap) {
                timeSigMap.set(data.timeSignatureMap);
            }
            if (data.markers) {
                markers.set(data.markers);
            }
            if (data.takeLanes) {
                takeLanes.set(data.takeLanes);
            }
            if (data.sidechainRoutes && data.sidechainRoutes.length > 0) {
                setRoutes(data.sidechainRoutes);
            }
        }
);

export const verifyAudioBufferReferences = inject({ trackStore, audioBufferCache, notifyUser })(
    ({ trackStore: tracks, audioBufferCache: bufferCache, notifyUser: notify }) =>
        function verifyAudioBufferReferences(): void {
            const state = tracks.value;
            if (!state) {
                return;
            }

            const missingClips: string[] = [];
            for (const track of state.tracks) {
                for (const clip of track.clips) {
                    if (clip.type === 'audio' && clip.audioBufferId && !bufferCache.has(clip.audioBufferId)) {
                        missingClips.push(clip.name);
                    }
                }
            }

            if (missingClips.length > 0) {
                const clipList =
                    missingClips.length <= 3
                        ? missingClips.join(', ')
                        : `${missingClips.slice(0, 3).join(', ')} and ${missingClips.length - 3} more`;
                notify(`Missing audio buffers for: ${clipList} — re-import the audio files`, 'warning');
            }
        }
);
