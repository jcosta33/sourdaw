import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { setTrackInput } from '#/modules/Arrangement/useCases/setTrackInput';
import { removeTrack } from '#/modules/Arrangement/useCases/removeTrack';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { type MidiStoreState, midiStore } from '#/modules/MIDI/stores/midiStore';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';
import { setTrackState } from '#/modules/Arrangement/repositories/track';
import { pushUndoEntry } from '#/modules/Command/useCases/pushUndoEntry';
import { renameTrack } from '#/modules/Arrangement/useCases/renameTrack';
import {
    muteTrack,
    soloTrack,
    clearSolos,
    selectTrack,
    reorderTrack,
    hideTrack,
    disableTrack,
    setTrackHeight,
    setTrackOutput,
    setAutomationMode,
    foldTrack,
    groupTracks,
    ungroupTracks,
    toggleSoloSafe,
} from '#/modules/Arrangement/useCases/toggleTrackState';
import { armTrack } from '#/modules/Arrangement/useCases/recording';
import { freezeTrack, unfreezeTrack, bounceInPlace, bounceToNewTrack } from '#/modules/Arrangement/useCases/freezeBounce';
import { duplicateTrack } from '#/modules/Arrangement/useCases/duplicateTrack';
import { createFolder } from '#/modules/Arrangement/useCases/folder';
import { setTrackGain, setTrackPan, setTrackColor, setTrackNotes } from '#/modules/Arrangement/useCases/setTrackGainPan';
import { zoomTracksVertical } from '#/modules/Arrangement/useCases/trackZoom';
import {
    setTrackGain as engineSetTrackGain,
    setTrackPan as engineSetTrackPan,
} from '#/modules/AudioEngine/useCases/trackAudioControls';
import { getTrackStoreState } from '#/modules/Arrangement/useCases/trackQueries';

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const trackHandlers = {
    addTrack: {
        execute: (a) => {
            addTrack(a.payload);
        },
        describe: (a) => ({ label: `Add ${a.payload.kind} track "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'addTrack'>>,

    removeTrack: {
        execute: (a) => {
            const track = getTrackStoreState()?.tracks.find((t) => t.id === a.payload.trackId);
            if (!track) {
                return;
            }

            // Snapshot everything that removeTrack deletes
            const trackSnapshot = JSON.parse(JSON.stringify(track)) as typeof track;

            const autoState = automationStore.value;
            const autoLanes = autoState ? autoState.lanes.filter((l) => l.trackId === a.payload.trackId) : [];
            const autoLaneSnapshots = JSON.parse(JSON.stringify(autoLanes)) as typeof autoLanes;

            const midiState = midiStore.value;
            const clipIds = track.clips.map((c) => c.id);
            const midiSnapshots: MidiStoreState = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };
            if (midiState) {
                for (const cid of clipIds) {
                    if (midiState.notesByClipId[cid]) {
                        midiSnapshots.notesByClipId[cid] = JSON.parse(JSON.stringify(midiState.notesByClipId[cid]));
                    }
                    if (midiState.ccByClipId[cid]) {
                        midiSnapshots.ccByClipId[cid] = JSON.parse(JSON.stringify(midiState.ccByClipId[cid]));
                    }
                    if (midiState.pitchBendByClipId[cid]) {
                        midiSnapshots.pitchBendByClipId[cid] = JSON.parse(
                            JSON.stringify(midiState.pitchBendByClipId[cid])
                        );
                    }
                }
            }

            const takeLaneState = takeLaneStore.value;
            const takeLanes = takeLaneState ? takeLaneState.lanes.filter((l) => l.trackId === a.payload.trackId) : [];
            const takeLaneSnapshots = JSON.parse(JSON.stringify(takeLanes)) as typeof takeLanes;

            // Execute the actual removal
            removeTrack(a.payload.trackId);

            // Push callback undo entry
            pushUndoEntry(
                'Remove track',
                () => {
                    // Undo: restore track, automation, MIDI, take lanes
                    const state = getTrackStoreState();
                    if (state) {
                        setTrackState({ ...state, tracks: [...state.tracks, trackSnapshot] });
                    }
                    if (autoLaneSnapshots.length > 0) {
                        const currentAuto = automationStore.value;
                        if (currentAuto) {
                            automationStore.set({ lanes: [...currentAuto.lanes, ...autoLaneSnapshots] });
                        }
                    }
                    const currentMidi = midiStore.value;
                    if (currentMidi) {
                        midiStore.set({
                            notesByClipId: { ...currentMidi.notesByClipId, ...midiSnapshots.notesByClipId },
                            ccByClipId: { ...currentMidi.ccByClipId, ...midiSnapshots.ccByClipId },
                            pitchBendByClipId: { ...currentMidi.pitchBendByClipId, ...midiSnapshots.pitchBendByClipId },
                        });
                    }
                    if (takeLaneSnapshots.length > 0) {
                        const currentTake = takeLaneStore.value;
                        if (currentTake) {
                            takeLaneStore.set({ lanes: [...currentTake.lanes, ...takeLaneSnapshots] });
                        }
                    }
                },
                () => {
                    // Redo: remove again
                    removeTrack(a.payload.trackId);
                }
            );
        },
        describe: () => ({ label: 'Remove track' }),
        undoable: false, // handler manages its own undo entry
    } satisfies ActionHandler<Extract<AppAction, 'removeTrack'>>,

    removeAllTracks: {
        execute: () => {
            const state = getTrackStoreState();
            if (state) {
                for (const t of state.tracks) {
                    removeTrack(t.id);
                }
            }
        },
        describe: () => ({ label: 'Remove all tracks' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'removeAllTracks'>>,

    renameTrack: {
        execute: (a) => {
            renameTrack(a.payload.trackId, a.payload.name);
        },
        describe: (a) => ({ label: `Rename track to "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'renameTrack'>>,

    selectTrack: {
        execute: (a) => {
            selectTrack(a.payload.trackId);
        },
        describe: () => ({ label: 'Select track' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'selectTrack'>>,

    muteTrack: {
        execute: (a) => {
            muteTrack(a.payload.trackId, a.payload.muted);
        },
        describe: (a) => ({
            label: a.payload.muted ? 'Mute track' : 'Unmute track',
            inverseAction: { type: 'muteTrack', payload: { trackId: a.payload.trackId, muted: !a.payload.muted } },
        }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'muteTrack'>>,

    soloTrack: {
        execute: (a) => {
            soloTrack(a.payload.trackId, a.payload.soloed);
        },
        describe: (a) => ({
            label: a.payload.soloed ? 'Solo track' : 'Unsolo track',
            inverseAction: { type: 'soloTrack', payload: { trackId: a.payload.trackId, soloed: !a.payload.soloed } },
        }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'soloTrack'>>,

    armTrack: {
        execute: (a) => {
            armTrack(a.payload.trackId, a.payload.armed);
        },
        describe: (a) => ({ label: a.payload.armed ? 'Arm track' : 'Disarm track' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'armTrack'>>,

    freezeTrack: {
        execute: async (a) => {
            await freezeTrack(a.payload.trackId);
        },
        describe: () => ({ label: 'Freeze track' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'freezeTrack'>>,

    unfreezeTrack: {
        execute: (a) => {
            unfreezeTrack(a.payload.trackId);
        },
        describe: () => ({ label: 'Unfreeze track' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'unfreezeTrack'>>,

    bounceInPlace: {
        execute: (a) => {
            bounceInPlace(a.payload.trackId);
        },
        describe: () => ({ label: 'Bounce in place' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'bounceInPlace'>>,

    duplicateTrack: {
        execute: (a) => {
            duplicateTrack(a.payload.trackId);
        },
        describe: () => ({ label: 'Duplicate track' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'duplicateTrack'>>,

    reorderTrack: {
        execute: (a) => {
            reorderTrack(a.payload.trackId, a.payload.newIndex);
        },
        describe: () => ({ label: 'Reorder track' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'reorderTrack'>>,

    setTrackGain: {
        execute: (a) => {
            setTrackGain(a.payload.trackId, a.payload.gain);
            engineSetTrackGain(a.payload.trackId, a.payload.gain);
        },
        describe: (a) => {
            const prev = getTrackStoreState()?.tracks.find((t) => t.id === a.payload.trackId);
            return {
                label: 'Set track gain',
                inverseAction: prev
                    ? { type: 'setTrackGain', payload: { trackId: a.payload.trackId, gain: prev.gain } }
                    : null,
            };
        },
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setTrackGain'>>,

    setTrackPan: {
        execute: (a) => {
            setTrackPan(a.payload.trackId, a.payload.pan);
            engineSetTrackPan(a.payload.trackId, a.payload.pan);
        },
        describe: (a) => {
            const prev = getTrackStoreState()?.tracks.find((t) => t.id === a.payload.trackId);
            return {
                label: 'Set track pan',
                inverseAction: prev
                    ? { type: 'setTrackPan', payload: { trackId: a.payload.trackId, pan: prev.pan } }
                    : null,
            };
        },
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setTrackPan'>>,

    setTrackColor: {
        execute: (a) => {
            setTrackColor(a.payload.trackId, a.payload.color);
        },
        describe: (a) => {
            const prev = getTrackStoreState()?.tracks.find((t) => t.id === a.payload.trackId);
            return {
                label: 'Set track color',
                inverseAction: prev
                    ? { type: 'setTrackColor', payload: { trackId: a.payload.trackId, color: prev.color } }
                    : null,
            };
        },
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setTrackColor'>>,

    createBus: {
        execute: (a) => {
            addTrack({ name: a.payload.name, kind: 'bus' });
        },
        describe: (a) => ({ label: `Create bus "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'createBus'>>,

    createFolder: {
        execute: (a) => {
            createFolder(a.payload.name);
        },
        describe: (a) => ({ label: `Create folder "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'createFolder'>>,

    hideTrack: {
        execute: (a) => {
            hideTrack(a.payload.trackId, a.payload.hidden);
        },
        describe: (a) => ({ label: a.payload.hidden ? 'Hide track' : 'Show track' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'hideTrack'>>,

    disableTrack: {
        execute: (a) => {
            disableTrack(a.payload.trackId, a.payload.disabled);
        },
        describe: (a) => ({ label: a.payload.disabled ? 'Disable track' : 'Enable track' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'disableTrack'>>,

    setTrackHeight: {
        execute: (a) => {
            setTrackHeight(a.payload.trackId, a.payload.height);
        },
        describe: () => ({ label: 'Set track height' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setTrackHeight'>>,

    setTrackOutput: {
        execute: (a) => {
            setTrackOutput(a.payload.trackId, a.payload.outputId);
        },
        describe: () => ({ label: 'Set track output' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setTrackOutput'>>,

    setAutomationMode: {
        execute: (a) => {
            setAutomationMode(a.payload.trackId, a.payload.mode);
        },
        describe: (a) => ({ label: `Set automation mode: ${a.payload.mode}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setAutomationMode'>>,

    foldTrack: {
        execute: (a) => {
            foldTrack(a.payload.trackId, a.payload.folded);
        },
        describe: (a) => ({ label: a.payload.folded ? 'Fold track' : 'Unfold track' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'foldTrack'>>,

    groupTracks: {
        execute: (a) => {
            groupTracks(a.payload.trackIds, a.payload.name);
        },
        describe: (a) => ({ label: `Group tracks: "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'groupTracks'>>,

    ungroupTracks: {
        execute: (a) => {
            ungroupTracks(a.payload.groupId);
        },
        describe: () => ({ label: 'Ungroup tracks' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'ungroupTracks'>>,

    toggleSoloSafe: {
        execute: (a) => {
            toggleSoloSafe(a.payload.trackId);
        },
        describe: () => ({ label: 'Toggle solo safe' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'toggleSoloSafe'>>,

    setTrackNotes: {
        execute: (a) => {
            setTrackNotes(a.payload.trackId, a.payload.notes);
        },
        describe: () => {
            return { label: 'Set track notes' };
        },
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setTrackNotes'>>,

    setTrackInput: {
        execute: (a) => {
            setTrackInput(a.payload.trackId, a.payload.inputId);
        },
        describe: () => ({ label: 'Set track input' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setTrackInput'>>,

    clearSolos: {
        execute: () => {
            clearSolos();
        },
        describe: () => ({ label: 'Clear all solos' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'clearSolos'>>,

    zoomTracksVertical: {
        execute: (a) => {
            zoomTracksVertical(a.payload.delta);
        },
        describe: (a) => ({ label: `Zoom tracks vertical ${a.payload.delta > 0 ? 'in' : 'out'}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'zoomTracksVertical'>>,

    consolidateAllTracks: {
        execute: async () => {
            const state = getTrackStoreState();
            if (!state) {
                return;
            }
            for (const track of state.tracks) {
                if ((track.kind === 'audio' || track.kind === 'midi') && track.clips.length > 0) {
                    await bounceInPlace(track.id);
                }
            }
        },
        describe: () => ({ label: 'Consolidate all tracks' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'consolidateAllTracks'>>,

    bounceToNewTrack: {
        execute: async (a) => {
            await bounceToNewTrack(a.payload.trackId);
        },
        describe: () => ({ label: 'Bounce to new track' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'bounceToNewTrack'>>,
};
