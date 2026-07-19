import { buildDeviceChain, getAudioContext, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { projectClipMidiEvents } from '#/modules/MIDI/useCases';
import { sidechainStore } from '#/modules/Routing/stores';
import { tempoMapStore, transportStore } from '#/modules/Transport/stores';

import { type Track } from '../../models/Track';
import { getUpstreamSubgraph } from '../../services/getUpstreamSubgraph';
import { trackStore } from '../../stores/trackStore';

import { offlineRenderDependencies } from './offlineRenderDependencies';

// Local shape of the entries buildDeviceChain() returns, limited to the fields this
// renderer reads. buildDeviceChain is an injected use case whose return type erases
// to `any`, so the shape is restated here rather than derived.
type DeviceNodeEntry = {
    deviceId: string;
    node: { inputNode: AudioNode };
};

const MIDI_FREQUENCIES: Record<number, number> = {};
for (let n = 0; n < 128; n++) {
    MIDI_FREQUENCIES[n] = 440 * 2 ** ((n - 69) / 12);
}

export type RenderOfflineOptions = {
    onProgress?: (progress: number) => void;
    abortSignal?: AbortSignal;
    includeInserts?: boolean;
    includeSends?: boolean;
    includeAutomation?: boolean;
    normalization?: 'off' | 'protection' | 'full';
    autoTail?: boolean;
};

export async function renderTrackOffline(
    targetTrack: Track,
    startBeat: number,
    endBeat: number,
    options?: RenderOfflineOptions
): Promise<AudioBuffer | null> {
    const projectPpqEndpoints = offlineRenderDependencies?.projectPpqEndpoints;
    if (!projectPpqEndpoints) {
        throw new Error('Arrangement offline render dependencies are not configured');
    }
    // Only audio and midi tracks produce renderable content on their own.
    // Bus / group / master tracks have no direct sound source — skip rendering.
    if (targetTrack.kind !== 'audio' && targetTrack.kind !== 'midi') {
        return null;
    }

    const allTracks = trackStore.value?.tracks ?? [];
    const allSidechainRoutes = sidechainStore.value?.routes ?? [];
    const upstreamIds = getUpstreamSubgraph(targetTrack.id, allTracks, allSidechainRoutes);
    const renderTracks = allTracks.filter((time) => upstreamIds.has(time.id) || time.id === targetTrack.id);

    const transport = transportStore.value;
    const tempo = transport?.tempo ?? 120;
    const sampleRate = getAudioContext().sampleRate;
    const tempoChanges = tempoMapStore.value?.changes ?? [];
    const renderEndpoints = projectPpqEndpoints({
        startPpq: startBeat,
        endPpq: endBeat,
        defaultTempo: tempo,
        sampleRate,
        changes: tempoChanges,
    });
    const durationSeconds = renderEndpoints.durationSeconds;
    const midi = midiStore.value;

    const offlineCtx = new OfflineAudioContext(
        2,
        Math.ceil((durationSeconds + (options?.autoTail ? 10 : 0)) * sampleRate),
        sampleRate
    );

    // Map trackId -> { input, output, devices }
    const nodes = new Map<string, { input: AudioNode; output: AudioNode; devices: DeviceNodeEntry[] }>();

    for (const time of renderTracks) {
        const isTarget = time.id === targetTrack.id;
        const includeInserts = isTarget ? (options?.includeInserts ?? true) : true;
        const includeAutomation = isTarget ? (options?.includeAutomation ?? true) : true;

        const gainNode = offlineCtx.createGain();
        gainNode.gain.value = includeAutomation ? time.gain : 0.8;

        const panNode = offlineCtx.createStereoPanner();
        panNode.pan.value = includeAutomation ? time.pan / 50 : 0;

        let devices: DeviceNodeEntry[] = [];
        const inputNode: AudioNode = gainNode;

        if (includeInserts) {
            devices = await buildDeviceChain(offlineCtx, time.devices, gainNode, panNode);
            // buildDeviceChain connects gainNode -> devices -> panNode
            // so input to the track strip is gainNode.
        } else {
            gainNode.connect(panNode);
        }

        nodes.set(time.id, { input: inputNode, output: panNode, devices });

        if (isTarget) {
            panNode.connect(offlineCtx.destination);
        }

        // Schedule content (clips or frozen buffer)
        if (time.frozen && time.frozenBufferId) {
            const buffer = getCachedAudioBuffer({ bufferId: time.frozenBufferId });
            if (buffer) {
                const source = offlineCtx.createBufferSource();
                source.buffer = buffer;
                source.connect(gainNode);
                // The frozen buffer was rendered starting at the track's earliest
                // clip startBeat. Offset it relative to this render's startBeat.
                const trackStartBeat =
                    time.clips.length > 0 ? Math.min(...time.clips.map((context) => context.startBeat)) : 0;
                const offsetSeconds = Math.max(
                    0,
                    projectPpqEndpoints({
                        startPpq: startBeat,
                        endPpq: trackStartBeat,
                        defaultTempo: tempo,
                        sampleRate,
                        changes: tempoChanges,
                    }).durationSeconds
                );
                source.start(offsetSeconds);
            }
        } else {
            // Schedule individual clips
            if (time.kind === 'midi' && midi) {
                for (const clip of time.clips) {
                    if (clip.type !== 'midi') {
                        continue;
                    }
                    const sourceNotes = midi.notesByClipId[clip.id];
                    if (!sourceNotes) {
                        continue;
                    }
                    const clipLength = clip.endBeat - clip.startBeat;
                    if (clipLength <= 0) {
                        continue;
                    }
                    const rawLoopLength = clip.loopEnabled ? (clip.loopLength ?? clipLength) : clipLength;
                    const loopLength = rawLoopLength > 0 ? rawLoopLength : clipLength;
                    const iterations = clip.loopEnabled ? Math.ceil(clipLength / loopLength) : 1;
                    for (let iteration = 0; iteration < iterations; iteration++) {
                        const iterationStartBeat = clip.startBeat + iteration * loopLength;
                        const notes = projectClipMidiEvents({
                            events: sourceNotes,
                            clipId: clip.id,
                            clipStartBeat: clip.startBeat,
                            clipEndBeat: clip.endBeat,
                            iterationStartBeat,
                            loopLengthBeats: loopLength,
                            midiOffsetBeats: clip.midiOffsetBeats ?? 0,
                        });
                        for (const note of notes) {
                            const endpoint = projectPpqEndpoints({
                                startPpq: note.startBeat,
                                endPpq: note.startBeat + note.duration,
                                defaultTempo: tempo,
                                sampleRate,
                                changes: tempoChanges,
                            });
                            const noteStart = Math.max(0, endpoint.startSeconds - renderEndpoints.startSeconds);
                            const noteEnd = endpoint.endSeconds - renderEndpoints.startSeconds;
                            const noteDur = noteEnd - noteStart;
                            if (noteStart >= durationSeconds || noteDur <= 0) {
                                continue;
                            }

                            // Simple synth fallback for MIDI rendering if no instrument in chain
                            const freq = MIDI_FREQUENCIES[note.pitch] ?? 440;
                            const osc = offlineCtx.createOscillator();
                            const env = offlineCtx.createGain();
                            const attackEnd = Math.min(noteStart + 0.005, noteEnd);
                            const releaseStart = Math.max(attackEnd, noteEnd - 0.01);
                            osc.type = 'triangle';
                            osc.frequency.value = freq;
                            env.gain.setValueAtTime(0, noteStart);
                            env.gain.linearRampToValueAtTime((note.velocity / 127) * 0.3, attackEnd);
                            env.gain.setValueAtTime((note.velocity / 127) * 0.3, releaseStart);
                            env.gain.exponentialRampToValueAtTime(0.001, noteEnd);
                            osc.connect(env);
                            env.connect(gainNode);
                            osc.start(noteStart);
                            osc.stop(noteEnd + 0.01);
                        }
                    }
                }
            } else if (time.kind === 'audio') {
                for (const clip of time.clips) {
                    const buffer = getCachedAudioBuffer({ bufferId: clip.audioBufferId ?? '' });
                    if (!buffer) {
                        continue;
                    }
                    const clipEndpoints = projectPpqEndpoints({
                        startPpq: clip.startBeat,
                        endPpq: clip.endBeat,
                        defaultTempo: tempo,
                        sampleRate,
                        changes: tempoChanges,
                    });
                    const clipStart = clipEndpoints.startSeconds - renderEndpoints.startSeconds;
                    const clipDuration = clipEndpoints.durationSeconds;
                    const source = offlineCtx.createBufferSource();
                    source.buffer = buffer;
                    source.connect(gainNode);
                    source.start(Math.max(0, clipStart), 0, Math.min(clipDuration, buffer.duration));
                }
            }
        }
    }

    // Wire Upstream Connections
    for (const time of renderTracks) {
        const tNodes = nodes.get(time.id)!;

        // 1. Output Routing
        if (time.outputId && nodes.has(time.outputId)) {
            const destNodes = nodes.get(time.outputId)!;
            tNodes.output.connect(destNodes.input);
        }

        // 2. Sends
        for (const send of time.sends) {
            if (nodes.has(send.busId)) {
                const sendGain = offlineCtx.createGain();
                sendGain.gain.value = send.level;
                // preFader send logic deferred for now; defaults to post-fader (analyserNode in live)
                tNodes.output.connect(sendGain);
                sendGain.connect(nodes.get(send.busId)!.input);
            }
        }
    }

    // 3. Sidechains
    for (const r of allSidechainRoutes) {
        if (nodes.has(r.sourceTrackId) && nodes.has(r.targetTrackId)) {
            const sourceNode = nodes.get(r.sourceTrackId)!.output;
            const targetTrackNodes = nodes.get(r.targetTrackId)!;
            const targetDeviceNode = targetTrackNodes.devices.find((data) => data.deviceId === r.targetDeviceId);

            if (targetDeviceNode && targetDeviceNode.node.inputNode.numberOfInputs >= 2) {
                const scGain = offlineCtx.createGain();
                scGain.gain.value = r.gain;
                sourceNode.connect(scGain);
                // Connect to the second input (index 1) of the sidechain-aware device
                scGain.connect(targetDeviceNode.node.inputNode, 0, 1);
            }
        }
    }

    const buffer = await renderWithProgress(offlineCtx, options);
    let finalBuffer = buffer;

    if (options?.autoTail) {
        finalBuffer = trimSilence(finalBuffer, -80);
    }

    if (options?.normalization && options.normalization !== 'off') {
        finalBuffer = normalizeBuffer(finalBuffer, options.normalization);
    }

    return finalBuffer;
}

function trimSilence(buffer: AudioBuffer, thresholdDb: number): AudioBuffer {
    const threshold = 10 ** (thresholdDb / 20);
    const sampleRate = buffer.sampleRate;
    const channels = buffer.numberOfChannels;
    const length = buffer.length;

    let lastActiveSample = 0;

    for (let ch = 0; ch < channels; ch++) {
        const data = buffer.getChannelData(ch);
        for (let index = length - 1; index >= lastActiveSample; index--) {
            if (Math.abs(data[index]!) > threshold) {
                lastActiveSample = Math.max(lastActiveSample, index);
                break;
            }
        }
    }

    // Add 100ms safety buffer
    const safetySamples = Math.floor(sampleRate * 0.1);
    const finalLength = Math.min(length, lastActiveSample + safetySamples);

    if (finalLength === length) {
        return buffer;
    }

    const newBuffer = new AudioBuffer({
        length: finalLength,
        numberOfChannels: channels,
        sampleRate,
    });

    for (let ch = 0; ch < channels; ch++) {
        newBuffer.copyToChannel(buffer.getChannelData(ch).subarray(0, finalLength), ch);
    }

    return newBuffer;
}

function normalizeBuffer(buffer: AudioBuffer, mode: 'protection' | 'full'): AudioBuffer {
    const channels = buffer.numberOfChannels;
    const length = buffer.length;
    let maxPeak = 0;

    for (let ch = 0; ch < channels; ch++) {
        const data = buffer.getChannelData(ch);
        for (let index = 0; index < length; index++) {
            const abs = Math.abs(data[index]!);
            if (abs > maxPeak) {
                maxPeak = abs;
            }
        }
    }

    if (maxPeak === 0) {
        return buffer;
    }

    let targetPeak = 1.0;
    if (mode === 'protection') {
        if (maxPeak <= 1.0) {
            return buffer;
        } // Already safe
        targetPeak = 0.98; // Normalize down to -0.2dB
    } else if (mode === 'full') {
        targetPeak = 0.99; // Normalize up/down to -0.1dB
    }

    const ratio = targetPeak / maxPeak;

    const newBuffer = new AudioBuffer({
        length,
        numberOfChannels: channels,
        sampleRate: buffer.sampleRate,
    });

    for (let ch = 0; ch < channels; ch++) {
        const src = buffer.getChannelData(ch);
        const dest = new Float32Array(length);
        for (let index = 0; index < length; index++) {
            dest[index] = src[index]! * ratio;
        }
        newBuffer.copyToChannel(dest, ch);
    }

    return newBuffer;
}

async function renderWithProgress(
    offlineCtx: OfflineAudioContext,
    options?: RenderOfflineOptions
): Promise<AudioBuffer> {
    return new Promise((resolve, reject) => {
        const CHUNK_SIZE = 44100 * 2; // 2 seconds per chunk
        const totalFrames = offlineCtx.length;

        if (options?.abortSignal?.aborted) {
            reject(new Error('Render aborted'));
            return;
        }

        function abortHandler() {
            reject(new Error('Render aborted'));
        }
        options?.abortSignal?.addEventListener('abort', abortHandler);

        for (let index = CHUNK_SIZE; index < totalFrames; index += CHUNK_SIZE) {
            const time = index / offlineCtx.sampleRate;
            offlineCtx
                .suspend(time)
                .then(() => {
                    if (options?.abortSignal?.aborted) {
                        return null;
                    }
                    void options?.onProgress?.(index / totalFrames);
                    void offlineCtx.resume();
                    return null;
                })
                .catch((error) => {
                    reject(error instanceof Error ? error : new Error(String(error)));
                    return null;
                });
        }

        offlineCtx
            .startRendering()
            .then((buffer) => {
                options?.abortSignal?.removeEventListener('abort', abortHandler);
                if (!options?.abortSignal?.aborted) {
                    options?.onProgress?.(1.0);
                    resolve(buffer);
                }
                return null;
            })
            .catch((error) => {
                options?.abortSignal?.removeEventListener('abort', abortHandler);
                reject(error instanceof Error ? error : new Error(String(error)));
                return null;
            });
    });
}
