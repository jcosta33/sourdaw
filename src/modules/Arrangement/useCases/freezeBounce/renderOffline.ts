import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { buildDeviceChain, getAudioContext } from '#/modules/AudioEngine/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { transportStore } from '#/modules/Transport/stores';
import { type Track } from '../../models/Track';

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
    track: Track,
    startBeat: number,
    endBeat: number,
    options?: RenderOfflineOptions
): Promise<AudioBuffer | null> {
    const durationBeats = endBeat - startBeat;
    const transport = transportStore.value;
    const tempo = transport?.tempo ?? 120;
    const sampleRate = getAudioContext().sampleRate;
    const durationSeconds = (durationBeats / tempo) * 60;
    const midi = midiStore.value;

    const includeInserts = options?.includeInserts ?? true;
    const includeAutomation = options?.includeAutomation ?? true;
    // includeSends implementation is deferred to a subgraph-aware render update

    const offlineCtx = new OfflineAudioContext(2, Math.ceil((durationSeconds + (options?.autoTail ? 10 : 0)) * sampleRate), sampleRate);
    
    // Set up track output nodes
    const trackGain = offlineCtx.createGain();
    trackGain.gain.value = includeAutomation ? track.gain : 0.8;
    
    const trackPan = offlineCtx.createStereoPanner();
    trackPan.pan.value = includeAutomation ? track.pan / 50 : 0;

    // Build device chain if requested
    if (includeInserts) {
        await buildDeviceChain(offlineCtx, track.devices, trackGain, trackPan);
    } else {
        trackGain.connect(trackPan);
    }
    
    trackPan.connect(offlineCtx.destination);

    if (track.kind === 'midi' && midi) {
        for (const clip of track.clips) {
            if (clip.type !== 'midi') continue;
            const notes = midi.notesByClipId[clip.id];
            if (!notes) continue;

            for (const note of notes) {
                const noteStart = ((clip.startBeat - startBeat + note.startBeat) / tempo) * 60;
                const noteDur = (note.duration / tempo) * 60;
                if (noteStart >= durationSeconds || noteStart < 0) continue;

                const freq = MIDI_FREQUENCIES[note.pitch] ?? 440;
                const osc = offlineCtx.createOscillator();
                const env = offlineCtx.createGain();
                osc.type = 'triangle';
                osc.frequency.value = freq;
                
                // Simple synth for MIDI tracks without instruments (fallback)
                // If there's an instrument in the chain, buildDeviceChain handles it
                // but we still need to trigger noteOn/Off if possible.
                // TODO: properly trigger instrument nodes in the chain.
                
                env.gain.setValueAtTime(0, noteStart);
                env.gain.linearRampToValueAtTime((note.velocity / 127) * 0.3, noteStart + 0.005);
                env.gain.setValueAtTime((note.velocity / 127) * 0.3, noteStart + noteDur - 0.01);
                env.gain.exponentialRampToValueAtTime(0.001, noteStart + noteDur);
                osc.connect(env);
                env.connect(trackGain);
                osc.start(noteStart);
                osc.stop(noteStart + noteDur + 0.01);
            }
        }
    }

    if (track.kind === 'audio') {
        for (const clip of track.clips) {
            const buffer = audioBufferCache.get(clip.audioBufferId ?? '');
            if (!buffer) continue;
            
            const clipStart = ((clip.startBeat - startBeat) / tempo) * 60;
            const clipDuration = ((clip.endBeat - clip.startBeat) / tempo) * 60;
            const source = offlineCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(trackGain);
            source.start(Math.max(0, clipStart), 0, Math.min(clipDuration, buffer.duration));
        }
    }

    const buffer = await renderWithProgress(offlineCtx, options);
    
    // Apply tail trimming or normalization if needed
    if (options?.autoTail) {
        // TODO: implement silence detection and trim
    }
    
    if (options?.normalization === 'full') {
        // TODO: implement normalization
    }

    return buffer;
}

async function renderWithProgress(
    offlineCtx: OfflineAudioContext,
    options?: RenderOfflineOptions
): Promise<AudioBuffer> {
    return new Promise((resolve, reject) => {
        const CHUNK_SIZE = 44100 * 2; // 2 seconds per chunk
        const totalFrames = offlineCtx.length;

        if (options?.abortSignal?.aborted) {
            return reject(new Error('Render aborted'));
        }

        const abortHandler = () => reject(new Error('Render aborted'));
        options?.abortSignal?.addEventListener('abort', abortHandler);

        for (let i = CHUNK_SIZE; i < totalFrames; i += CHUNK_SIZE) {
            const time = i / offlineCtx.sampleRate;
            offlineCtx.suspend(time).then(() => {
                if (options?.abortSignal?.aborted) return;
                options?.onProgress?.(i / totalFrames);
                offlineCtx.resume();
            }).catch(reject);
        }

        offlineCtx.startRendering().then((buffer) => {
            options?.abortSignal?.removeEventListener('abort', abortHandler);
            if (!options?.abortSignal?.aborted) {
                options?.onProgress?.(1.0);
                resolve(buffer);
            }
        }).catch((err) => {
            options?.abortSignal?.removeEventListener('abort', abortHandler);
            reject(err);
        });
    });
}
