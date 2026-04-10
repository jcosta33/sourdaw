import { notifyUser } from '#/helpers/Notification/notifyUser';
import { setWorkspaceMode } from './setWorkspaceMode';
import {
    toggleMixer,
    toggleSidebar,
    toggleInspector,
    toggleChatPanel,
    setSnapValue,
} from './togglePanel/panelToggles';
import { zoomToFit, zoomToSelection } from './togglePanel/zoomOperations';
import { setEditingTool } from './setEditingTool';
import {
    addMarker,
    removeMarker,
    setMarkerColor,
    addSection,
    removeSection,
    renameSection,
    importAudioFile,
} from '#/modules/Arrangement';
import {
    quantizeNotes,
    quantizeNoteLengths,
    transposeNotes,
    humanizeNotes,
    invertNotes,
    retrogradeNotes,
    scaleVelocities,
    scaleAllVelocities,
    setAllVelocities,
    exportMidiClip,
    importMidiFile,
} from '#/modules/MIDI';
import {
    addAutomationLane,
    addAutomationPoint,
    removeAutomationPoint,
    getAutomationStoreState,
} from '#/modules/Automation';
import {
    saveProject,
    newProject,
    exportProjectFile,
    pickFiles,
} from '#/modules/Project';
import { type EditingTool } from './workspaceQueries';

type WorkspaceActionResult = {
    label: string;
    inverseAction?: unknown | null;
};

type WorkspaceHandler<Action> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => WorkspaceActionResult;
    undoable: boolean;
};

type VelocityCurve = 'linear' | 'exponential' | 'logarithmic' | 's-curve' | 'compress' | 'expand';

type WorkspaceAction =
    | { type: 'setWorkspaceMode'; payload: { mode: 'arrange' | 'clip' } }
    | { type: 'openMixer'; payload?: undefined }
    | { type: 'closeMixer'; payload?: undefined }
    | { type: 'toggleSidebar'; payload?: undefined }
    | { type: 'toggleInspector'; payload?: undefined }
    | { type: 'toggleChatPanel'; payload?: undefined }
    | { type: 'setEditingTool'; payload: { tool: string } }
    | { type: 'addMarker'; payload: { beat: number; name: string } }
    | { type: 'removeMarker'; payload: { markerId: string } }
    | { type: 'setMarkerColor'; payload: { markerId: string; color: string } }
    | { type: 'addSection'; payload: { startBeat: number; endBeat: number; name: string } }
    | { type: 'removeSection'; payload: { sectionId: string } }
    | { type: 'renameSection'; payload: { sectionId: string; name: string } }
    | { type: 'addAutomationLane'; payload: { trackId: string; parameterId: string; parameterName: string } }
    | {
          type: 'addAutomationPoint';
          payload: { laneId: string; beat: number; value: number; curve?: 'linear' | 'step' | 'exponential' };
      }
    | { type: 'quantizeNotes'; payload: { clipId: string; gridSize: number } }
    | { type: 'transposeNotes'; payload: { clipId: string; semitones: number } }
    | { type: 'humanizeNotes'; payload: { clipId: string; amount: number } }
    | { type: 'invertNotes'; payload: { clipId: string } }
    | { type: 'retrogradeNotes'; payload: { clipId: string } }
    | { type: 'quantizeNoteLengths'; payload: { clipId: string; gridSize: number } }
    | {
          type: 'scaleVelocities';
          payload: { clipId: string; curve: VelocityCurve; minVelocity?: number; maxVelocity?: number };
      }
    | { type: 'scaleAllVelocities'; payload: { clipId: string; factor: number } }
    | { type: 'setAllVelocities'; payload: { clipId: string; velocity: number } }
    | { type: 'importMidiFile'; payload?: undefined }
    | { type: 'removeAutomationPoint'; payload: { laneId: string; pointIndex: number } }
    | { type: 'setSnapValue'; payload: { value: number } }
    | { type: 'zoomToFit'; payload?: undefined }
    | { type: 'zoomToSelection'; payload?: undefined }
    | { type: 'exportProject'; payload?: undefined }
    | { type: 'saveProject'; payload?: undefined }
    | { type: 'newProject'; payload?: undefined }
    | { type: 'importAudioFile'; payload?: undefined }
    | { type: 'exportMidi'; payload: { clipId: string } };

type WorkspaceActionOf<ActionType extends WorkspaceAction['type']> = Extract<WorkspaceAction, { type: ActionType }>;

export const workspaceHandlers = {
    setWorkspaceMode: {
        execute: (a) => {
            setWorkspaceMode(a.payload.mode);
        },
        describe: () => ({ label: 'Switch view' }),
        undoable: false,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'setWorkspaceMode'>>,

    openMixer: {
        execute: () => {
            toggleMixer();
        },
        describe: () => ({ label: 'Open mixer' }),
        undoable: false,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'openMixer'>>,

    closeMixer: {
        execute: () => {
            toggleMixer();
        },
        describe: () => ({ label: 'Close mixer' }),
        undoable: false,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'closeMixer'>>,

    toggleSidebar: {
        execute: () => {
            toggleSidebar();
        },
        describe: () => ({ label: 'Toggle sidebar' }),
        undoable: false,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'toggleSidebar'>>,

    toggleInspector: {
        execute: () => {
            toggleInspector();
        },
        describe: () => ({ label: 'Toggle inspector' }),
        undoable: false,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'toggleInspector'>>,

    toggleChatPanel: {
        execute: () => {
            toggleChatPanel();
        },
        describe: () => ({ label: 'Toggle chat panel' }),
        undoable: false,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'toggleChatPanel'>>,

    setEditingTool: {
        execute: (a) => {
            setEditingTool(a.payload.tool as EditingTool);
        },
        describe: (a) => ({ label: `Set tool: ${a.payload.tool}` }),
        undoable: false,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'setEditingTool'>>,

    addMarker: {
        execute: (a) => {
            addMarker(a.payload.beat, a.payload.name);
        },
        describe: (a) => ({ label: `Add marker "${a.payload.name}"` }),
        undoable: true,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'addMarker'>>,

    removeMarker: {
        execute: (a) => {
            removeMarker(a.payload.markerId);
        },
        describe: () => ({ label: 'Remove marker' }),
        undoable: true,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'removeMarker'>>,

    setMarkerColor: {
        execute: (a) => {
            setMarkerColor(a.payload.markerId, a.payload.color);
        },
        describe: () => ({ label: 'Set marker color' }),
        undoable: true,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'setMarkerColor'>>,

    addSection: {
        execute: (a) => {
            addSection(a.payload.startBeat, a.payload.endBeat, a.payload.name);
        },
        describe: (a) => ({ label: `Add section "${a.payload.name}"` }),
        undoable: true,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'addSection'>>,

    removeSection: {
        execute: (a) => {
            removeSection(a.payload.sectionId);
        },
        describe: () => ({ label: 'Remove section' }),
        undoable: true,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'removeSection'>>,

    renameSection: {
        execute: (a) => {
            renameSection(a.payload.sectionId, a.payload.name);
        },
        describe: (a) => ({ label: `Rename section to "${a.payload.name}"` }),
        undoable: true,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'renameSection'>>,

    addAutomationLane: {
        execute: (a) => {
            addAutomationLane(a.payload.trackId, a.payload.parameterId, a.payload.parameterName);
        },
        describe: (a) => ({ label: `Add automation: ${a.payload.parameterName}` }),
        undoable: true,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'addAutomationLane'>>,

    addAutomationPoint: {
        execute: (a) => {
            addAutomationPoint(a.payload.laneId, {
                beat: a.payload.beat,
                value: a.payload.value,
                curve: a.payload.curve ?? 'linear',
                tension: 0,
            });
        },
        describe: () => ({ label: 'Add automation point' }),
        undoable: true,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'addAutomationPoint'>>,

    quantizeNotes: {
        execute: (a) => {
            quantizeNotes(a.payload.clipId, a.payload.gridSize);
        },
        describe: () => ({ label: 'Quantize notes' }),
        undoable: true,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'quantizeNotes'>>,

    transposeNotes: {
        execute: (a) => {
            transposeNotes(a.payload.clipId, a.payload.semitones);
        },
        describe: (a) => ({ label: `Transpose ${a.payload.semitones > 0 ? '+' : ''}${a.payload.semitones} semitones` }),
        undoable: true,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'transposeNotes'>>,

    humanizeNotes: {
        execute: (a) => {
            humanizeNotes(a.payload.clipId, a.payload.amount);
        },
        describe: () => ({ label: 'Humanize notes' }),
        undoable: true,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'humanizeNotes'>>,

    invertNotes: {
        execute: (a) => {
            invertNotes(a.payload.clipId);
        },
        describe: () => ({ label: 'Invert notes' }),
        undoable: true,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'invertNotes'>>,

    retrogradeNotes: {
        execute: (a) => {
            retrogradeNotes(a.payload.clipId);
        },
        describe: () => ({ label: 'Retrograde notes' }),
        undoable: true,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'retrogradeNotes'>>,

    quantizeNoteLengths: {
        execute: (a) => {
            quantizeNoteLengths(a.payload.clipId, a.payload.gridSize);
        },
        describe: () => ({ label: 'Quantize note lengths' }),
        undoable: true,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'quantizeNoteLengths'>>,

    scaleVelocities: {
        execute: (a) => {
            scaleVelocities(
                a.payload.clipId,
                a.payload.curve as VelocityCurve,
                a.payload.minVelocity,
                a.payload.maxVelocity
            );
        },
        describe: (a) => ({ label: `Scale velocities (${a.payload.curve})` }),
        undoable: true,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'scaleVelocities'>>,

    scaleAllVelocities: {
        execute: (a) => {
            scaleAllVelocities(a.payload.clipId, a.payload.factor);
        },
        describe: (a) => ({ label: `Scale velocities ×${a.payload.factor}` }),
        undoable: true,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'scaleAllVelocities'>>,

    setAllVelocities: {
        execute: (a) => {
            setAllVelocities(a.payload.clipId, a.payload.velocity);
        },
        describe: (a) => ({ label: `Set all velocities to ${a.payload.velocity}` }),
        undoable: true,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'setAllVelocities'>>,

    importMidiFile: {
        execute: () => {
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
        },
        describe: () => ({ label: 'Import MIDI file' }),
        undoable: false,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'importMidiFile'>>,

    removeAutomationPoint: {
        execute: (a) => {
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
        },
        describe: () => ({ label: 'Remove automation point' }),
        undoable: true,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'removeAutomationPoint'>>,

    setSnapValue: {
        execute: (a) => {
            setSnapValue(a.payload.value);
        },
        describe: (a) => ({ label: `Set snap to ${a.payload.value}` }),
        undoable: false,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'setSnapValue'>>,

    zoomToFit: {
        execute: () => {
            zoomToFit();
        },
        describe: () => ({ label: 'Zoom to fit' }),
        undoable: false,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'zoomToFit'>>,

    zoomToSelection: {
        execute: () => {
            zoomToSelection();
        },
        describe: () => ({ label: 'Zoom to selection' }),
        undoable: false,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'zoomToSelection'>>,

    exportProject: {
        execute: () => {
            exportProjectFile();
        },
        describe: () => ({ label: 'Export project file' }),
        undoable: false,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'exportProject'>>,

    saveProject: {
        execute: () => {
            saveProject();
        },
        describe: () => ({ label: 'Save project' }),
        undoable: false,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'saveProject'>>,

    newProject: {
        execute: () => {
            newProject();
        },
        describe: () => ({ label: 'New project' }),
        undoable: false,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'newProject'>>,

    importAudioFile: {
        execute: () => {
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
        },
        describe: () => ({ label: 'Import audio file' }),
        undoable: false,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'importAudioFile'>>,

    exportMidi: {
        execute: (a) => {
            exportMidiClip(a.payload.clipId);
        },
        describe: () => ({ label: 'Export MIDI' }),
        undoable: false,
    } satisfies WorkspaceHandler<WorkspaceActionOf<'exportMidi'>>,
};
