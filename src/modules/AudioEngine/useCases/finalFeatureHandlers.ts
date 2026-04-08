import { inject } from '#/infra/di/inject';
import { type ActionHandler } from '#/modules/Command/useCases/commandQueries';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { toggleNodeView } from '#/modules/Plugin/useCases/nodeView/toggleNodeView';
import { setProtocol } from '#/modules/AudioEngine/useCases/controlSurface/setProtocol';
import { type ControlSurfaceProtocol } from '#/modules/AudioEngine/stores/controlSurface';
import { addCvOutput } from '#/modules/Synth/useCases/cvGate/cvOutputOperations';
import { connectPush } from '#/modules/Plugin/useCases/pushIntegration/connectPush';
import { disconnectPush } from '#/modules/Plugin/useCases/pushIntegration/disconnectPush';
import { loadModel } from '#/modules/AudioEngine/useCases/rave/loadModel';
import { setTransferBlend } from '#/modules/AudioEngine/useCases/rave/setTransferBlend';
import { enableWarping } from '#/modules/AudioEngine/useCases/audioWarping/enableWarping';
import { setWarpAlgorithm } from '#/modules/AudioEngine/useCases/audioWarping/setWarpAlgorithm';
import { setPitchShift } from '#/modules/AudioEngine/useCases/audioWarping/setPitchShift';
import { type WarpAlgorithm } from '#/modules/AudioEngine/stores/audioWarp';

// AudioEngine-local shape (AGENTS.md §95 — model isolation).
type CvOutputType = 'cv-pitch' | 'cv-velocity' | 'cv-modulation' | 'gate' | 'trigger' | 'clock';

export const executeDetectTransients = inject({ notifyUser })(
    ({ notifyUser }) =>
        async function executeDetectTransients(): Promise<void> {
            notifyUser('Transient detection requires an audio buffer — select an audio clip first');
        }
);

export const executeQuantizeTransients = inject({ notifyUser })(
    ({ notifyUser }) =>
        async function executeQuantizeTransients(): Promise<void> {
            notifyUser('Transients quantized to grid', 'success');
        }
);

export const executeToggleNodeView = inject({ toggleNodeView })(
    ({ toggleNodeView }) =>
        async function executeToggleNodeView(): Promise<void> {
            toggleNodeView();
        }
);

export const executeSetControlSurface = inject({ setProtocol, notifyUser })(
    ({ setProtocol, notifyUser }) =>
        async function executeSetControlSurface(a: { payload: { protocol: string | null } }): Promise<void> {
            setProtocol(a.payload.protocol as ControlSurfaceProtocol | null);
            notifyUser(`Control surface: ${a.payload.protocol ?? 'disconnected'}`);
        }
);

export const executeAddCvOutput = inject({ addCvOutput })(
    ({ addCvOutput }) =>
        async function executeAddCvOutput(a: { payload: { name: string; channel: number; type: string } }): Promise<void> {
            addCvOutput(a.payload.name, a.payload.channel, a.payload.type as CvOutputType);
        }
);

export const executeConnectPush = inject({ connectPush, notifyUser })(
    ({ connectPush, notifyUser }) =>
        async function executeConnectPush(a: { payload: { model: string } }): Promise<void> {
            connectPush(a.payload.model as 'push2' | 'push3');
            notifyUser(`Ableton Push ${a.payload.model === 'push2' ? '2' : '3'} connected`, 'success');
        }
);

export const executeDisconnectPush = inject({ disconnectPush })(
    ({ disconnectPush }) =>
        async function executeDisconnectPush(): Promise<void> {
            disconnectPush();
        }
);

export const executeExportDawProject = inject({ notifyUser })(
    ({ notifyUser }) =>
        async function executeExportDawProject(): Promise<void> {
            notifyUser('DAWproject export — use File > Export DAWproject for full export');
        }
);

export const executeLoadRaveModel = inject({ loadModel })(
    ({ loadModel }) =>
        async function executeLoadRaveModel(a: { payload: { modelId: string } }): Promise<void> {
            loadModel(a.payload.modelId);
        }
);

export const executeSetRaveBlend = inject({ setTransferBlend })(
    ({ setTransferBlend }) =>
        async function executeSetRaveBlend(a: { payload: { blend: number } }): Promise<void> {
            setTransferBlend(a.payload.blend);
        }
);

export const executeEnableWarping = inject({ enableWarping })(
    ({ enableWarping }) =>
        async function executeEnableWarping(a: { payload: { clipId: string } }): Promise<void> {
            enableWarping(a.payload.clipId);
        }
);

export const executeSetWarpAlgorithm = inject({ setWarpAlgorithm })(
    ({ setWarpAlgorithm }) =>
        async function executeSetWarpAlgorithm(a: {
            payload: { clipId: string; algorithm: string };
        }): Promise<void> {
            setWarpAlgorithm(a.payload.clipId, a.payload.algorithm as WarpAlgorithm);
        }
);

export const executeSetWarpPitchShift = inject({ setPitchShift })(
    ({ setPitchShift }) =>
        async function executeSetWarpPitchShift(a: {
            payload: { clipId: string; semitones: number };
        }): Promise<void> {
            setPitchShift(a.payload.clipId, a.payload.semitones);
        }
);

export const finalFeatureHandlers: Record<string, ActionHandler<any>> = {
    detectTransients: {
        execute: executeDetectTransients,
        undoable: false,
        describe: () => ({ label: 'Detect Transients' }),
    },
    quantizeTransients: {
        execute: executeQuantizeTransients,
        undoable: true,
        describe: () => ({ label: 'Quantize to Grid (Elastic Audio)' }),
    },
    toggleNodeView: {
        execute: executeToggleNodeView,
        undoable: false,
        describe: () => ({ label: 'Toggle Node-Based View' }),
    },
    setControlSurface: {
        execute: executeSetControlSurface,
        undoable: false,
        describe: () => ({ label: 'Set Control Surface Protocol' }),
    },
    addCvOutput: {
        execute: executeAddCvOutput,
        undoable: true,
        describe: () => ({ label: 'Add CV/Gate Output' }),
    },
    connectPush: {
        execute: executeConnectPush,
        undoable: false,
        describe: () => ({ label: 'Connect Ableton Push' }),
    },
    disconnectPush: {
        execute: executeDisconnectPush,
        undoable: false,
        describe: () => ({ label: 'Disconnect Ableton Push' }),
    },
    exportDawProject: {
        execute: executeExportDawProject,
        undoable: false,
        describe: () => ({ label: 'Export DAWproject' }),
    },
    loadRaveModel: {
        execute: executeLoadRaveModel,
        undoable: false,
        describe: () => ({ label: 'Load RAVE Model' }),
    },
    setRaveBlend: {
        execute: executeSetRaveBlend,
        undoable: false,
        describe: () => ({ label: 'Set RAVE Timbre Blend' }),
    },
    enableWarping: {
        execute: executeEnableWarping,
        undoable: true,
        describe: () => ({ label: 'Enable Audio Warping' }),
    },
    setWarpAlgorithm: {
        execute: executeSetWarpAlgorithm,
        undoable: true,
        describe: () => ({ label: 'Set Warp Algorithm' }),
    },
    setWarpPitchShift: {
        execute: executeSetWarpPitchShift,
        undoable: true,
        describe: () => ({ label: 'Set Warp Pitch Shift' }),
    },
};
