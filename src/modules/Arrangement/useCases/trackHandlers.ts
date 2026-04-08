import { inject } from '#/infra/di/inject';
import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { setTrackInput } from '#/modules/Arrangement/useCases/setTrackInput';
import { removeTrack } from '#/modules/Arrangement/useCases/removeTrack';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';
import { renameTrack } from '#/modules/Arrangement/useCases/renameTrack';
import { muteTrack } from '#/modules/Arrangement/useCases/toggleTrackState/muteTrack';
import { soloTrack } from '#/modules/Arrangement/useCases/toggleTrackState/soloTrack';
import { clearSolos } from '#/modules/Arrangement/useCases/toggleTrackState/clearSolos';
import { selectTrack } from '#/modules/Arrangement/useCases/toggleTrackState/selectTrack';
import { reorderTrack } from '#/modules/Arrangement/useCases/toggleTrackState/reorderTrack';
import { hideTrack } from '#/modules/Arrangement/useCases/toggleTrackState/hideTrack';
import { disableTrack } from '#/modules/Arrangement/useCases/toggleTrackState/disableTrack';
import { setTrackHeight } from '#/modules/Arrangement/useCases/toggleTrackState/setTrackHeight';
import { setTrackOutput } from '#/modules/Arrangement/useCases/toggleTrackState/setTrackOutput';
import { setAutomationMode } from '#/modules/Arrangement/useCases/toggleTrackState/setAutomationMode';
import { foldTrack } from '#/modules/Arrangement/useCases/toggleTrackState/foldTrack';
import { groupTracks } from '#/modules/Arrangement/useCases/toggleTrackState/groupTracks';
import { ungroupTracks } from '#/modules/Arrangement/useCases/toggleTrackState/ungroupTracks';
import { toggleSoloSafe } from '#/modules/Arrangement/useCases/toggleTrackState/toggleSoloSafe';
import { armTrack } from '#/modules/Arrangement/useCases/recording';
import { freezeTrack, unfreezeTrack } from '#/modules/Arrangement/useCases/freezeBounce/freezeTrack';
import { bounceInPlace, bounceToNewTrack } from '#/modules/Arrangement/useCases/freezeBounce/bounceOperations';
import { duplicateTrack } from '#/modules/Arrangement/useCases/duplicateTrack';
import { createFolder } from '#/modules/Arrangement/useCases/folder';
import {
    setTrackGain,
    setTrackPan,
    setTrackColor,
    setTrackNotes,
} from '#/modules/Arrangement/useCases/setTrackGainPan';
import { zoomTracksVertical } from '#/modules/Arrangement/useCases/trackZoom';
import {
    setTrackGain as engineSetTrackGain,
    setTrackPan as engineSetTrackPan,
} from '#/modules/AudioEngine/useCases/trackAudioControls';
import { getTrackStoreState } from '#/modules/Arrangement/useCases/getTrackStoreState';

type ExtractAction<A extends AppAction, T extends string> = A extends { type: T } ? A : never;
type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const executeAddTrack = inject({ addTrack })(
    ({ addTrack }) =>
        function executeAddTrack(a: ExtractAction<AppAction, 'addTrack'>): void {
            addTrack(a.payload);
        }
);

export const executeRemoveTrack = inject({ removeTrack })(
    ({ removeTrack }) =>
        function executeRemoveTrack(a: ExtractAction<AppAction, 'removeTrack'>): void {
            removeTrack(a.payload.trackId);
        }
);

export const executeRemoveAllTracks = inject({ getTrackStoreState, removeTrack })(
    ({ getTrackStoreState, removeTrack }) =>
        function executeRemoveAllTracks(): void {
            const state = getTrackStoreState();
            if (state) {
                for (const t of state.tracks) {
                    removeTrack(t.id);
                }
            }
        }
);

export const executeRenameTrack = inject({ renameTrack })(
    ({ renameTrack }) =>
        function executeRenameTrack(a: ExtractAction<AppAction, 'renameTrack'>): void {
            renameTrack(a.payload.trackId, a.payload.name);
        }
);

export const executeSelectTrack = inject({ selectTrack })(
    ({ selectTrack }) =>
        function executeSelectTrack(a: ExtractAction<AppAction, 'selectTrack'>): void {
            selectTrack(a.payload.trackId);
        }
);

export const executeMuteTrack = inject({ muteTrack })(
    ({ muteTrack }) =>
        function executeMuteTrack(a: ExtractAction<AppAction, 'muteTrack'>): void {
            muteTrack(a.payload.trackId, a.payload.muted);
        }
);

export const executeSoloTrack = inject({ soloTrack })(
    ({ soloTrack }) =>
        function executeSoloTrack(a: ExtractAction<AppAction, 'soloTrack'>): void {
            soloTrack(a.payload.trackId, a.payload.soloed);
        }
);

export const executeArmTrack = inject({ armTrack })(
    ({ armTrack }) =>
        function executeArmTrack(a: ExtractAction<AppAction, 'armTrack'>): void {
            armTrack(a.payload.trackId, a.payload.armed);
        }
);

export const executeFreezeTrack = inject({ freezeTrack })(
    ({ freezeTrack }) =>
        async function executeFreezeTrack(a: ExtractAction<AppAction, 'freezeTrack'>): Promise<void> {
            await freezeTrack(a.payload.trackId);
        }
);

export const executeUnfreezeTrack = inject({ unfreezeTrack })(
    ({ unfreezeTrack }) =>
        function executeUnfreezeTrack(a: ExtractAction<AppAction, 'unfreezeTrack'>): void {
            unfreezeTrack(a.payload.trackId);
        }
);

export const executeBounceInPlace = inject({ bounceInPlace })(
    ({ bounceInPlace }) =>
        function executeBounceInPlace(a: ExtractAction<AppAction, 'bounceInPlace'>): void {
            bounceInPlace(a.payload.trackId);
        }
);

export const executeDuplicateTrack = inject({ duplicateTrack })(
    ({ duplicateTrack }) =>
        function executeDuplicateTrack(a: ExtractAction<AppAction, 'duplicateTrack'>): void {
            duplicateTrack(a.payload.trackId);
        }
);

export const executeReorderTrack = inject({ reorderTrack })(
    ({ reorderTrack }) =>
        function executeReorderTrack(a: ExtractAction<AppAction, 'reorderTrack'>): void {
            reorderTrack(a.payload.trackId, a.payload.newIndex);
        }
);

export const executeSetTrackGain = inject({ setTrackGain, engineSetTrackGain })(
    ({ setTrackGain, engineSetTrackGain }) =>
        function executeSetTrackGain(a: ExtractAction<AppAction, 'setTrackGain'>): void {
            setTrackGain(a.payload.trackId, a.payload.gain);
            engineSetTrackGain(a.payload.trackId, a.payload.gain);
        }
);

export const executeSetTrackPan = inject({ setTrackPan, engineSetTrackPan })(
    ({ setTrackPan, engineSetTrackPan }) =>
        function executeSetTrackPan(a: ExtractAction<AppAction, 'setTrackPan'>): void {
            setTrackPan(a.payload.trackId, a.payload.pan);
            engineSetTrackPan(a.payload.trackId, a.payload.pan);
        }
);

export const executeSetTrackColor = inject({ setTrackColor })(
    ({ setTrackColor }) =>
        function executeSetTrackColor(a: ExtractAction<AppAction, 'setTrackColor'>): void {
            setTrackColor(a.payload.trackId, a.payload.color);
        }
);

export const executeCreateBus = inject({ addTrack })(
    ({ addTrack }) =>
        function executeCreateBus(a: ExtractAction<AppAction, 'createBus'>): void {
            addTrack({ name: a.payload.name, kind: 'bus' });
        }
);

export const executeCreateFolder = inject({ createFolder })(
    ({ createFolder }) =>
        function executeCreateFolder(a: ExtractAction<AppAction, 'createFolder'>): void {
            createFolder(a.payload.name);
        }
);

export const executeHideTrack = inject({ hideTrack })(
    ({ hideTrack }) =>
        function executeHideTrack(a: ExtractAction<AppAction, 'hideTrack'>): void {
            hideTrack(a.payload.trackId, a.payload.hidden);
        }
);

export const executeDisableTrack = inject({ disableTrack })(
    ({ disableTrack }) =>
        function executeDisableTrack(a: ExtractAction<AppAction, 'disableTrack'>): void {
            disableTrack(a.payload.trackId, a.payload.disabled);
        }
);

export const executeSetTrackHeight = inject({ setTrackHeight })(
    ({ setTrackHeight }) =>
        function executeSetTrackHeight(a: ExtractAction<AppAction, 'setTrackHeight'>): void {
            setTrackHeight(a.payload.trackId, a.payload.height);
        }
);

export const executeSetTrackOutput = inject({ setTrackOutput })(
    ({ setTrackOutput }) =>
        function executeSetTrackOutput(a: ExtractAction<AppAction, 'setTrackOutput'>): void {
            setTrackOutput(a.payload.trackId, a.payload.outputId);
        }
);

export const executeSetAutomationMode = inject({ setAutomationMode })(
    ({ setAutomationMode }) =>
        function executeSetAutomationMode(a: ExtractAction<AppAction, 'setAutomationMode'>): void {
            setAutomationMode(a.payload.trackId, a.payload.mode);
        }
);

export const executeFoldTrack = inject({ foldTrack })(
    ({ foldTrack }) =>
        function executeFoldTrack(a: ExtractAction<AppAction, 'foldTrack'>): void {
            foldTrack(a.payload.trackId, a.payload.folded);
        }
);

export const executeGroupTracks = inject({ groupTracks })(
    ({ groupTracks }) =>
        function executeGroupTracks(a: ExtractAction<AppAction, 'groupTracks'>): void {
            groupTracks(a.payload.trackIds, a.payload.name);
        }
);

export const executeUngroupTracks = inject({ ungroupTracks })(
    ({ ungroupTracks }) =>
        function executeUngroupTracks(a: ExtractAction<AppAction, 'ungroupTracks'>): void {
            ungroupTracks(a.payload.groupId);
        }
);

export const executeToggleSoloSafe = inject({ toggleSoloSafe })(
    ({ toggleSoloSafe }) =>
        function executeToggleSoloSafe(a: ExtractAction<AppAction, 'toggleSoloSafe'>): void {
            toggleSoloSafe(a.payload.trackId);
        }
);

export const executeSetTrackNotes = inject({ setTrackNotes })(
    ({ setTrackNotes }) =>
        function executeSetTrackNotes(a: ExtractAction<AppAction, 'setTrackNotes'>): void {
            setTrackNotes(a.payload.trackId, a.payload.notes);
        }
);

export const executeSetTrackInput = inject({ setTrackInput })(
    ({ setTrackInput }) =>
        function executeSetTrackInput(a: ExtractAction<AppAction, 'setTrackInput'>): void {
            setTrackInput(a.payload.trackId, a.payload.inputId);
        }
);

export const executeClearSolos = inject({ clearSolos })(
    ({ clearSolos }) =>
        function executeClearSolos(): void {
            clearSolos();
        }
);

export const executeZoomTracksVertical = inject({ zoomTracksVertical })(
    ({ zoomTracksVertical }) =>
        function executeZoomTracksVertical(a: ExtractAction<AppAction, 'zoomTracksVertical'>): void {
            zoomTracksVertical(a.payload.delta);
        }
);

export const executeConsolidateAllTracks = inject({ getTrackStoreState, bounceInPlace })(
    ({ getTrackStoreState, bounceInPlace }) =>
        async function executeConsolidateAllTracks(): Promise<void> {
            const state = getTrackStoreState();
            if (!state) {
                return;
            }
            for (const track of state.tracks) {
                if ((track.kind === 'audio' || track.kind === 'midi') && track.clips.length > 0) {
                    await bounceInPlace(track.id);
                }
            }
        }
);

export const executeBounceToNewTrack = inject({ bounceToNewTrack })(
    ({ bounceToNewTrack }) =>
        async function executeBounceToNewTrack(a: ExtractAction<AppAction, 'bounceToNewTrack'>): Promise<void> {
            await bounceToNewTrack(a.payload.trackId);
        }
);

export const trackHandlers = {
    addTrack: {
        execute: executeAddTrack,
        describe: (a) => ({ label: `Add ${a.payload.kind} track "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'addTrack'>>,

    removeTrack: {
        execute: executeRemoveTrack,
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
    } satisfies ActionHandler<Extract<AppAction, 'removeTrack'>>,

    removeAllTracks: {
        execute: executeRemoveAllTracks,
        describe: () => ({ label: 'Remove all tracks' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'removeAllTracks'>>,

    renameTrack: {
        execute: executeRenameTrack,
        describe: (a) => ({ label: `Rename track to "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'renameTrack'>>,

    selectTrack: {
        execute: executeSelectTrack,
        describe: () => ({ label: 'Select track' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'selectTrack'>>,

    muteTrack: {
        execute: executeMuteTrack,
        describe: (a) => ({
            label: a.payload.muted ? 'Mute track' : 'Unmute track',
            inverseAction: { type: 'muteTrack', payload: { trackId: a.payload.trackId, muted: !a.payload.muted } },
        }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'muteTrack'>>,

    soloTrack: {
        execute: executeSoloTrack,
        describe: (a) => ({
            label: a.payload.soloed ? 'Solo track' : 'Unsolo track',
            inverseAction: { type: 'soloTrack', payload: { trackId: a.payload.trackId, soloed: !a.payload.soloed } },
        }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'soloTrack'>>,

    armTrack: {
        execute: executeArmTrack,
        describe: (a) => ({ label: a.payload.armed ? 'Arm track' : 'Disarm track' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'armTrack'>>,

    freezeTrack: {
        execute: executeFreezeTrack,
        describe: () => ({ label: 'Freeze track' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'freezeTrack'>>,

    unfreezeTrack: {
        execute: executeUnfreezeTrack,
        describe: () => ({ label: 'Unfreeze track' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'unfreezeTrack'>>,

    bounceInPlace: {
        execute: executeBounceInPlace,
        describe: () => ({ label: 'Bounce in place' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'bounceInPlace'>>,

    duplicateTrack: {
        execute: executeDuplicateTrack,
        describe: () => ({ label: 'Duplicate track' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'duplicateTrack'>>,

    reorderTrack: {
        execute: executeReorderTrack,
        describe: () => ({ label: 'Reorder track' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'reorderTrack'>>,

    setTrackGain: {
        execute: executeSetTrackGain,
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
        execute: executeSetTrackPan,
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
        execute: executeSetTrackColor,
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
        execute: executeCreateBus,
        describe: (a) => ({ label: `Create bus "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'createBus'>>,

    createFolder: {
        execute: executeCreateFolder,
        describe: (a) => ({ label: `Create folder "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'createFolder'>>,

    hideTrack: {
        execute: executeHideTrack,
        describe: (a) => ({ label: a.payload.hidden ? 'Hide track' : 'Show track' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'hideTrack'>>,

    disableTrack: {
        execute: executeDisableTrack,
        describe: (a) => ({ label: a.payload.disabled ? 'Disable track' : 'Enable track' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'disableTrack'>>,

    setTrackHeight: {
        execute: executeSetTrackHeight,
        describe: () => ({ label: 'Set track height' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setTrackHeight'>>,

    setTrackOutput: {
        execute: executeSetTrackOutput,
        describe: () => ({ label: 'Set track output' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setTrackOutput'>>,

    setAutomationMode: {
        execute: executeSetAutomationMode,
        describe: (a) => ({ label: `Set automation mode: ${a.payload.mode}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setAutomationMode'>>,

    foldTrack: {
        execute: executeFoldTrack,
        describe: (a) => ({ label: a.payload.folded ? 'Fold track' : 'Unfold track' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'foldTrack'>>,

    groupTracks: {
        execute: executeGroupTracks,
        describe: (a) => ({ label: `Group tracks: "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'groupTracks'>>,

    ungroupTracks: {
        execute: executeUngroupTracks,
        describe: () => ({ label: 'Ungroup tracks' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'ungroupTracks'>>,

    toggleSoloSafe: {
        execute: executeToggleSoloSafe,
        describe: () => ({ label: 'Toggle solo safe' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'toggleSoloSafe'>>,

    setTrackNotes: {
        execute: executeSetTrackNotes,
        describe: () => {
            return { label: 'Set track notes' };
        },
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setTrackNotes'>>,

    setTrackInput: {
        execute: executeSetTrackInput,
        describe: () => ({ label: 'Set track input' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setTrackInput'>>,

    clearSolos: {
        execute: executeClearSolos,
        describe: () => ({ label: 'Clear all solos' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'clearSolos'>>,

    zoomTracksVertical: {
        execute: executeZoomTracksVertical,
        describe: (a) => ({ label: `Zoom tracks vertical ${a.payload.delta > 0 ? 'in' : 'out'}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'zoomTracksVertical'>>,

    consolidateAllTracks: {
        execute: executeConsolidateAllTracks,
        describe: () => ({ label: 'Consolidate all tracks' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'consolidateAllTracks'>>,

    bounceToNewTrack: {
        execute: executeBounceToNewTrack,
        describe: () => ({ label: 'Bounce to new track' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'bounceToNewTrack'>>,
};
