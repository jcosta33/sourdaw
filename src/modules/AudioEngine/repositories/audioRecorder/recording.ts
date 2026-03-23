/**
 * Audio recording — start/stop microphone recording, store recording state.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { audioEngine } from '../audioEngineInstance';
import { getSelectedInputId } from '../../useCases/audioDeviceSelection';

const logger = Container.getInstance().get(Logger);

export type AudioRecordingState = {
    isRecording: boolean;
};

export const audioRecordingStore = new Store<AudioRecordingState>(logger, {
    initialData: { isRecording: false },
});

let mediaStream: MediaStream | null = null;
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let sourceNode: MediaStreamAudioSourceNode | null = null;
let onRecordingComplete: ((buffer: AudioBuffer) => void) | null = null;

const cachedMimeType: string | null = null;

function getRecorderMimeType(): string {
    if (cachedMimeType) {
        return cachedMimeType;
    }
    return MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
}

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

        recordedChunks = [];
        onRecordingComplete = onComplete;

        mediaRecorder = new MediaRecorder(mediaStream, {
            mimeType: getRecorderMimeType(),
        });

        audioRecordingStore.set({ isRecording: true });

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            const blob = new Blob(recordedChunks, { type: 'audio/webm' });
            const arrayBuffer = await blob.arrayBuffer();
            const buffer = await ctx.decodeAudioData(arrayBuffer);

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

            onRecordingComplete?.(buffer);
            onRecordingComplete = null;
            recordedChunks = [];

            audioRecordingStore.set({ isRecording: false });
        };

        mediaRecorder.start(100);
        return true;
    } catch (error) {
        logger.error(new Error('Failed to start recording', { cause: error }));
        return false;
    }
}

export function stopAudioRecording(): void {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    mediaRecorder = null;
    audioRecordingStore.set({ isRecording: false });
}
