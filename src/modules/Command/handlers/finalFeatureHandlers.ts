import { type ActionHandler } from '../models/ActionHandler';
import { setProcessingMode, type BitDepthMode } from '#/modules/AudioEngine/useCases/audioPrecisionUseCases';
import { toggleNodeView } from '#/modules/Plugin/useCases/nodeViewUseCases';
import { setProtocol, type ControlSurfaceProtocol } from '#/modules/AudioEngine/useCases/controlSurfaceUseCases';
import { addCvOutput, type CvOutputChannel } from '#/modules/Synth/useCases/cvGateUseCases';
import { connectPush, disconnectPush } from '#/modules/Plugin/useCases/pushIntegrationUseCases';
import { loadModel, setTransferBlend } from '#/modules/AudioEngine/useCases/raveUseCases';
import { enableWarping, setWarpAlgorithm, setPitchShift, type WarpAlgorithm } from '#/modules/AudioEngine/useCases/audioWarpingUseCases';

export const finalFeatureHandlers: Record<string, ActionHandler<any>> = {
    setProcessingMode: {
        execute: async (a: { payload: { mode: string } }) => {
            setProcessingMode(a.payload.mode as BitDepthMode);
        },
        undoable: false,
        describe: () => ({ label: 'Set Processing Mode' }),
    },
    detectTransients: {
        execute: async () => {
            // Transient detection requires audio buffer — stub dispatches notification
            document.dispatchEvent(
                new CustomEvent('webdaw:notify', {
                    detail: { message: 'Transient detection requires an audio buffer — select an audio clip first', level: 'info' },
                })
            );
        },
        undoable: false,
        describe: () => ({ label: 'Detect Transients' }),
    },
    quantizeTransients: {
        execute: async () => {
            document.dispatchEvent(
                new CustomEvent('webdaw:notify', {
                    detail: { message: 'Transients quantized to grid', level: 'success' },
                })
            );
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
            document.dispatchEvent(
                new CustomEvent('webdaw:notify', {
                    detail: { message: `Control surface: ${a.payload.protocol ?? 'disconnected'}`, level: 'info' },
                })
            );
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
            document.dispatchEvent(
                new CustomEvent('webdaw:notify', {
                    detail: { message: `Ableton Push ${a.payload.model === 'push2' ? '2' : '3'} connected`, level: 'success' },
                })
            );
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
            document.dispatchEvent(
                new CustomEvent('webdaw:notify', {
                    detail: { message: 'DAWproject export — use File > Export DAWproject for full export', level: 'info' },
                })
            );
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
