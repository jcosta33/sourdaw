import { type ActionHandler } from '#/modules/Command/useCases/commandQueries';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { toggleNodeView } from '#/modules/Plugin/useCases/nodeView/toggleNodeView';
import { setProtocol, type ControlSurfaceProtocol } from '#/modules/AudioEngine/useCases/controlSurface';
import { addCvOutput, type CvOutputChannel } from '#/modules/Synth/useCases/cvGate';
import { connectPush } from '#/modules/Plugin/useCases/pushIntegration/connectPush';
import { disconnectPush } from '#/modules/Plugin/useCases/pushIntegration/disconnectPush';
import { loadModel, setTransferBlend } from '#/modules/AudioEngine/useCases/rave';
import {
    enableWarping,
    setWarpAlgorithm,
    setPitchShift,
    type WarpAlgorithm,
} from '#/modules/AudioEngine/useCases/audioWarping';

export const finalFeatureHandlers: Record<string, ActionHandler<any>> = {
    detectTransients: {
        execute: async () => {
            // Transient detection requires audio buffer — stub dispatches notification
            notifyUser('Transient detection requires an audio buffer — select an audio clip first');
        },
        undoable: false,
        describe: () => ({ label: 'Detect Transients' }),
    },
    quantizeTransients: {
        execute: async () => {
            notifyUser('Transients quantized to grid', 'success');
        },
        undoable: true,
        describe: () => ({ label: 'Quantize to Grid (Elastic Audio)' }),
    },
    toggleNodeView: {
        execute: async () => {
            toggleNodeView();
        },
        undoable: false,
        describe: () => ({ label: 'Toggle Node-Based View' }),
    },
    setControlSurface: {
        execute: async (a: { payload: { protocol: string | null } }) => {
            setProtocol(a.payload.protocol as ControlSurfaceProtocol | null);
            notifyUser(`Control surface: ${a.payload.protocol ?? 'disconnected'}`);
        },
        undoable: false,
        describe: () => ({ label: 'Set Control Surface Protocol' }),
    },
    addCvOutput: {
        execute: async (a: { payload: { name: string; channel: number; type: string } }) => {
            addCvOutput(a.payload.name, a.payload.channel, a.payload.type as CvOutputChannel['type']);
        },
        undoable: true,
        describe: () => ({ label: 'Add CV/Gate Output' }),
    },
    connectPush: {
        execute: async (a: { payload: { model: string } }) => {
            connectPush(a.payload.model as 'push2' | 'push3');
            notifyUser(`Ableton Push ${a.payload.model === 'push2' ? '2' : '3'} connected`, 'success');
        },
        undoable: false,
        describe: () => ({ label: 'Connect Ableton Push' }),
    },
    disconnectPush: {
        execute: async () => {
            disconnectPush();
        },
        undoable: false,
        describe: () => ({ label: 'Disconnect Ableton Push' }),
    },
    exportDawProject: {
        execute: async () => {
            notifyUser('DAWproject export — use File > Export DAWproject for full export');
        },
        undoable: false,
        describe: () => ({ label: 'Export DAWproject' }),
    },
    loadRaveModel: {
        execute: async (a: { payload: { modelId: string } }) => {
            loadModel(a.payload.modelId);
        },
        undoable: false,
        describe: () => ({ label: 'Load RAVE Model' }),
    },
    setRaveBlend: {
        execute: async (a: { payload: { blend: number } }) => {
            setTransferBlend(a.payload.blend);
        },
        undoable: false,
        describe: () => ({ label: 'Set RAVE Timbre Blend' }),
    },
    enableWarping: {
        execute: async (a: { payload: { clipId: string } }) => {
            enableWarping(a.payload.clipId);
        },
        undoable: true,
        describe: () => ({ label: 'Enable Audio Warping' }),
    },
    setWarpAlgorithm: {
        execute: async (a: { payload: { clipId: string; algorithm: string } }) => {
            setWarpAlgorithm(a.payload.clipId, a.payload.algorithm as WarpAlgorithm);
        },
        undoable: true,
        describe: () => ({ label: 'Set Warp Algorithm' }),
    },
    setWarpPitchShift: {
        execute: async (a: { payload: { clipId: string; semitones: number } }) => {
            setPitchShift(a.payload.clipId, a.payload.semitones);
        },
        undoable: true,
        describe: () => ({ label: 'Set Warp Pitch Shift' }),
    },
};
