import { getAudioContext, resumeEngine } from '#/modules/AudioEngine/useCases';

import type { PreviewEvent, PreviewVoice, TemplatePreview } from './previewLoops';

const PREVIEW_MASTER_GAIN = 0.2;
const SCHEDULE_AHEAD_SECONDS = 0.3;
const SCHEDULER_TICK_MS = 80;
const FADE_OUT_SECONDS = 0.01;

function midiToFreq(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

function velocityGain(velocity: number | undefined): number {
    const resolved = typeof velocity === 'number' ? velocity : 100;
    return Math.max(0, Math.min(1, resolved / 127));
}

function createWhiteNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.max(1, Math.ceil(ctx.sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    return buffer;
}

function playKick(ctx: AudioContext, dest: AudioNode, startTime: number, velocity: number): void {
    const gain = velocityGain(velocity);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, startTime);
    osc.frequency.exponentialRampToValueAtTime(45, startTime + 0.05);
    osc.frequency.exponentialRampToValueAtTime(30, startTime + 0.35);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.exponentialRampToValueAtTime(gain * 1.1, startTime + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.4);
    osc.connect(env).connect(dest);
    osc.start(startTime);
    osc.stop(startTime + 0.45);
}

function playSnare(ctx: AudioContext, dest: AudioNode, startTime: number, velocity: number): void {
    const gain = velocityGain(velocity);
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = createWhiteNoiseBuffer(ctx, 0.25);
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 1500;
    const noiseEnv = ctx.createGain();
    noiseEnv.gain.setValueAtTime(0.0001, startTime);
    noiseEnv.gain.exponentialRampToValueAtTime(gain * 0.8, startTime + 0.002);
    noiseEnv.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.18);
    noiseSrc.connect(noiseFilter).connect(noiseEnv).connect(dest);
    noiseSrc.start(startTime);
    noiseSrc.stop(startTime + 0.25);

    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(220, startTime);
    body.frequency.exponentialRampToValueAtTime(140, startTime + 0.1);
    const bodyEnv = ctx.createGain();
    bodyEnv.gain.setValueAtTime(0.0001, startTime);
    bodyEnv.gain.exponentialRampToValueAtTime(gain * 0.4, startTime + 0.003);
    bodyEnv.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.12);
    body.connect(bodyEnv).connect(dest);
    body.start(startTime);
    body.stop(startTime + 0.15);
}

function playHat(ctx: AudioContext, dest: AudioNode, startTime: number, velocity: number, open: boolean): void {
    const gain = velocityGain(velocity);
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = createWhiteNoiseBuffer(ctx, open ? 0.25 : 0.08);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 10000;
    bp.Q.value = 1.2;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.exponentialRampToValueAtTime(gain * 0.35, startTime + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + (open ? 0.22 : 0.05));
    noiseSrc.connect(hp).connect(bp).connect(env).connect(dest);
    noiseSrc.start(startTime);
    noiseSrc.stop(startTime + (open ? 0.26 : 0.09));
}

function playBass(
    ctx: AudioContext,
    dest: AudioNode,
    startTime: number,
    velocity: number,
    midi: number,
    duration: number
): void {
    const gain = velocityGain(velocity);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = midiToFreq(midi);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, startTime);
    lp.frequency.exponentialRampToValueAtTime(400, startTime + duration * 0.6);
    lp.Q.value = 4;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.exponentialRampToValueAtTime(gain * 0.55, startTime + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(lp).connect(env).connect(dest);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
}

function playLead(
    ctx: AudioContext,
    dest: AudioNode,
    startTime: number,
    velocity: number,
    midi: number,
    duration: number
): void {
    const gain = velocityGain(velocity);
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscB.type = 'sawtooth';
    oscA.frequency.value = midiToFreq(midi);
    oscB.frequency.value = midiToFreq(midi) * 1.007;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    lp.Q.value = 2;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.exponentialRampToValueAtTime(gain * 0.28, startTime + 0.015);
    env.gain.setTargetAtTime(gain * 0.2, startTime + 0.05, 0.1);
    env.gain.setTargetAtTime(0.0001, startTime + duration, 0.08);
    oscA.connect(lp);
    oscB.connect(lp);
    lp.connect(env).connect(dest);
    oscA.start(startTime);
    oscB.start(startTime);
    oscA.stop(startTime + duration + 0.25);
    oscB.stop(startTime + duration + 0.25);
}

function playPad(
    ctx: AudioContext,
    dest: AudioNode,
    startTime: number,
    velocity: number,
    midi: number,
    duration: number
): void {
    const gain = velocityGain(velocity);
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscB.type = 'triangle';
    oscA.frequency.value = midiToFreq(midi);
    oscB.frequency.value = midiToFreq(midi) * 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1600;
    lp.Q.value = 1;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(gain * 0.18, startTime + Math.min(0.5, duration * 0.35));
    env.gain.setTargetAtTime(0.0001, startTime + duration, 0.3);
    oscA.connect(lp);
    oscB.connect(lp);
    lp.connect(env).connect(dest);
    oscA.start(startTime);
    oscB.start(startTime);
    oscA.stop(startTime + duration + 0.8);
    oscB.stop(startTime + duration + 0.8);
}

function playChord(
    ctx: AudioContext,
    dest: AudioNode,
    startTime: number,
    velocity: number,
    rootMidi: number,
    duration: number
): void {
    const intervals = [0, 4, 7];
    for (const interval of intervals) {
        const gain = velocityGain(velocity);
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = midiToFreq(rootMidi + interval);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2200;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, startTime);
        env.gain.exponentialRampToValueAtTime(gain * 0.14, startTime + 0.01);
        env.gain.setTargetAtTime(0.0001, startTime + duration * 0.7, 0.15);
        osc.connect(lp).connect(env).connect(dest);
        osc.start(startTime);
        osc.stop(startTime + duration + 0.3);
    }
}

function playPluck(
    ctx: AudioContext,
    dest: AudioNode,
    startTime: number,
    velocity: number,
    midi: number,
    duration: number
): void {
    const gain = velocityGain(velocity);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(midi);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = midiToFreq(midi) * 2;
    bp.Q.value = 3;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.exponentialRampToValueAtTime(gain * 0.5, startTime + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + Math.min(duration, 0.8));
    osc.connect(bp).connect(env).connect(dest);
    osc.start(startTime);
    osc.stop(startTime + Math.min(duration, 0.8) + 0.05);
}

function renderEvent(ctx: AudioContext, dest: AudioNode, event: PreviewEvent, startTime: number, beatSec: number): void {
    const velocity = event.velocity ?? 100;
    const durationSec = event.duration * beatSec;
    const voice: PreviewVoice = event.voice;
    if (voice === 'kick') {
        playKick(ctx, dest, startTime, velocity);
        return;
    }
    if (voice === 'snare') {
        playSnare(ctx, dest, startTime, velocity);
        return;
    }
    if (voice === 'hat') {
        playHat(ctx, dest, startTime, velocity, event.duration >= 0.4);
        return;
    }
    if (voice === 'bass') {
        playBass(ctx, dest, startTime, velocity, event.pitch, durationSec);
        return;
    }
    if (voice === 'lead') {
        playLead(ctx, dest, startTime, velocity, event.pitch, durationSec);
        return;
    }
    if (voice === 'pad') {
        playPad(ctx, dest, startTime, velocity, event.pitch, durationSec);
        return;
    }
    if (voice === 'chord') {
        playChord(ctx, dest, startTime, velocity, event.pitch, durationSec);
        return;
    }
    if (voice === 'pluck') {
        playPluck(ctx, dest, startTime, velocity, event.pitch, durationSec);
    }
}

type ActiveSession = {
    preview: TemplatePreview;
    gainNode: GainNode;
    nextLoopStart: number;
    schedulerHandle: ReturnType<typeof setInterval>;
    stopped: boolean;
};

export class TemplatePreviewPlayer {
    private session: ActiveSession | null = null;

    play(preview: TemplatePreview): void {
        this.stop();
        const ctx = getAudioContext();
        if (!ctx) {
            return;
        }
        void resumeEngine().catch(() => {});
        if (ctx.state === 'suspended') {
            return;
        }
        const gainNode = ctx.createGain();
        gainNode.gain.value = PREVIEW_MASTER_GAIN;
        gainNode.connect(ctx.destination);
        const startAt = ctx.currentTime + 0.05;
        const session: ActiveSession = {
            preview,
            gainNode,
            nextLoopStart: startAt,
            schedulerHandle: setInterval(() => {
                this.scheduleAhead();
            }, SCHEDULER_TICK_MS),
            stopped: false,
        };
        this.session = session;
        this.scheduleAhead();
    }

    stop(): void {
        const session = this.session;
        if (!session) {
            return;
        }
        session.stopped = true;
        clearInterval(session.schedulerHandle);
        const ctx = getAudioContext();
        if (ctx) {
            const now = ctx.currentTime;
            try {
                session.gainNode.gain.cancelScheduledValues(now);
                session.gainNode.gain.setValueAtTime(session.gainNode.gain.value, now);
                session.gainNode.gain.linearRampToValueAtTime(0.0001, now + FADE_OUT_SECONDS);
            } catch {
                session.gainNode.gain.value = 0;
            }
            setTimeout(
                () => {
                    try {
                        session.gainNode.disconnect();
                    } catch {
                        /* already disconnected */
                    }
                },
                Math.ceil(FADE_OUT_SECONDS * 1000) + 50
            );
        }
        this.session = null;
    }

    private scheduleAhead(): void {
        const session = this.session;
        if (!session || session.stopped) {
            return;
        }
        const ctx = getAudioContext();
        if (!ctx) {
            return;
        }
        const beatSec = 60 / session.preview.bpm;
        const loopBeats = session.preview.bars * 4;
        const loopSec = loopBeats * beatSec;
        const horizon = ctx.currentTime + SCHEDULE_AHEAD_SECONDS;
        while (session.nextLoopStart < horizon) {
            this.scheduleLoopIteration(ctx, session, beatSec);
            session.nextLoopStart += loopSec;
        }
    }

    private scheduleLoopIteration(ctx: AudioContext, session: ActiveSession, beatSec: number): void {
        for (const event of session.preview.events) {
            const eventStart = session.nextLoopStart + event.beat * beatSec;
            if (eventStart < ctx.currentTime - 0.01) {
                continue;
            }
            renderEvent(ctx, session.gainNode, event, eventStart, beatSec);
        }
    }
}

export const templatePreviewPlayer = new TemplatePreviewPlayer();
