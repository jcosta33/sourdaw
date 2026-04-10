import { inject } from '#/infra/di/inject';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import {
    addAutomationLane,
    addAutomationPoint,
    getAutomationStoreState,
    removeAutomationPoint,
} from '#/modules/Automation';
import {
    addMarker,
    addSection,
    importAudioFile,
    removeMarker,
    removeSection,
    renameSection,
    setMarkerColor,
    type VelocityCurve,
} from '#/modules/Arrangement';
import { type ActionHandler, type AppAction } from '#/modules/Command';
import {
    exportMidiClip,
    humanizeNotes,
    importMidiFile,
    invertNotes,
    quantizeNoteLengths,
    quantizeNotes,
    retrogradeNotes,
    scaleAllVelocities,
    scaleVelocities,
    setAllVelocities,
    transposeNotes,
} from '#/modules/MIDI';
import {
    exportProjectFile,
    newProject,
    pickFiles,
    saveProject,
} from '#/modules/Project';
import {
    type EditingTool,
    setEditingTool,
    setSnapValue,
    setWorkspaceMode,
    toggleChatPanel,
    toggleInspector,
    toggleMixer,
    toggleSidebar,
    zoomToFit,
    zoomToSelection,
} from '#/modules/Workspace';

type ExtractAction<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const executeSetWorkspaceMode = inject({ setWorkspaceMode })(
    ({ setWorkspaceMode }) =>
        function executeSetWorkspaceMode(a: ExtractAction<AppAction, 'setWorkspaceMode'>): void {
            setWorkspaceMode(a.payload.mode);
        }
);

export const executeOpenMixer = inject({ toggleMixer })(
    ({ toggleMixer }) =>
        function executeOpenMixer(): void {
            toggleMixer();
        }
);

export const executeCloseMixer = inject({ toggleMixer })(
    ({ toggleMixer }) =>
        function executeCloseMixer(): void {
            toggleMixer();
        }
);

export const executeToggleSidebar = inject({ toggleSidebar })(
    ({ toggleSidebar }) =>
        function executeToggleSidebar(): void {
            toggleSidebar();
        }
);

export const executeToggleInspector = inject({ toggleInspector })(
    ({ toggleInspector }) =>
        function executeToggleInspector(): void {
            toggleInspector();
        }
);

export const executeToggleChatPanel = inject({ toggleChatPanel })(
    ({ toggleChatPanel }) =>
        function executeToggleChatPanel(): void {
            toggleChatPanel();
        }
);

export const executeSetEditingTool = inject({ setEditingTool })(
    ({ setEditingTool }) =>
        function executeSetEditingTool(a: ExtractAction<AppAction, 'setEditingTool'>): void {
            setEditingTool(a.payload.tool as EditingTool);
        }
);

export const executeAddMarker = inject({ addMarker })(
    ({ addMarker }) =>
        function executeAddMarker(a: ExtractAction<AppAction, 'addMarker'>): void {
            addMarker(a.payload.beat, a.payload.name);
        }
);

export const executeRemoveMarker = inject({ removeMarker })(
    ({ removeMarker }) =>
        function executeRemoveMarker(a: ExtractAction<AppAction, 'removeMarker'>): void {
            removeMarker(a.payload.markerId);
        }
);

export const executeSetMarkerColor = inject({ setMarkerColor })(
    ({ setMarkerColor }) =>
        function executeSetMarkerColor(a: ExtractAction<AppAction, 'setMarkerColor'>): void {
            setMarkerColor(a.payload.markerId, a.payload.color);
        }
);

export const executeAddSection = inject({ addSection })(
    ({ addSection }) =>
        function executeAddSection(a: ExtractAction<AppAction, 'addSection'>): void {
            addSection(a.payload.startBeat, a.payload.endBeat, a.payload.name);
        }
);

export const executeRemoveSection = inject({ removeSection })(
    ({ removeSection }) =>
        function executeRemoveSection(a: ExtractAction<AppAction, 'removeSection'>): void {
            removeSection(a.payload.sectionId);
        }
);

export const executeRenameSection = inject({ renameSection })(
    ({ renameSection }) =>
        function executeRenameSection(a: ExtractAction<AppAction, 'renameSection'>): void {
            renameSection(a.payload.sectionId, a.payload.name);
        }
);

export const executeAddAutomationLane = inject({ addAutomationLane })(
    ({ addAutomationLane }) =>
        function executeAddAutomationLane(a: ExtractAction<AppAction, 'addAutomationLane'>): void {
            addAutomationLane(a.payload.trackId, a.payload.parameterId, a.payload.parameterName);
        }
);

export const executeAddAutomationPoint = inject({ addAutomationPoint })(
    ({ addAutomationPoint }) =>
        function executeAddAutomationPoint(a: ExtractAction<AppAction, 'addAutomationPoint'>): void {
            addAutomationPoint(a.payload.laneId, {
                beat: a.payload.beat,
                value: a.payload.value,
                curve: a.payload.curve ?? 'linear',
                tension: 0,
            });
        }
);

export const executeQuantizeNotes = inject({ quantizeNotes })(
    ({ quantizeNotes }) =>
        function executeQuantizeNotes(a: ExtractAction<AppAction, 'quantizeNotes'>): void {
            quantizeNotes(a.payload.clipId, a.payload.gridSize);
        }
);

export const executeTransposeNotes = inject({ transposeNotes })(
    ({ transposeNotes }) =>
        function executeTransposeNotes(a: ExtractAction<AppAction, 'transposeNotes'>): void {
            transposeNotes(a.payload.clipId, a.payload.semitones);
        }
);

export const executeHumanizeNotes = inject({ humanizeNotes })(
    ({ humanizeNotes }) =>
        function executeHumanizeNotes(a: ExtractAction<AppAction, 'humanizeNotes'>): void {
            humanizeNotes(a.payload.clipId, a.payload.amount);
        }
);

export const executeInvertNotes = inject({ invertNotes })(
    ({ invertNotes }) =>
        function executeInvertNotes(a: ExtractAction<AppAction, 'invertNotes'>): void {
            invertNotes(a.payload.clipId);
        }
);

export const executeRetrogradeNotes = inject({ retrogradeNotes })(
    ({ retrogradeNotes }) =>
        function executeRetrogradeNotes(a: ExtractAction<AppAction, 'retrogradeNotes'>): void {
            retrogradeNotes(a.payload.clipId);
        }
);

export const executeQuantizeNoteLengths = inject({ quantizeNoteLengths })(
    ({ quantizeNoteLengths }) =>
        function executeQuantizeNoteLengths(a: ExtractAction<AppAction, 'quantizeNoteLengths'>): void {
            quantizeNoteLengths(a.payload.clipId, a.payload.gridSize);
        }
);

export const executeScaleVelocities = inject({ scaleVelocities })(
    ({ scaleVelocities }) =>
        function executeScaleVelocities(a: ExtractAction<AppAction, 'scaleVelocities'>): void {
            scaleVelocities(
                a.payload.clipId,
                a.payload.curve as VelocityCurve,
                a.payload.minVelocity,
                a.payload.maxVelocity
            );
        }
);

export const executeScaleAllVelocities = inject({ scaleAllVelocities })(
    ({ scaleAllVelocities }) =>
        function executeScaleAllVelocities(a: ExtractAction<AppAction, 'scaleAllVelocities'>): void {
            scaleAllVelocities(a.payload.clipId, a.payload.factor);
        }
);

export const executeSetAllVelocities = inject({ setAllVelocities })(
    ({ setAllVelocities }) =>
        function executeSetAllVelocities(a: ExtractAction<AppAction, 'setAllVelocities'>): void {
            setAllVelocities(a.payload.clipId, a.payload.velocity);
        }
);

export const executeImportMidiFile = inject({ pickFiles, importMidiFile, notifyUser })(
    ({ pickFiles, importMidiFile, notifyUser }) =>
        function executeImportMidiFile(): void {
            pickFiles({ filters: [{ name: 'MIDI', extensions: ['mid', 'midi'] }] })
                .then((files) => {
                    if (files) {
                        for (const file of files) {
                            importMidiFile(file);
                        }
                    }
                })
                .catch(() => {
                    notifyUser('Failed to open file dialog', 'error');
                });
        }
);

export const executeRemoveAutomationPoint = inject({ getAutomationStoreState, removeAutomationPoint })(
    ({ getAutomationStoreState, removeAutomationPoint }) =>
        function executeRemoveAutomationPoint(a: ExtractAction<AppAction, 'removeAutomationPoint'>): void {
            const state = getAutomationStoreState();
            if (!state) {
                return;
            }
            const lane = state.lanes.find((l) => l.id === a.payload.laneId);
            if (!lane || a.payload.pointIndex < 0 || a.payload.pointIndex >= lane.points.length) {
                return;
            }
            const point = lane.points[a.payload.pointIndex];
            if (point) {
                removeAutomationPoint(a.payload.laneId, point.beat);
            }
        }
);

export const executeSetSnapValue = inject({ setSnapValue })(
    ({ setSnapValue }) =>
        function executeSetSnapValue(a: ExtractAction<AppAction, 'setSnapValue'>): void {
            setSnapValue(a.payload.value);
        }
);

export const executeZoomToFit = inject({ zoomToFit })(
    ({ zoomToFit }) =>
        function executeZoomToFit(): void {
            zoomToFit();
        }
);

export const executeZoomToSelection = inject({ zoomToSelection })(
    ({ zoomToSelection }) =>
        function executeZoomToSelection(): void {
            zoomToSelection();
        }
);

export const executeExportProject = inject({ exportProjectFile })(
    ({ exportProjectFile }) =>
        function executeExportProject(): void {
            exportProjectFile();
        }
);

export const executeSaveProject = inject({ saveProject })(
    ({ saveProject }) =>
        function executeSaveProject(): void {
            saveProject();
        }
);

export const executeNewProject = inject({ newProject })(
    ({ newProject }) =>
        function executeNewProject(): void {
            newProject();
        }
);

export const executeImportAudioFile = inject({ pickFiles, importAudioFile, notifyUser })(
    ({ pickFiles, importAudioFile, notifyUser }) =>
        function executeImportAudioFile(): void {
            pickFiles({ filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'aiff', 'aac'] }] })
                .then((files) => {
                    if (files) {
                        for (const file of files) {
                            importAudioFile(file);
                        }
                    }
                })
                .catch(() => {
                    notifyUser('Failed to open file dialog', 'error');
                });
        }
);

export const executeExportMidi = inject({ exportMidiClip })(
    ({ exportMidiClip }) =>
        function executeExportMidi(a: ExtractAction<AppAction, 'exportMidi'>): void {
            exportMidiClip(a.payload.clipId);
        }
);

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const workspaceHandlers = {
    setWorkspaceMode: {
        execute: executeSetWorkspaceMode,
        describe: () => ({ label: 'Switch view' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'setWorkspaceMode'>>,

    openMixer: {
        execute: executeOpenMixer,
        describe: () => ({ label: 'Open mixer' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'openMixer'>>,

    closeMixer: {
        execute: executeCloseMixer,
        describe: () => ({ label: 'Close mixer' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'closeMixer'>>,

    toggleSidebar: {
        execute: executeToggleSidebar,
        describe: () => ({ label: 'Toggle sidebar' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'toggleSidebar'>>,

    toggleInspector: {
        execute: executeToggleInspector,
        describe: () => ({ label: 'Toggle inspector' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'toggleInspector'>>,

    toggleChatPanel: {
        execute: executeToggleChatPanel,
        describe: () => ({ label: 'Toggle chat panel' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'toggleChatPanel'>>,

    setEditingTool: {
        execute: executeSetEditingTool,
        describe: (a) => ({ label: `Set tool: ${a.payload.tool}` }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'setEditingTool'>>,

    addMarker: {
        execute: executeAddMarker,
        describe: (a) => ({ label: `Add marker "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'addMarker'>>,

    removeMarker: {
        execute: executeRemoveMarker,
        describe: () => ({ label: 'Remove marker' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'removeMarker'>>,

    setMarkerColor: {
        execute: executeSetMarkerColor,
        describe: () => ({ label: 'Set marker color' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setMarkerColor'>>,

    addSection: {
        execute: executeAddSection,
        describe: (a) => ({ label: `Add section "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'addSection'>>,

    removeSection: {
        execute: executeRemoveSection,
        describe: () => ({ label: 'Remove section' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'removeSection'>>,

    renameSection: {
        execute: executeRenameSection,
        describe: (a) => ({ label: `Rename section to "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'renameSection'>>,

    addAutomationLane: {
        execute: executeAddAutomationLane,
        describe: (a) => ({ label: `Add automation: ${a.payload.parameterName}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'addAutomationLane'>>,

    addAutomationPoint: {
        execute: executeAddAutomationPoint,
        describe: () => ({ label: 'Add automation point' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'addAutomationPoint'>>,

    quantizeNotes: {
        execute: executeQuantizeNotes,
        describe: () => ({ label: 'Quantize notes' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'quantizeNotes'>>,

    transposeNotes: {
        execute: executeTransposeNotes,
        describe: (a) => ({ label: `Transpose ${a.payload.semitones > 0 ? '+' : ''}${a.payload.semitones} semitones` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'transposeNotes'>>,

    humanizeNotes: {
        execute: executeHumanizeNotes,
        describe: () => ({ label: 'Humanize notes' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'humanizeNotes'>>,

    invertNotes: {
        execute: executeInvertNotes,
        describe: () => ({ label: 'Invert notes' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'invertNotes'>>,

    retrogradeNotes: {
        execute: executeRetrogradeNotes,
        describe: () => ({ label: 'Retrograde notes' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'retrogradeNotes'>>,

    quantizeNoteLengths: {
        execute: executeQuantizeNoteLengths,
        describe: () => ({ label: 'Quantize note lengths' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'quantizeNoteLengths'>>,

    scaleVelocities: {
        execute: executeScaleVelocities,
        describe: (a) => ({ label: `Scale velocities (${a.payload.curve})` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'scaleVelocities'>>,

    scaleAllVelocities: {
        execute: executeScaleAllVelocities,
        describe: (a) => ({ label: `Scale velocities ×${a.payload.factor}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'scaleAllVelocities'>>,

    setAllVelocities: {
        execute: executeSetAllVelocities,
        describe: (a) => ({ label: `Set all velocities to ${a.payload.velocity}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setAllVelocities'>>,

    importMidiFile: {
        execute: executeImportMidiFile,
        describe: () => ({ label: 'Import MIDI file' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'importMidiFile'>>,

    removeAutomationPoint: {
        execute: executeRemoveAutomationPoint,
        describe: () => ({ label: 'Remove automation point' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'removeAutomationPoint'>>,

    setSnapValue: {
        execute: executeSetSnapValue,
        describe: (a) => ({ label: `Set snap to ${a.payload.value}` }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'setSnapValue'>>,

    zoomToFit: {
        execute: executeZoomToFit,
        describe: () => ({ label: 'Zoom to fit' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'zoomToFit'>>,

    zoomToSelection: {
        execute: executeZoomToSelection,
        describe: () => ({ label: 'Zoom to selection' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'zoomToSelection'>>,

    exportProject: {
        execute: executeExportProject,
        describe: () => ({ label: 'Export project file' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'exportProject'>>,

    saveProject: {
        execute: executeSaveProject,
        describe: () => ({ label: 'Save project' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'saveProject'>>,

    newProject: {
        execute: executeNewProject,
        describe: () => ({ label: 'New project' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'newProject'>>,

    importAudioFile: {
        execute: executeImportAudioFile,
        describe: () => ({ label: 'Import audio file' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'importAudioFile'>>,

    exportMidi: {
        execute: executeExportMidi,
        describe: () => ({ label: 'Export MIDI' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'exportMidi'>>,
};
