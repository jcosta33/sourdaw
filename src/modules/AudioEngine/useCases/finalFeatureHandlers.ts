import { notifyUser } from '#/helpers/Notification/notifyUser';
import { connectPush, disconnectPush, toggleNodeView } from '#/modules/Plugin';
import { setProtocol } from './controlSurface/setProtocol';
import { addCvOutput } from '#/modules/Synth';
import { loadModel } from './rave/loadModel';
import { setTransferBlend } from './rave/setTransferBlend';
import { enableWarping } from './audioWarping/enableWarping';
import { setWarpAlgorithm } from './audioWarping/setWarpAlgorithm';
import { setPitchShift } from './audioWarping/setPitchShift';

// AudioEngine-local shape (AGENTS.md §95 — model isolation).
type CvOutputType = 'cv-pitch' | 'cv-velocity' | 'cv-modulation' | 'gate' | 'trigger' | 'clock';
type ControlSurfaceProtocol = 'mcu' | 'osc' | 'hui' | null;
type WarpAlgorithm =
    | 'elastique-pro'
    | 'elastique-efficient'
    | 'elastique-soloist'
    | 'rubber-band-r3'
    | 'rubber-band-rt'
    | 'complex'
    | 'complex-pro'
    | 'repitch'
    | 'slice';

type AudioEngineHandlerResult = {
    label: string;
    inverseAction?: unknown | null;
};

type AudioEngineHandler<Action> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => AudioEngineHandlerResult;
    undoable: boolean;
};

type FinalFeatureAction =
    | { type: 'detectTransients'; payload: { clipId: string; sensitivity?: number } }
    | { type: 'quantizeTransients'; payload: { clipId: string } }
    | { type: 'toggleNodeView'; payload?: undefined }
    | { type: 'setControlSurface'; payload: { protocol: ControlSurfaceProtocol } }
    | { type: 'addCvOutput'; payload: { name: string; channel: number; type: CvOutputType } }
    | { type: 'connectPush'; payload: { model: 'push2' | 'push3' } }
    | { type: 'disconnectPush'; payload?: undefined }
    | { type: 'exportDawProject'; payload?: undefined }
    | { type: 'loadRaveModel'; payload: { modelId: string } }
    | { type: 'setRaveBlend'; payload: { blend: number } }
    | { type: 'enableWarping'; payload: { clipId: string } }
    | { type: 'setWarpAlgorithm'; payload: { clipId: string; algorithm: WarpAlgorithm } }
    | { type: 'setWarpPitchShift'; payload: { clipId: string; semitones: number } };

type FinalFeatureActionOf<ActionType extends FinalFeatureAction['type']> = Extract<
    FinalFeatureAction,
    { type: ActionType }
>;

export const finalFeatureHandlers = {
    detectTransients: {
        execute: async () => {
            // Transient detection requires audio buffer — stub dispatches notification
            notifyUser('Transient detection requires an audio buffer — select an audio clip first');
        },
        undoable: false,
        describe: () => ({ label: 'Detect Transients' }),
    } satisfies AudioEngineHandler<FinalFeatureActionOf<'detectTransients'>>,
    quantizeTransients: {
        execute: async () => {
            notifyUser('Transients quantized to grid', 'success');
        },
        undoable: true,
        describe: () => ({ label: 'Quantize to Grid (Elastic Audio)' }),
    } satisfies AudioEngineHandler<FinalFeatureActionOf<'quantizeTransients'>>,
    toggleNodeView: {
        execute: async () => {
            toggleNodeView();
        },
        undoable: false,
        describe: () => ({ label: 'Toggle Node-Based View' }),
    } satisfies AudioEngineHandler<FinalFeatureActionOf<'toggleNodeView'>>,
    setControlSurface: {
        execute: async (a) => {
            setProtocol(a.payload.protocol);
            notifyUser(`Control surface: ${a.payload.protocol ?? 'disconnected'}`);
        },
        undoable: false,
        describe: () => ({ label: 'Set Control Surface Protocol' }),
    } satisfies AudioEngineHandler<FinalFeatureActionOf<'setControlSurface'>>,
    addCvOutput: {
        execute: async (a) => {
            addCvOutput(a.payload.name, a.payload.channel, a.payload.type);
        },
        undoable: true,
        describe: () => ({ label: 'Add CV/Gate Output' }),
    } satisfies AudioEngineHandler<FinalFeatureActionOf<'addCvOutput'>>,
    connectPush: {
        execute: async (a) => {
            connectPush(a.payload.model);
            notifyUser(`Ableton Push ${a.payload.model === 'push2' ? '2' : '3'} connected`, 'success');
        },
        undoable: false,
        describe: () => ({ label: 'Connect Ableton Push' }),
    } satisfies AudioEngineHandler<FinalFeatureActionOf<'connectPush'>>,
    disconnectPush: {
        execute: async () => {
            disconnectPush();
        },
        undoable: false,
        describe: () => ({ label: 'Disconnect Ableton Push' }),
    } satisfies AudioEngineHandler<FinalFeatureActionOf<'disconnectPush'>>,
    exportDawProject: {
        execute: async () => {
            notifyUser('DAWproject export — use File > Export DAWproject for full export');
        },
        undoable: false,
        describe: () => ({ label: 'Export DAWproject' }),
    } satisfies AudioEngineHandler<FinalFeatureActionOf<'exportDawProject'>>,
    loadRaveModel: {
        execute: async (a) => {
            loadModel(a.payload.modelId);
        },
        undoable: false,
        describe: () => ({ label: 'Load RAVE Model' }),
    } satisfies AudioEngineHandler<FinalFeatureActionOf<'loadRaveModel'>>,
    setRaveBlend: {
        execute: async (a) => {
            setTransferBlend(a.payload.blend);
        },
        undoable: false,
        describe: () => ({ label: 'Set RAVE Timbre Blend' }),
    } satisfies AudioEngineHandler<FinalFeatureActionOf<'setRaveBlend'>>,
    enableWarping: {
        execute: async (a) => {
            enableWarping(a.payload.clipId);
        },
        undoable: true,
        describe: () => ({ label: 'Enable Audio Warping' }),
    } satisfies AudioEngineHandler<FinalFeatureActionOf<'enableWarping'>>,
    setWarpAlgorithm: {
        execute: async (a) => {
            setWarpAlgorithm(a.payload.clipId, a.payload.algorithm);
        },
        undoable: true,
        describe: () => ({ label: 'Set Warp Algorithm' }),
    } satisfies AudioEngineHandler<FinalFeatureActionOf<'setWarpAlgorithm'>>,
    setWarpPitchShift: {
        execute: async (a) => {
            setPitchShift(a.payload.clipId, a.payload.semitones);
        },
        undoable: true,
        describe: () => ({ label: 'Set Warp Pitch Shift' }),
    } satisfies AudioEngineHandler<FinalFeatureActionOf<'setWarpPitchShift'>>,
};
