import { addTrack } from './addTrack';
import { setTrackInput } from './setTrackInput';
import { removeTrack } from './removeTrack';
import { automationStore } from '#/modules/Automation';
import { midiStore } from '#/modules/MIDI';
import { takeLaneStore } from '../stores/takeLaneStore';
import { renameTrack } from './renameTrack';
import { muteTrack } from './toggleTrackState/muteTrack';
import { soloTrack } from './toggleTrackState/soloTrack';
import { clearSolos } from './toggleTrackState/clearSolos';
import { selectTrack } from './toggleTrackState/selectTrack';
import { reorderTrack } from './toggleTrackState/reorderTrack';
import { hideTrack } from './toggleTrackState/hideTrack';
import { disableTrack } from './toggleTrackState/disableTrack';
import { setTrackHeight } from './toggleTrackState/setTrackHeight';
import { setTrackOutput } from './toggleTrackState/setTrackOutput';
import { setAutomationMode } from './toggleTrackState/setAutomationMode';
import { foldTrack } from './toggleTrackState/foldTrack';
import { groupTracks } from './toggleTrackState/groupTracks';
import { ungroupTracks } from './toggleTrackState/ungroupTracks';
import { toggleSoloSafe } from './toggleTrackState/toggleSoloSafe';
import { armTrack } from './recording';
import { freezeTrack, unfreezeTrack } from './freezeBounce/freezeTrack';
import { bounceInPlace, bounceToNewTrack } from './freezeBounce/bounceOperations';
import { duplicateTrack } from './duplicateTrack';
import { createFolder } from './folder';
import {
    setTrackGain,
    setTrackPan,
    setTrackColor,
    setTrackNotes,
} from './setTrackGainPan';
import { zoomTracksVertical } from './trackZoom';
import { setTrackGain as engineSetTrackGain, setTrackPan as engineSetTrackPan } from '#/modules/AudioEngine';
import { getTrackStoreState } from './getTrackStoreState';

type TrackKind = 'audio' | 'midi' | 'bus' | 'master' | 'folder';
type AutomationMode = 'read' | 'write' | 'touch' | 'latch' | 'off';

type RestoreTrackAction = {
    type: 'restoreTrack';
    payload: {
        trackId: string;
        trackSnapshot: unknown;
        automationLaneSnapshots: unknown[];
        midiNotesByClipId: Record<string, unknown>;
        midiCcByClipId: Record<string, unknown>;
        midiPitchBendByClipId: Record<string, unknown>;
        takeLaneSnapshots: unknown[];
    };
};

type TrackInverseAction = RestoreTrackAction;

type TrackAction =
    | { type: 'addTrack'; payload: { id?: string; name: string; kind: TrackKind } }
    | { type: 'removeTrack'; payload: { trackId: string } }
    | { type: 'removeAllTracks'; payload?: undefined }
    | { type: 'renameTrack'; payload: { trackId: string; name: string } }
    | { type: 'selectTrack'; payload: { trackId: string } }
    | { type: 'muteTrack'; payload: { trackId: string; muted: boolean } }
    | { type: 'soloTrack'; payload: { trackId: string; soloed: boolean } }
    | { type: 'armTrack'; payload: { trackId: string; armed: boolean } }
    | { type: 'freezeTrack'; payload: { trackId: string } }
    | { type: 'unfreezeTrack'; payload: { trackId: string } }
    | { type: 'bounceInPlace'; payload: { trackId: string } }
    | { type: 'duplicateTrack'; payload: { trackId: string } }
    | { type: 'reorderTrack'; payload: { trackId: string; newIndex: number } }
    | { type: 'setTrackGain'; payload: { trackId: string; gain: number } }
    | { type: 'setTrackPan'; payload: { trackId: string; pan: number } }
    | { type: 'setTrackColor'; payload: { trackId: string; color: string } }
    | { type: 'createBus'; payload: { name: string } }
    | { type: 'createFolder'; payload: { name: string } }
    | { type: 'hideTrack'; payload: { trackId: string; hidden: boolean } }
    | { type: 'disableTrack'; payload: { trackId: string; disabled: boolean } }
    | { type: 'setTrackHeight'; payload: { trackId: string; height: number } }
    | { type: 'setTrackOutput'; payload: { trackId: string; outputId: string } }
    | { type: 'setAutomationMode'; payload: { trackId: string; mode: AutomationMode } }
    | { type: 'foldTrack'; payload: { trackId: string; folded: boolean } }
    | { type: 'groupTracks'; payload: { trackIds: string[]; name: string } }
    | { type: 'ungroupTracks'; payload: { groupId: string } }
    | { type: 'toggleSoloSafe'; payload: { trackId: string } }
    | { type: 'setTrackNotes'; payload: { trackId: string; notes: string } }
    | { type: 'setTrackInput'; payload: { trackId: string; inputId: string | null } }
    | { type: 'clearSolos'; payload?: undefined }
    | { type: 'zoomTracksVertical'; payload: { delta: number } }
    | { type: 'consolidateAllTracks'; payload?: undefined }
    | { type: 'bounceToNewTrack'; payload: { trackId: string } };

type TrackHandlerResult = {
    label: string;
    inverseAction?: TrackAction | TrackInverseAction | null;
};

type TrackHandler<Action> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => TrackHandlerResult;
    undoable: boolean;
};

type TrackHandlers = {
    [ActionType in TrackAction['type']]: TrackHandler<Extract<TrackAction, { type: ActionType }>>;
};

export const trackHandlers: TrackHandlers = {
    addTrack: {
        execute: (a) => {
            addTrack(a.payload);
        },
        describe: (a) => ({ label: `Add ${a.payload.kind} track "${a.payload.name}"` }),
        undoable: true,
    },

    removeTrack: {
        execute: (a) => {
            removeTrack(a.payload.trackId);
        },
        describe: (a) => {
            // Snapshot everything that removeTrack will delete, so the inverse
            // action (`restoreTrack`) can replay it. Runs pre-execute.
            const track = getTrackStoreState()?.tracks.find((t) => t.id === a.payload.trackId);
            if (!track) {
                return { label: 'Remove track' };
            }

            const trackSnapshot = structuredClone(track);

            const autoState = automationStore.value;
            const autoLanes = autoState ? autoState.lanes.filter((l) => l.trackId === a.payload.trackId) : [];
            const automationLaneSnapshots = structuredClone(autoLanes);

            const midiState = midiStore.value;
            const clipIds = track.clips.map((c) => c.id);
            const midiNotesByClipId: Record<string, unknown> = {};
            const midiCcByClipId: Record<string, unknown> = {};
            const midiPitchBendByClipId: Record<string, unknown> = {};
            if (midiState) {
                for (const cid of clipIds) {
                    if (midiState.notesByClipId[cid]) {
                        midiNotesByClipId[cid] = structuredClone(midiState.notesByClipId[cid]);
                    }
                    if (midiState.ccByClipId[cid]) {
                        midiCcByClipId[cid] = structuredClone(midiState.ccByClipId[cid]);
                    }
                    if (midiState.pitchBendByClipId[cid]) {
                        midiPitchBendByClipId[cid] = structuredClone(midiState.pitchBendByClipId[cid]);
                    }
                }
            }

            const takeLaneState = takeLaneStore.value;
            const takeLanes = takeLaneState ? takeLaneState.lanes.filter((l) => l.trackId === a.payload.trackId) : [];
            const takeLaneSnapshots = structuredClone(takeLanes);

            return {
                label: 'Remove track',
                inverseAction: {
                    type: 'restoreTrack',
                    payload: {
                        trackId: a.payload.trackId,
                        trackSnapshot,
                        automationLaneSnapshots,
                        midiNotesByClipId,
                        midiCcByClipId,
                        midiPitchBendByClipId,
                        takeLaneSnapshots,
                    },
                },
            };
        },
        undoable: true,
    },

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
    },

    renameTrack: {
        execute: (a) => {
            renameTrack(a.payload.trackId, a.payload.name);
        },
        describe: (a) => ({ label: `Rename track to "${a.payload.name}"` }),
        undoable: true,
    },

    selectTrack: {
        execute: (a) => {
            selectTrack(a.payload.trackId);
        },
        describe: () => ({ label: 'Select track' }),
        undoable: false,
    },

    muteTrack: {
        execute: (a) => {
            muteTrack(a.payload.trackId, a.payload.muted);
        },
        describe: (a) => ({
            label: a.payload.muted ? 'Mute track' : 'Unmute track',
            inverseAction: { type: 'muteTrack', payload: { trackId: a.payload.trackId, muted: !a.payload.muted } },
        }),
        undoable: true,
    },

    soloTrack: {
        execute: (a) => {
            soloTrack(a.payload.trackId, a.payload.soloed);
        },
        describe: (a) => ({
            label: a.payload.soloed ? 'Solo track' : 'Unsolo track',
            inverseAction: { type: 'soloTrack', payload: { trackId: a.payload.trackId, soloed: !a.payload.soloed } },
        }),
        undoable: true,
    },

    armTrack: {
        execute: (a) => {
            armTrack(a.payload.trackId, a.payload.armed);
        },
        describe: (a) => ({ label: a.payload.armed ? 'Arm track' : 'Disarm track' }),
        undoable: true,
    },

    freezeTrack: {
        execute: async (a) => {
            await freezeTrack(a.payload.trackId);
        },
        describe: () => ({ label: 'Freeze track' }),
        undoable: true,
    },

    unfreezeTrack: {
        execute: (a) => {
            unfreezeTrack(a.payload.trackId);
        },
        describe: () => ({ label: 'Unfreeze track' }),
        undoable: true,
    },

    bounceInPlace: {
        execute: (a) => {
            bounceInPlace(a.payload.trackId);
        },
        describe: () => ({ label: 'Bounce in place' }),
        undoable: true,
    },

    duplicateTrack: {
        execute: (a) => {
            duplicateTrack(a.payload.trackId);
        },
        describe: () => ({ label: 'Duplicate track' }),
        undoable: true,
    },

    reorderTrack: {
        execute: (a) => {
            reorderTrack(a.payload.trackId, a.payload.newIndex);
        },
        describe: () => ({ label: 'Reorder track' }),
        undoable: true,
    },

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
    },

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
    },

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
    },

    createBus: {
        execute: (a) => {
            addTrack({ name: a.payload.name, kind: 'bus' });
        },
        describe: (a) => ({ label: `Create bus "${a.payload.name}"` }),
        undoable: true,
    },

    createFolder: {
        execute: (a) => {
            createFolder(a.payload.name);
        },
        describe: (a) => ({ label: `Create folder "${a.payload.name}"` }),
        undoable: true,
    },

    hideTrack: {
        execute: (a) => {
            hideTrack(a.payload.trackId, a.payload.hidden);
        },
        describe: (a) => ({ label: a.payload.hidden ? 'Hide track' : 'Show track' }),
        undoable: true,
    },

    disableTrack: {
        execute: (a) => {
            disableTrack(a.payload.trackId, a.payload.disabled);
        },
        describe: (a) => ({ label: a.payload.disabled ? 'Disable track' : 'Enable track' }),
        undoable: true,
    },

    setTrackHeight: {
        execute: (a) => {
            setTrackHeight(a.payload.trackId, a.payload.height);
        },
        describe: () => ({ label: 'Set track height' }),
        undoable: true,
    },

    setTrackOutput: {
        execute: (a) => {
            setTrackOutput(a.payload.trackId, a.payload.outputId);
        },
        describe: () => ({ label: 'Set track output' }),
        undoable: true,
    },

    setAutomationMode: {
        execute: (a) => {
            setAutomationMode(a.payload.trackId, a.payload.mode);
        },
        describe: (a) => ({ label: `Set automation mode: ${a.payload.mode}` }),
        undoable: true,
    },

    foldTrack: {
        execute: (a) => {
            foldTrack(a.payload.trackId, a.payload.folded);
        },
        describe: (a) => ({ label: a.payload.folded ? 'Fold track' : 'Unfold track' }),
        undoable: true,
    },

    groupTracks: {
        execute: (a) => {
            groupTracks(a.payload.trackIds, a.payload.name);
        },
        describe: (a) => ({ label: `Group tracks: "${a.payload.name}"` }),
        undoable: true,
    },

    ungroupTracks: {
        execute: (a) => {
            ungroupTracks(a.payload.groupId);
        },
        describe: () => ({ label: 'Ungroup tracks' }),
        undoable: true,
    },

    toggleSoloSafe: {
        execute: (a) => {
            toggleSoloSafe(a.payload.trackId);
        },
        describe: () => ({ label: 'Toggle solo safe' }),
        undoable: true,
    },

    setTrackNotes: {
        execute: (a) => {
            setTrackNotes(a.payload.trackId, a.payload.notes);
        },
        describe: () => {
            return { label: 'Set track notes' };
        },
        undoable: true,
    },

    setTrackInput: {
        execute: (a) => {
            setTrackInput(a.payload.trackId, a.payload.inputId);
        },
        describe: () => ({ label: 'Set track input' }),
        undoable: true,
    },

    clearSolos: {
        execute: () => {
            clearSolos();
        },
        describe: () => ({ label: 'Clear all solos' }),
        undoable: true,
    },

    zoomTracksVertical: {
        execute: (a) => {
            zoomTracksVertical(a.payload.delta);
        },
        describe: (a) => ({ label: `Zoom tracks vertical ${a.payload.delta > 0 ? 'in' : 'out'}` }),
        undoable: true,
    },

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
    },

    bounceToNewTrack: {
        execute: async (a) => {
            await bounceToNewTrack(a.payload.trackId);
        },
        describe: () => ({ label: 'Bounce to new track' }),
        undoable: true,
    },
};
