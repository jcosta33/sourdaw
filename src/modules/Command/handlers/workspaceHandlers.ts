import { type ActionHandler } from '../models/ActionHandler';
import { type AppAction } from '../models/AppAction';
import { setWorkspaceMode } from '#/modules/Workspace/useCases/setWorkspaceMode';
import {
    toggleMixer,
    toggleSidebar,
    toggleInspector,
    toggleChatPanel,
    setSnapValue,
    zoomToFit,
    zoomToSelection,
} from '#/modules/Workspace/useCases/togglePanel';
import { setEditingTool } from '#/modules/Workspace/useCases/setEditingTool';
import {
    addMarker,
    removeMarker,
    setMarkerColor,
    addSection,
    removeSection,
    renameSection,
} from '#/modules/Timeline/useCases/markerUseCases';
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
    type VelocityCurve,
} from '#/modules/Midi/useCases/midiUseCases';
import {
    addAutomationLane,
    addAutomationPoint,
    removeAutomationPoint,
} from '#/modules/Automation/useCases/automationUseCases';
import { getAutomationStoreState } from '#/modules/Track/useCases/trackQueries';
import { saveProject, newProject, exportProjectFile } from '#/modules/Project/useCases/projectPersistence';
import { exportMidiClip } from '#/modules/Midi/useCases/exportMidiFile';
import { pickFiles } from '#/modules/Project/useCases/nativeFileDialog';
import { importMidiFile } from '#/modules/Midi/useCases/importMidiFile';
import { importAudioFile } from '#/modules/Track/useCases/importAudioFile';
import { type EditingTool } from '#/modules/Workspace/models/EditingTool';

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const workspaceHandlers = {
    setWorkspaceMode: {
        execute: (a) => {
            setWorkspaceMode(a.payload.mode);
        },
        describe: () => ({ label: 'Switch view' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'setWorkspaceMode'>>,

    openMixer: {
        execute: () => {
            toggleMixer();
        },
        describe: () => ({ label: 'Open mixer' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'openMixer'>>,

    closeMixer: {
        execute: () => {
            toggleMixer();
        },
        describe: () => ({ label: 'Close mixer' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'closeMixer'>>,

    toggleSidebar: {
        execute: () => {
            toggleSidebar();
        },
        describe: () => ({ label: 'Toggle sidebar' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'toggleSidebar'>>,

    toggleInspector: {
        execute: () => {
            toggleInspector();
        },
        describe: () => ({ label: 'Toggle inspector' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'toggleInspector'>>,

    toggleChatPanel: {
        execute: () => {
            toggleChatPanel();
        },
        describe: () => ({ label: 'Toggle chat panel' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'toggleChatPanel'>>,

    setEditingTool: {
        execute: (a) => {
            setEditingTool(a.payload.tool as EditingTool);
        },
        describe: (a) => ({ label: `Set tool: ${a.payload.tool}` }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'setEditingTool'>>,

    addMarker: {
        execute: (a) => {
            addMarker(a.payload.beat, a.payload.name);
        },
        describe: (a) => ({ label: `Add marker "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'addMarker'>>,

    removeMarker: {
        execute: (a) => {
            removeMarker(a.payload.markerId);
        },
        describe: () => ({ label: 'Remove marker' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'removeMarker'>>,

    setMarkerColor: {
        execute: (a) => {
            setMarkerColor(a.payload.markerId, a.payload.color);
        },
        describe: () => ({ label: 'Set marker color' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setMarkerColor'>>,

    addSection: {
        execute: (a) => {
            addSection(a.payload.startBeat, a.payload.endBeat, a.payload.name);
        },
        describe: (a) => ({ label: `Add section "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'addSection'>>,

    removeSection: {
        execute: (a) => {
            removeSection(a.payload.sectionId);
        },
        describe: () => ({ label: 'Remove section' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'removeSection'>>,

    renameSection: {
        execute: (a) => {
            renameSection(a.payload.sectionId, a.payload.name);
        },
        describe: (a) => ({ label: `Rename section to "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'renameSection'>>,

    addAutomationLane: {
        execute: (a) => {
            addAutomationLane(a.payload.trackId, a.payload.parameterId, a.payload.parameterName);
        },
        describe: (a) => ({ label: `Add automation: ${a.payload.parameterName}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'addAutomationLane'>>,

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
    } satisfies ActionHandler<Extract<AppAction, 'addAutomationPoint'>>,

    quantizeNotes: {
        execute: (a) => {
            quantizeNotes(a.payload.clipId, a.payload.gridSize);
        },
        describe: () => ({ label: 'Quantize notes' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'quantizeNotes'>>,

    transposeNotes: {
        execute: (a) => {
            transposeNotes(a.payload.clipId, a.payload.semitones);
        },
        describe: (a) => ({ label: `Transpose ${a.payload.semitones > 0 ? '+' : ''}${a.payload.semitones} semitones` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'transposeNotes'>>,

    humanizeNotes: {
        execute: (a) => {
            humanizeNotes(a.payload.clipId, a.payload.amount);
        },
        describe: () => ({ label: 'Humanize notes' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'humanizeNotes'>>,

    invertNotes: {
        execute: (a) => {
            invertNotes(a.payload.clipId);
        },
        describe: () => ({ label: 'Invert notes' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'invertNotes'>>,

    retrogradeNotes: {
        execute: (a) => {
            retrogradeNotes(a.payload.clipId);
        },
        describe: () => ({ label: 'Retrograde notes' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'retrogradeNotes'>>,

    quantizeNoteLengths: {
        execute: (a) => {
            quantizeNoteLengths(a.payload.clipId, a.payload.gridSize);
        },
        describe: () => ({ label: 'Quantize note lengths' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'quantizeNoteLengths'>>,

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
    } satisfies ActionHandler<Extract<AppAction, 'scaleVelocities'>>,

    scaleAllVelocities: {
        execute: (a) => {
            scaleAllVelocities(a.payload.clipId, a.payload.factor);
        },
        describe: (a) => ({ label: `Scale velocities ×${a.payload.factor}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'scaleAllVelocities'>>,

    setAllVelocities: {
        execute: (a) => {
            setAllVelocities(a.payload.clipId, a.payload.velocity);
        },
        describe: (a) => ({ label: `Set all velocities to ${a.payload.velocity}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setAllVelocities'>>,

    importMidiFile: {
        execute: () => {
            void pickFiles({ filters: [{ name: 'MIDI', extensions: ['mid', 'midi'] }] })
                .then((files) => {
                    if (files) {
                        for (const file of files) {
                            void importMidiFile(file);
                        }
                    }
                })
                .catch(() => {
                    document.dispatchEvent(
                        new CustomEvent('webdaw:notify', {
                            detail: { message: 'Failed to open file dialog', level: 'error' },
                        })
                    );
                });
        },
        describe: () => ({ label: 'Import MIDI file' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'importMidiFile'>>,

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
    } satisfies ActionHandler<Extract<AppAction, 'removeAutomationPoint'>>,

    setSnapValue: {
        execute: (a) => {
            setSnapValue(a.payload.value);
        },
        describe: (a) => ({ label: `Set snap to ${a.payload.value}` }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'setSnapValue'>>,

    zoomToFit: {
        execute: () => {
            zoomToFit();
        },
        describe: () => ({ label: 'Zoom to fit' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'zoomToFit'>>,

    zoomToSelection: {
        execute: () => {
            zoomToSelection();
        },
        describe: () => ({ label: 'Zoom to selection' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'zoomToSelection'>>,

    exportProject: {
        execute: () => {
            exportProjectFile();
        },
        describe: () => ({ label: 'Export project file' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'exportProject'>>,

    saveProject: {
        execute: () => {
            saveProject();
        },
        describe: () => ({ label: 'Save project' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'saveProject'>>,

    newProject: {
        execute: () => {
            newProject();
        },
        describe: () => ({ label: 'New project' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'newProject'>>,

    importAudioFile: {
        execute: () => {
            void pickFiles({ filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'aiff', 'aac'] }] })
                .then((files) => {
                    if (files) {
                        for (const file of files) {
                            void importAudioFile(file);
                        }
                    }
                })
                .catch(() => {
                    document.dispatchEvent(
                        new CustomEvent('webdaw:notify', {
                            detail: { message: 'Failed to open file dialog', level: 'error' },
                        })
                    );
                });
        },
        describe: () => ({ label: 'Import audio file' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'importAudioFile'>>,

    exportMidi: {
        execute: (a) => {
            exportMidiClip(a.payload.clipId);
        },
        describe: () => ({ label: 'Export MIDI' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'exportMidi'>>,
};
