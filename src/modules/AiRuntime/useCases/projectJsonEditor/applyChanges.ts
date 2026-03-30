/**
 * Apply diffed project changes to the actual DAW stores.
 *
 * This is the final step: validated changes are applied to the
 * real track store, transport store, etc.
 */
import { type ProjectChange } from './diffAndPatch';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { removeTrack } from '#/modules/Arrangement/useCases/removeTrack';
import { addClip } from '#/modules/Arrangement/useCases/clip/addClip';
import { addDevice } from '#/modules/Arrangement/useCases/device/addDevice';

/**
 * Apply a list of validated project changes to the DAW stores.
 * Returns a list of descriptions for the undo history.
 */
export function applyProjectChanges(changes: ProjectChange[]): string[] {
    const applied: string[] = [];

    for (const change of changes) {
        try {
            applyChange(change);
            applied.push(describeChange(change));
        } catch (error) {
            // Log but continue with remaining changes
            console.warn(`Failed to apply change: ${describeChange(change)}`, error);
        }
    }

    return applied;
}

function applyChange(change: ProjectChange): void {
    switch (change.type) {
        case 'set_tempo': {
            const state = transportStore.value;
            if (state) {
                transportStore.set({ ...state, tempo: clampTempo(change.value) });
            }
            break;
        }

        case 'set_time_signature': {
            const state = transportStore.value;
            if (state) {
                transportStore.set({
                    ...state,
                    timeSignatureNumerator: Math.max(1, Math.min(32, change.numerator)),
                    timeSignatureDenominator: Math.max(1, Math.min(32, change.denominator)),
                });
            }
            break;
        }

        case 'add_track': {
            addTrack({
                name: change.track.name,
                kind: change.track.kind as 'audio' | 'midi' | 'bus' | 'master',
            });
            break;
        }

        case 'remove_track': {
            removeTrack(change.id);
            break;
        }

        case 'update_track': {
            const state = trackStore.value;
            if (!state) {
                break;
            }
            const tracks = state.tracks.map((t) => {
                if (t.id !== change.id) {
                    return t;
                }
                return { ...t, [change.field]: change.value };
            });
            trackStore.set({ ...state, tracks });
            break;
        }

        case 'reorder_tracks': {
            const state = trackStore.value;
            if (!state) {
                break;
            }
            const trackMap = new Map(state.tracks.map((t) => [t.id, t]));
            const reordered = change.order.map((id) => trackMap.get(id)).filter(Boolean) as typeof state.tracks;
            // Append any tracks not in the new order (safety)
            for (const t of state.tracks) {
                if (!change.order.includes(t.id)) {
                    reordered.push(t);
                }
            }
            trackStore.set({ ...state, tracks: reordered });
            break;
        }

        case 'add_clip': {
            const trackId = change.trackId;
            addClip({
                trackId,
                name: change.clip.name,
                type: change.clip.type,
                startBeat: change.clip.startBeat,
                endBeat: change.clip.endBeat,
                audioBufferId: change.clip.audioBufferId,
            });
            break;
        }

        case 'remove_clip': {
            const state = trackStore.value;
            if (!state) {
                break;
            }
            const tracks = state.tracks.map((t) => {
                if (t.id !== change.trackId) {
                    return t;
                }
                return { ...t, clips: t.clips.filter((c) => c.id !== change.clipId) };
            });
            trackStore.set({ ...state, tracks });
            break;
        }

        case 'update_clip': {
            const state = trackStore.value;
            if (!state) {
                break;
            }
            const tracks = state.tracks.map((t) => {
                if (t.id !== change.trackId) {
                    return t;
                }
                return {
                    ...t,
                    clips: t.clips.map((c) => {
                        if (c.id !== change.clipId) {
                            return c;
                        }
                        return { ...c, [change.field]: change.value };
                    }),
                };
            });
            trackStore.set({ ...state, tracks });
            break;
        }

        case 'add_device': {
            addDevice(change.trackId, change.device.type);
            break;
        }

        case 'remove_device': {
            const state = trackStore.value;
            if (!state) {
                break;
            }
            const tracks = state.tracks.map((t) => {
                if (t.id !== change.trackId) {
                    return t;
                }
                return { ...t, devices: t.devices.filter((d) => d.id !== change.deviceId) };
            });
            trackStore.set({ ...state, tracks });
            break;
        }

        case 'update_device': {
            const state = trackStore.value;
            if (!state) {
                break;
            }
            const tracks = state.tracks.map((t) => {
                if (t.id !== change.trackId) {
                    return t;
                }
                return {
                    ...t,
                    devices: t.devices.map((d) => {
                        if (d.id !== change.deviceId) {
                            return d;
                        }
                        return { ...d, [change.field]: change.value };
                    }),
                };
            });
            trackStore.set({ ...state, tracks });
            break;
        }

        case 'update_clip_notes': {
            // Apply MIDI note changes via the MIDI store
            void import('#/modules/MIDI/stores/midiStore').then(({ midiStore }) => {
                const ms = midiStore.value;
                if (!ms) {
                    return;
                }
                const newNotes = change.notes.map((n, i) => ({
                    id: `note-ai-${Date.now()}-${i}`,
                    pitch: Math.max(0, Math.min(127, n.pitch)),
                    startBeat: Math.max(0, n.startBeat),
                    duration: Math.max(0.01, n.duration),
                    velocity: Math.max(0, Math.min(127, n.velocity)),
                }));
                midiStore.set({
                    ...ms,
                    notesByClipId: {
                        ...ms.notesByClipId,
                        [change.clipId]: newNotes,
                    },
                });
            });
            break;
        }

        case 'set_selection': {
            const state = trackStore.value;
            if (state && change.trackId) {
                trackStore.set({ ...state, selectedTrackId: change.trackId });
            }
            break;
        }
    }
}

function describeChange(change: ProjectChange): string {
    switch (change.type) {
        case 'set_tempo':
            return `Set tempo to ${change.value} BPM`;
        case 'set_time_signature':
            return `Set time signature to ${change.numerator}/${change.denominator}`;
        case 'add_track':
            return `Added track "${change.track.name}"`;
        case 'remove_track':
            return `Removed track`;
        case 'update_track':
            return `Changed track ${change.field}`;
        case 'reorder_tracks':
            return `Reordered tracks`;
        case 'add_clip':
            return `Added clip "${change.clip.name}"`;
        case 'remove_clip':
            return `Removed clip`;
        case 'update_clip':
            return `Changed clip ${change.field}`;
        case 'add_device':
            return `Added ${change.device.type}`;
        case 'remove_device':
            return `Removed device`;
        case 'update_device':
            return `Changed device ${change.field}`;
        case 'update_clip_notes':
            return `Modified ${change.notes.length} MIDI notes`;
        case 'set_selection':
            return `Changed selection`;
        default:
            return `Unknown change`;
    }
}

function clampTempo(bpm: number): number {
    return Math.max(20, Math.min(999, bpm));
}
