/**
 * Offline track rendering for freeze/bounce operations.
 *
 * Note: MIDI rendering uses a triangle oscillator fallback — the track's actual
 * instrument is not yet cloned into the offline context.
 */
import { audioBufferCache, buildDeviceChain, getAudioContext } from '#/modules/AudioEngine';
import { midiStore } from '#/modules/MIDI';
import { transportStore } from '#/modules/Transport';
import { type Track } from '../../models/Track';

const MIDI_FREQUENCIES: Record<number, number> = {};
for (let n = 0; n < 128; n++) {
    MIDI_FREQUENCIES[n] = 440 * 2 ** ((n - 69) / 12);
}

export async function renderTrackOffline(
    track: Track,
    startBeat: number,
    endBeat: number
): Promise<AudioBuffer | null> {
    const durationBeats = endBeat - startBeat;
    const transport = transportStore.value;
    const tempo = transport?.tempo ?? 120;
    const sampleRate = getAudioContext().sampleRate;
    const durationSeconds = (durationBeats / tempo) * 60;
    const midi = midiStore.value;

    if (track.kind === 'midi' && midi) {
        const offlineCtx = new OfflineAudioContext(2, Math.ceil(durationSeconds * sampleRate), sampleRate);
        const trackGain = offlineCtx.createGain();
        trackGain.gain.value = track.gain;
        const trackPan = offlineCtx.createStereoPanner();
        trackPan.pan.value = track.pan / 50;
        await buildDeviceChain(offlineCtx, track.devices, trackGain, trackPan);
        trackPan.connect(offlineCtx.destination);

        for (const clip of track.clips) {
            if (clip.type !== 'midi') {
                continue;
            }
            const notes = midi.notesByClipId[clip.id];
            if (!notes) {
                continue;
            }

            for (const note of notes) {
                const noteStart = ((clip.startBeat - startBeat + note.startBeat) / tempo) * 60;
                const noteDur = (note.duration / tempo) * 60;
                if (noteStart >= durationSeconds || noteStart < 0) {
                    continue;
                }

                const freq = MIDI_FREQUENCIES[note.pitch] ?? 440;
                const osc = offlineCtx.createOscillator();
                const env = offlineCtx.createGain();
                osc.type = 'triangle';
                osc.frequency.value = freq;
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

        return offlineCtx.startRendering();
    }

    if (track.kind === 'audio') {
        const offlineCtx = new OfflineAudioContext(2, Math.ceil(durationSeconds * sampleRate), sampleRate);
        const trackGain = offlineCtx.createGain();
        trackGain.gain.value = track.gain;
        const trackPan = offlineCtx.createStereoPanner();
        trackPan.pan.value = track.pan / 50;
        await buildDeviceChain(offlineCtx, track.devices, trackGain, trackPan);
        trackPan.connect(offlineCtx.destination);

        for (const clip of track.clips) {
            const buffer = audioBufferCache.get(clip.audioBufferId ?? '');
            if (!buffer) {
                continue;
            }
            const clipStart = ((clip.startBeat - startBeat) / tempo) * 60;
            const clipDuration = ((clip.endBeat - clip.startBeat) / tempo) * 60;
            const source = offlineCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(trackGain);
            source.start(Math.max(0, clipStart), 0, Math.min(clipDuration, buffer.duration));
        }

        return offlineCtx.startRendering();
    }

    return null;
}
