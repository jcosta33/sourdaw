/**
 * Audio recording — start/stop microphone recording, store recording state.
 *
 * Uses raw PCM capture via a ScriptProcessorNode instead of MediaRecorder so
 * that we never need to encode-then-decode (WebM is unsupported on WebKit).
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { audioEngine } from '../createWebAudioEngine';
import { getSelectedInputId } from '../../useCases/audioDeviceSelection';

const logger = Container.getInstance().get(Logger);

export type AudioRecordingState = {
    isRecording: boolean;
    micPermissionGranted: boolean;
};

export const audioRecordingStore = new Store<AudioRecordingState>(logger, {
    initialData: { isRecording: false, micPermissionGranted: false },
});

let mediaStream: MediaStream | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
/** Buffer-array of raw Float32 chunks (one per onaudioprocess call) */
let rawChunks: Float32Array[] = [];
let scriptProcessor: ScriptProcessorNode | null = null;
let onRecordingComplete: ((buffer: AudioBuffer) => void) | null = null;

/**
 * Pre-request microphone permission so the user sees the prompt on page load
 * rather than only when they first attempt to record.
 *
 * If the browser has already granted permission this is a no-op. The stream is
 * immediately stopped so that the mic indicator does not stay lit.
 */
export async function requestMicPermission(): Promise<boolean> {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            },
        });
        // Stop all tracks immediately — we only needed the permission prompt.
        for (const t of stream.getTracks()) {
            t.stop();
        }
        audioRecordingStore.set({ ...audioRecordingStore.value!, micPermissionGranted: true });
        return true;
    } catch {
        audioRecordingStore.set({ ...audioRecordingStore.value!, micPermissionGranted: false });
        return false;
    }
}

const BUFFER_SIZE = 4096;

export async function startAudioRecording(
    trackId: string,
    onComplete: (buffer: AudioBuffer) => void,
    inputId?: string | null
): Promise<boolean> {
    try {
        const selectedInputId = inputId ?? getSelectedInputId();
        const audioConstraints: MediaTrackConstraints = {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
        };
        if (selectedInputId) {
            audioConstraints.deviceId = { exact: selectedInputId };
        }
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
        });

        const ctx = audioEngine.context;
        sourceNode = ctx.createMediaStreamSource(mediaStream);

        const strip = audioEngine.ensureTrackStrip(trackId);
        sourceNode.connect(strip.gainNode);

        rawChunks = [];
        onRecordingComplete = onComplete;

        // Capture raw PCM via ScriptProcessorNode (deprecated but universally
        // supported — AudioWorklet would be overkill here and we already have a
        // worklet budget elsewhere).
        scriptProcessor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);
        scriptProcessor.onaudioprocess = (e: AudioProcessingEvent) => {
            const input = e.inputBuffer.getChannelData(0);
            // Copy because the backing buffer is reused by the browser.
            rawChunks.push(new Float32Array(input));
        };
        sourceNode.connect(scriptProcessor);
        // Connect to destination so the processor runs (required by spec).
        scriptProcessor.connect(ctx.destination);

        audioRecordingStore.set({ ...audioRecordingStore.value!, isRecording: true });

        return true;
    } catch (error) {
        logger.error(new Error('Failed to start recording', { cause: error }));
        cleanupNodes();
        return false;
    }
}

export function stopAudioRecording(): void {
    // Disconnect the processor first so no more samples arrive.
    if (scriptProcessor) {
        scriptProcessor.onaudioprocess = null;
        scriptProcessor.disconnect();
        scriptProcessor = null;
    }

    // Build an AudioBuffer from captured PCM chunks.
    if (rawChunks.length > 0 && onRecordingComplete) {
        const ctx = audioEngine.context;
        const totalSamples = rawChunks.reduce((sum, c) => sum + c.length, 0);
        const buffer = ctx.createBuffer(1, totalSamples, ctx.sampleRate);
        const channel = buffer.getChannelData(0);
        let offset = 0;
        for (const chunk of rawChunks) {
            channel.set(chunk, offset);
            offset += chunk.length;
        }
        onRecordingComplete(buffer);
    }

    onRecordingComplete = null;
    rawChunks = [];

    cleanupNodes();

    audioRecordingStore.set({ ...audioRecordingStore.value!, isRecording: false });
}

function cleanupNodes(): void {
    if (sourceNode) {
        sourceNode.disconnect();
        sourceNode = null;
    }
    if (mediaStream) {
        for (const t of mediaStream.getTracks()) {
            t.stop();
        }
        mediaStream = null;
    }
}
