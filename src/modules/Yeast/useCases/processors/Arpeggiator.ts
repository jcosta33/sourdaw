/**
 * Arpeggiator — Yeast's flagship MIDI processor.
 *
 * Takes held notes and outputs a timed pattern derived from that held set.
 * Supports modes (up/down/up-down/random/order/chord/pattern), gate, swing,
 * octave expansion, velocity modes, latch, and multiple trigger modes.
 */

import {
    type MidiEvent,
    type TransportInfo,
    type RateValue,
    rateToBeats,
    samplesPerBeat,
} from '../../models/MidiEvent';
import { type MidiProcessor, type ActiveNote, ScheduledEventQueue } from '../../models/MidiProcessor';
import { type ArpStep, createDefaultPattern } from '../../models/ArpPattern';

// ── Types ────────────────────────────────────────────────────────────────────

type HeldNote = {
    channel: number;
    note: number;
    velocity: number;
    pressedOrder: number;
};

type ArpMode = 'up' | 'down' | 'upDown' | 'downUp' | 'random' | 'order' | 'chord' | 'pattern';

type VelocityMode = 'input' | 'fixed' | 'random';

type RestartMode = 'freeRunning' | 'restartOnNote' | 'restartOnBar';

type OctaveDirection = 'up' | 'down' | 'upDown';

// ── Arpeggiator ──────────────────────────────────────────────────────────────

export class Arpeggiator implements MidiProcessor {
    readonly id: string;
    readonly name = 'Arpeggiator';

    // Parameters
    private mode: ArpMode = 'up';
    private rate: RateValue = { type: 'straight', denom: 8 };
    private gate = 0.8; // 0.01 – 2.0
    private swing = 0.0; // 0.0 – 1.0
    private octaveRange = 1; // 1 – 4
    private octaveDirection: OctaveDirection = 'up';
    private velocityMode: VelocityMode = 'input';
    private fixedVelocity = 100;
    private latchEnabled = false;
    private restartMode: RestartMode = 'restartOnNote';
    private pattern: ArpStep[] = createDefaultPattern(8);
    private bypassed = false;

    // State
    private held: HeldNote[] = [];
    private latched: HeldNote[] = [];
    private pressCounter = 0;
    private stepIndex = 0;
    private lastStepTimeSamples = -Infinity;
    private activeGenerated: ActiveNote[] = [];
    private scheduled = new ScheduledEventQueue();
    private rngState = 0xdead;

    constructor(id?: string) {
        this.id = id ?? `arp-${Date.now()}`;
    }

    // ── MidiProcessor interface ──────────────────────────────────────────

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], transport: TransportInfo): void {
        // Handle incoming Note On/Off to update held notes
        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                this.addHeldNote(event.kind.channel, event.kind.note, event.kind.velocity);
                if (this.restartMode === 'restartOnNote') {
                    this.stepIndex = 0;
                    this.lastStepTimeSamples = event.timeSamples;
                }
            } else if (event.kind.type === 'noteOff') {
                this.removeHeldNote(event.kind.channel, event.kind.note);
            } else {
                // Pass through non-note events
                output.push(event);
            }
        }

        // If no notes held (and no latch), kill active notes and stop
        const pool = this.getEffectivePool();
        if (pool.length === 0) {
            this.killActiveNotes(output, input[0]?.timeSamples ?? 0);
            return;
        }

        // Advance arp steps within the current block time range
        if (!transport.isPlaying) {
            return;
        }

        const stepLenSamples = rateToBeats(this.rate) * samplesPerBeat(transport);
        const blockEnd =
            input.length > 0
                ? Math.max(...input.map((e) => e.timeSamples)) + 128
                : transport.ppqPosition * samplesPerBeat(transport) + 128;

        // Initialize lastStepTime if needed
        if (this.lastStepTimeSamples === -Infinity) {
            this.lastStepTimeSamples = input[0]?.timeSamples ?? transport.ppqPosition * samplesPerBeat(transport);
        }

        let safety = 0;
        while (this.lastStepTimeSamples + stepLenSamples <= blockEnd && safety < 64) {
            safety++;
            const stepTime = this.lastStepTimeSamples + stepLenSamples;

            // Apply swing to odd steps
            const swingOffset = this.stepIndex % 2 === 1 ? this.swing * stepLenSamples * 0.5 : 0;
            const actualTime = stepTime + swingOffset;

            // Kill previous step's notes that should end
            this.expireNotes(output, actualTime);

            // Get pattern step (if in pattern mode)
            const patternStep = this.mode === 'pattern' ? this.pattern[this.stepIndex % this.pattern.length] : null;

            // Skip inactive or rested steps
            if (patternStep && (!patternStep.active || patternStep.stepType === 'rest')) {
                this.advanceStep(pool.length);
                this.lastStepTimeSamples = stepTime;
                continue;
            }

            // Tie: extend previous notes' duration, don't emit new Note Ons
            if (patternStep && patternStep.stepType === 'tie') {
                for (const an of this.activeGenerated) {
                    an.offTimeSamples += stepLenSamples;
                    // Also update the scheduled Note Off
                }
                // Re-schedule Note Offs with extended times
                this.scheduled.clear();
                for (const an of this.activeGenerated) {
                    this.scheduled.push({
                        timeSamples: an.offTimeSamples,
                        kind: { type: 'noteOff', channel: an.channel, note: an.note },
                    });
                }
                this.advanceStep(pool.length);
                this.lastStepTimeSamples = stepTime;
                continue;
            }

            // Probability check (pattern or global)
            if (patternStep && patternStep.probability < 1.0) {
                this.rngState = (this.rngState * 1103515245 + 12345) & 0x7fffffff;
                if (this.rngState / 0x7fffffff > patternStep.probability) {
                    this.advanceStep(pool.length);
                    this.lastStepTimeSamples = stepTime;
                    continue;
                }
            }

            // Get the note(s) for this step
            const expandedPool = this.expandOctaves(pool);
            let stepNotes = patternStep?.stepType === 'chord' ? expandedPool : this.selectStepNotes(expandedPool);

            // Apply per-step octave and semitone offsets
            if (patternStep && (patternStep.octaveOffset !== 0 || patternStep.semitoneOffset !== 0)) {
                const offset = patternStep.octaveOffset * 12 + patternStep.semitoneOffset;
                stepNotes = stepNotes.map((sn) => ({
                    ...sn,
                    note: Math.max(0, Math.min(127, sn.note + offset)),
                }));
            }

            // Emit notes (with ratchet subdivisions)
            const ratchetCount = patternStep?.ratchet ?? 1;
            const ratchetInterval = stepLenSamples / ratchetCount;
            const baseGate = patternStep ? this.gate * patternStep.gateMul : this.gate;
            const noteDuration = ratchetInterval * baseGate;

            for (let ratchetIdx = 0; ratchetIdx < ratchetCount; ratchetIdx++) {
                const ratchetTime = actualTime + ratchetIdx * ratchetInterval;

                for (const sn of stepNotes) {
                    const vel = patternStep?.velocityOverride
                        ? patternStep.velocity
                        : this.computeVelocity(sn.velocity);

                    output.push({
                        timeSamples: ratchetTime,
                        kind: { type: 'noteOn', channel: sn.channel, note: sn.note, velocity: vel },
                    });

                    // Schedule Note Off
                    const offTime = ratchetTime + noteDuration;
                    this.scheduled.push({
                        timeSamples: offTime,
                        kind: { type: 'noteOff', channel: sn.channel, note: sn.note },
                    });

                    this.activeGenerated.push({
                        sourceId: this.pressCounter,
                        channel: sn.channel,
                        note: sn.note,
                        offTimeSamples: offTime,
                    });
                }
            }

            // Advance step
            this.advanceStep(expandedPool.length);
            this.lastStepTimeSamples = stepTime;
        }

        // Drain scheduled Note Offs that fall in this block
        const drained = this.scheduled.drainRange(0, blockEnd);
        for (const e of drained) {
            output.push(e);
        }
    }

    reset(): void {
        this.held = [];
        this.latched = [];
        this.stepIndex = 0;
        this.lastStepTimeSamples = -Infinity;
        this.activeGenerated = [];
        this.scheduled.clear();
    }

    setBypassed(b: boolean): void {
        this.bypassed = b;
    }
    isBypassed(): boolean {
        return this.bypassed;
    }
    latencySamples(): number {
        return 0;
    }

    /** Set the custom arp pattern (for pattern mode). */
    setPattern(steps: ArpStep[]): void {
        this.pattern = steps;
    }

    /** Get current pattern for UI. */
    getPattern(): ArpStep[] {
        return [...this.pattern];
    }
    getCurrentStep(): number {
        return this.stepIndex;
    }

    setParam(name: string, value: number): void {
        switch (name) {
            case 'mode':
                this.mode =
                    (['up', 'down', 'upDown', 'downUp', 'random', 'order', 'chord', 'pattern'] as const)[value] ?? 'up';
                break;
            case 'rate_denom':
                this.rate = { ...this.rate, denom: Math.max(1, value) };
                break;
            case 'rate_type':
                this.rate = { ...this.rate, type: (['straight', 'dotted', 'triplet'] as const)[value] ?? 'straight' };
                break;
            case 'gate':
                this.gate = Math.max(0.01, Math.min(2.0, value));
                break;
            case 'swing':
                this.swing = Math.max(0, Math.min(1, value));
                break;
            case 'octave_range':
                this.octaveRange = Math.max(1, Math.min(4, Math.round(value)));
                break;
            case 'octave_direction':
                this.octaveDirection = (['up', 'down', 'upDown'] as const)[value] ?? 'up';
                break;
            case 'velocity_mode':
                this.velocityMode = (['input', 'fixed', 'random'] as const)[value] ?? 'input';
                break;
            case 'fixed_velocity':
                this.fixedVelocity = Math.max(1, Math.min(127, Math.round(value)));
                break;
            case 'latch':
                this.latchEnabled = value > 0.5;
                break;
            case 'restart_mode':
                this.restartMode =
                    (['freeRunning', 'restartOnNote', 'restartOnBar'] as const)[value] ?? 'restartOnNote';
                break;
        }
    }

    // ── Internal ─────────────────────────────────────────────────────────

    private addHeldNote(channel: number, note: number, velocity: number): void {
        // Avoid duplicates
        if (this.held.some((h) => h.channel === channel && h.note === note)) {
            return;
        }

        this.pressCounter++;
        const hn: HeldNote = { channel, note, velocity, pressedOrder: this.pressCounter };
        this.held.push(hn);

        if (this.latchEnabled) {
            this.latched = [...this.held];
        }
    }

    private removeHeldNote(channel: number, note: number): void {
        this.held = this.held.filter((h) => !(h.channel === channel && h.note === note));
    }

    private getEffectivePool(): HeldNote[] {
        if (this.latchEnabled) {
            return this.held.length > 0 ? this.held : this.latched;
        }
        return this.held;
    }

    private expandOctaves(pool: HeldNote[]): HeldNote[] {
        if (this.octaveRange <= 1) {
            return pool;
        }

        const expanded: HeldNote[] = [];
        const octaves: number[] = [];

        if (this.octaveDirection === 'up') {
            for (let o = 0; o < this.octaveRange; o++) octaves.push(o);
        } else if (this.octaveDirection === 'down') {
            for (let o = 0; o > -this.octaveRange; o--) octaves.push(o);
        } else {
            for (let o = 0; o < this.octaveRange; o++) octaves.push(o);
            for (let o = this.octaveRange - 2; o > 0; o--) octaves.push(o);
        }

        for (const oct of octaves) {
            for (const hn of pool) {
                const note = hn.note + oct * 12;
                if (note >= 0 && note <= 127) {
                    expanded.push({ ...hn, note });
                }
            }
        }

        return expanded;
    }

    private selectStepNotes(pool: HeldNote[]): HeldNote[] {
        if (pool.length === 0) {
            return [];
        }

        // Sort pool by pitch for Up/Down modes, by press order for Order mode
        const byPitch = [...pool].sort((a, b) => a.note - b.note);
        const byOrder = [...pool].sort((a, b) => a.pressedOrder - b.pressedOrder);

        switch (this.mode) {
            case 'up':
                return [byPitch[this.stepIndex % byPitch.length]!];
            case 'down':
                return [byPitch[byPitch.length - 1 - (this.stepIndex % byPitch.length)]!];
            case 'upDown': {
                const idx = this.reflectedIndex(this.stepIndex, byPitch.length);
                return [byPitch[idx]!];
            }
            case 'downUp': {
                const idx = byPitch.length - 1 - this.reflectedIndex(this.stepIndex, byPitch.length);
                return [byPitch[Math.max(0, idx)]!];
            }
            case 'random': {
                this.rngState = (this.rngState * 1103515245 + 12345) & 0x7fffffff;
                const idx = this.rngState % byPitch.length;
                return [byPitch[idx]!];
            }
            case 'order':
                return [byOrder[this.stepIndex % byOrder.length]!];
            case 'chord':
                return byPitch;
            case 'pattern': {
                // In pattern mode, use "next" note selection by default
                return [byPitch[this.stepIndex % byPitch.length]!];
            }
        }
    }

    private reflectedIndex(step: number, len: number): number {
        if (len <= 1) {
            return 0;
        }
        const cycle = (len - 1) * 2;
        const pos = step % cycle;
        return pos < len ? pos : cycle - pos;
    }

    private advanceStep(poolSize: number): void {
        if (poolSize === 0) {
            return;
        }
        this.stepIndex++;
    }

    private computeVelocity(inputVel: number): number {
        switch (this.velocityMode) {
            case 'input':
                return inputVel;
            case 'fixed':
                return this.fixedVelocity;
            case 'random': {
                this.rngState = (this.rngState * 1103515245 + 12345) & 0x7fffffff;
                return 40 + (this.rngState % 88); // 40-127
            }
        }
    }

    private killActiveNotes(output: MidiEvent[], now: number): void {
        for (const an of this.activeGenerated) {
            output.push({
                timeSamples: now,
                kind: { type: 'noteOff', channel: an.channel, note: an.note },
            });
        }
        this.activeGenerated = [];
        this.scheduled.clear();
    }

    private expireNotes(output: MidiEvent[], now: number): void {
        const expired = this.activeGenerated.filter((n) => n.offTimeSamples <= now);
        for (const n of expired) {
            output.push({
                timeSamples: n.offTimeSamples,
                kind: { type: 'noteOff', channel: n.channel, note: n.note },
            });
        }
        this.activeGenerated = this.activeGenerated.filter((n) => n.offTimeSamples > now);
    }
}
