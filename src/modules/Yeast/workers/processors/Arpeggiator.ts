/**
 * Arpeggiator — Yeast's flagship MIDI processor.
 *
 * Takes held notes and outputs a timed pattern derived from that held set.
 * Supports modes (up/down/up-down/random/order/chord/pattern), gate, swing,
 * octave expansion, velocity modes, latch, and multiple trigger modes.
 */

import {
    type ArpStep,
    createDefaultPattern,
    decodeArpPatternParams,
    DEFAULT_ARP_PATTERN_LENGTH,
} from '../../models/ArpPattern';
import {
    type MidiEvent,
    type TransportInfo,
    type RateValue,
    rateToBeats,
    samplesPerBeat,
} from '../../models/MidiEvent';
import { YEAST_PREVIEW_CAPACITY } from '../../models/YeastPreviewSnapshot';
import { BaseMidiProcessor } from '../BaseMidiProcessor';
import { LCG_MAX, nextLcg } from '../lcgRandom';
import {
    type ActiveNote,
    type MidiProcessorParams,
    EMIT_FALLBACK_BLOCK_SPAN_SAMPLES,
    resolveBlockEndSamples,
    ScheduledEventQueue,
} from '../MidiProcessor';

import type { YeastPreviewDecisionSink } from '../YeastPreviewSidecar';

// ── Types ────────────────────────────────────────────────────────────────────

type HeldNote = {
    channel: number;
    note: number;
    velocity: number;
    pressedOrder: number;
    trackId?: string;
    noteInstanceId?: string;
};

type ArpMode = 'up' | 'down' | 'upDown' | 'downUp' | 'random' | 'order' | 'chord' | 'pattern';

type VelocityMode = 'input' | 'fixed' | 'random';

type RestartMode = 'freeRunning' | 'restartOnNote' | 'restartOnBar';

type OctaveDirection = 'up' | 'down' | 'upDown';

// ── Arpeggiator ──────────────────────────────────────────────────────────────

export class Arpeggiator extends BaseMidiProcessor {
    readonly name = 'Arpeggiator';
    readonly providesPreviewDecisions = true;

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
    private pattern: ArpStep[] = createDefaultPattern(DEFAULT_ARP_PATTERN_LENGTH);
    // State
    private held: HeldNote[] = [];
    private latched: HeldNote[] = [];
    private pressCounter = 0;
    private stepIndex = 0;
    private lastStepTimeSamples = -Infinity;
    private activeGenerated: ActiveNote[] = [];
    private scheduled = new ScheduledEventQueue();
    // Reused across blocks so the per-block scheduled drain allocates nothing.
    private readonly drainScratch: MidiEvent[] = [];
    private rngState = 0xdead;
    private readonly rejectedPitch = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly rejectedVelocity = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly rejectedChannel = new Uint8Array(YEAST_PREVIEW_CAPACITY);
    private readonly rejectedTrackId: Array<string | undefined> = Array.from(
        { length: YEAST_PREVIEW_CAPACITY },
        () => undefined
    );
    private rejectedCandidateCount = 0;

    constructor(id?: string) {
        super(id ?? `arp-${Date.now()}`);
    }

    // ── MidiProcessor interface ──────────────────────────────────────────

    processMidi(
        input: readonly MidiEvent[],
        output: MidiEvent[],
        transport: TransportInfo,
        preview?: YeastPreviewDecisionSink
    ): void {
        // Handle incoming Note On/Off to update held notes
        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                this.addHeldNote(
                    event.kind.channel,
                    event.kind.note,
                    event.kind.velocity,
                    event.trackId,
                    event.noteInstanceId
                );
                if (this.restartMode === 'restartOnNote') {
                    this.stepIndex = 0;
                    this.lastStepTimeSamples = event.timeSamples;
                }
            } else if (event.kind.type === 'noteOff') {
                this.removeHeldNote(event.kind.channel, event.kind.note, event.trackId, event.noteInstanceId);
            } else {
                // Pass through non-note events
                output.push(event);
            }
        }

        const blockStart = transport.blockStartSamples ?? transport.ppqPosition * samplesPerBeat(transport);
        const blockEnd = resolveBlockEndSamples(transport, blockStart, EMIT_FALLBACK_BLOCK_SPAN_SAMPLES);

        const pool = this.getEffectivePool();
        if (pool.length === 0) {
            this.drainScheduledNoteOffs(output, blockEnd);
            return;
        }

        // Advance arp steps within the current block time range
        if (!transport.isPlaying) {
            return;
        }

        const stepLenSamples = rateToBeats(this.rate) * samplesPerBeat(transport);

        // Initialize lastStepTime if needed
        if (this.lastStepTimeSamples === -Infinity) {
            this.lastStepTimeSamples = input[0]?.timeSamples ?? blockStart;
        }

        // Strictly `<`: the block is half-open, so a step landing exactly on
        // `blockEnd` belongs to the next block, not this one.
        let safety = 0;
        while (this.lastStepTimeSamples + stepLenSamples < blockEnd && safety < 64) {
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

            // Tied lifetime was reserved on the preceding Note On.
            if (patternStep && patternStep.stepType === 'tie') {
                this.advanceStep(pool.length);
                this.lastStepTimeSamples = stepTime;
                continue;
            }

            // Keep the probability rejection ahead of candidate materialization.
            // Disabled capture takes the original allocation-free fast path;
            // enabled capture writes rejected candidates through fixed scratch.
            if (patternStep && patternStep.probability < 1.0) {
                this.rngState = nextLcg(this.rngState);
                if (this.rngState / LCG_MAX > patternStep.probability) {
                    const expandedCount = this.countExpandedNotes(pool);
                    if (preview) {
                        this.recordRejectedStep(preview, pool, patternStep, actualTime, stepLenSamples);
                    }
                    this.advanceStep(expandedCount);
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
            const finalNoteDuration = noteDuration + this.countFollowingTieSteps() * stepLenSamples;

            for (let ratchetIdx = 0; ratchetIdx < ratchetCount; ratchetIdx++) {
                const ratchetTime = actualTime + ratchetIdx * ratchetInterval;

                for (const sn of stepNotes) {
                    const vel = patternStep?.velocityOverride
                        ? patternStep.velocity
                        : this.computeVelocity(sn.velocity);

                    const noteInstanceId = this.createGeneratedNoteInstanceId();
                    const noteOn: MidiEvent = {
                        timeSamples: ratchetTime,
                        durationSamples: finalNoteDuration,
                        trackId: sn.trackId,
                        noteInstanceId,
                        kind: { type: 'noteOn', channel: sn.channel, note: sn.note, velocity: vel },
                    };
                    output.push(noteOn);

                    preview?.recordDecision(
                        ratchetTime,
                        finalNoteDuration,
                        sn.note,
                        vel,
                        patternStep?.probability ?? null,
                        true,
                        this.id,
                        sn.trackId,
                        noteOn
                    );

                    // Schedule Note Off
                    const offTime = ratchetTime + finalNoteDuration;
                    this.scheduled.push({
                        timeSamples: offTime,
                        trackId: sn.trackId,
                        noteInstanceId,
                        kind: { type: 'noteOff', channel: sn.channel, note: sn.note },
                    });

                    this.activeGenerated.push({
                        channel: sn.channel,
                        note: sn.note,
                        noteInstanceId,
                        offTimeSamples: offTime,
                        trackId: sn.trackId,
                    });
                }
            }

            // Advance step
            this.advanceStep(expandedPool.length);
            this.lastStepTimeSamples = stepTime;
        }

        // Drain scheduled Note Offs that fall in this block, and drop the
        // matching activeGenerated entries: expireNotes must not re-emit
        // these offs at a later step boundary. The two stores are kept in
        // sync in both directions so every generated note gets exactly one
        // Note Off (pre-fix each off left twice — once via expireNotes,
        // once via this drain; 8 ons → 14 offs in the audit probe).
        this.drainScheduledNoteOffs(output, blockEnd);
    }

    reset(): void {
        this.held = [];
        this.latched = [];
        this.stepIndex = 0;
        this.lastStepTimeSamples = -Infinity;
        this.activeGenerated = [];
        this.scheduled.clear();
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

    protected resetParams(): void {
        this.mode = 'up';
        this.rate = { type: 'straight', denom: 8 };
        this.gate = 0.8;
        this.swing = 0;
        this.octaveRange = 1;
        this.octaveDirection = 'up';
        this.velocityMode = 'input';
        this.fixedVelocity = 100;
        this.latchEnabled = false;
        this.restartMode = 'restartOnNote';
        this.pattern = createDefaultPattern(DEFAULT_ARP_PATTERN_LENGTH);
    }

    /**
     * The pattern is carried by the `pattern_`-prefixed params rather than by a
     * single `setParam` name: one step spans eleven fields, so the value is a
     * whole record, not a scalar. Decoding once here — after the base class has
     * reset the params and applied every scalar — keeps a single decode path
     * and leaves `setParam` a pure scalar switch. A projection whose params
     * carry no `pattern_len` decodes to the default pattern, which is exactly
     * what `resetParams` just installed.
     */
    replaceParams(params: MidiProcessorParams): void {
        super.replaceParams(params);
        this.setPattern(decodeArpPatternParams(params));
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

    private addHeldNote(
        channel: number,
        note: number,
        velocity: number,
        trackId?: string,
        noteInstanceId?: string
    ): void {
        if (
            noteInstanceId !== undefined &&
            this.held.some((heldNote) => heldNote.trackId === trackId && heldNote.noteInstanceId === noteInstanceId)
        ) {
            return;
        }

        this.pressCounter++;
        const hn: HeldNote = { channel, note, velocity, pressedOrder: this.pressCounter, trackId, noteInstanceId };
        this.held.push(hn);

        if (this.latchEnabled) {
            // Audio-thread note: shallow copy of small held-notes array (typically <12 items).
            // Low-impact allocation — pre-allocated ring buffer not warranted for this size.
            this.latched = [...this.held];
        }
    }

    private removeHeldNote(channel: number, note: number, trackId?: string, noteInstanceId?: string): void {
        // Audio-thread: in-place removal avoids allocating a new array
        const idx = this.held.findIndex((heldNote) => {
            if (noteInstanceId !== undefined) {
                return heldNote.trackId === trackId && heldNote.noteInstanceId === noteInstanceId;
            }
            return (
                heldNote.trackId === trackId &&
                heldNote.channel === channel &&
                heldNote.note === note &&
                heldNote.noteInstanceId === undefined
            );
        });
        if (idx !== -1) {
            this.held.splice(idx, 1);
        }
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
            for (let output = 0; output < this.octaveRange; output++) {
                octaves.push(output);
            }
        } else if (this.octaveDirection === 'down') {
            for (let output = 0; output > -this.octaveRange; output--) {
                octaves.push(output);
            }
        } else {
            for (let output = 0; output < this.octaveRange; output++) {
                octaves.push(output);
            }
            for (let output = this.octaveRange - 2; output > 0; output--) {
                octaves.push(output);
            }
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
        const byPitch = [...pool].sort((alpha, b) => alpha.note - b.note);
        const byOrder = [...pool].sort((alpha, b) => alpha.pressedOrder - b.pressedOrder);

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
                this.rngState = nextLcg(this.rngState);
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
        return [];
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

    private countFollowingTieSteps(): number {
        if (this.mode !== 'pattern' || this.pattern.length < 2) {
            return 0;
        }
        let count = 0;
        for (let offset = 1; offset < this.pattern.length; offset++) {
            const step = this.pattern[(this.stepIndex + offset) % this.pattern.length];
            if (!step?.active || step.stepType !== 'tie') {
                break;
            }
            count++;
        }
        return count;
    }

    private computeVelocity(inputVel: number): number {
        switch (this.velocityMode) {
            case 'input':
                return inputVel;
            case 'fixed':
                return this.fixedVelocity;
            case 'random': {
                this.rngState = nextLcg(this.rngState);
                return 40 + (this.rngState % 88); // 40-127
            }
        }
        return inputVel;
    }

    private previewVelocity(inputVelocity: number, step: ArpStep): number {
        if (step.velocityOverride) {
            return step.velocity;
        }
        if (this.velocityMode === 'fixed') {
            return this.fixedVelocity;
        }
        return inputVelocity;
    }

    private countExpandedNotes(pool: readonly HeldNote[]): number {
        let count = 0;
        if (this.octaveDirection === 'down') {
            for (let octave = 0; octave > -this.octaveRange; octave--) {
                count += this.countExpandedNotesAtOctave(pool, octave);
            }
            return count;
        }
        for (let octave = 0; octave < this.octaveRange; octave++) {
            count += this.countExpandedNotesAtOctave(pool, octave);
        }
        if (this.octaveDirection === 'upDown') {
            for (let octave = this.octaveRange - 2; octave > 0; octave--) {
                count += this.countExpandedNotesAtOctave(pool, octave);
            }
        }
        return count;
    }

    private countExpandedNotesAtOctave(pool: readonly HeldNote[], octave: number): number {
        let count = 0;
        for (let index = 0; index < pool.length; index++) {
            const pitch = pool[index]!.note + octave * 12;
            if (pitch >= 0 && pitch <= 127) {
                count += 1;
            }
        }
        return count;
    }

    private recordRejectedStep(
        preview: YeastPreviewDecisionSink,
        pool: readonly HeldNote[],
        step: ArpStep,
        actualTime: number,
        stepLenSamples: number
    ): void {
        this.fillRejectedCandidates(pool);
        this.sortRejectedCandidates();
        const ratchetCount = step.ratchet;
        const ratchetInterval = stepLenSamples / ratchetCount;
        const noteDuration =
            ratchetInterval * this.gate * step.gateMul + this.countFollowingTieSteps() * stepLenSamples;
        const candidateStart = step.stepType === 'chord' ? 0 : this.stepIndex % this.rejectedCandidateCount;
        const candidateEnd = step.stepType === 'chord' ? this.rejectedCandidateCount : candidateStart + 1;
        const pitchOffset = step.octaveOffset * 12 + step.semitoneOffset;

        for (let ratchetIndex = 0; ratchetIndex < ratchetCount; ratchetIndex++) {
            const ratchetTime = actualTime + ratchetIndex * ratchetInterval;
            for (let index = candidateStart; index < candidateEnd; index++) {
                preview.recordDecision(
                    ratchetTime,
                    noteDuration,
                    Math.max(0, Math.min(127, this.rejectedPitch[index]! + pitchOffset)),
                    this.previewVelocity(this.rejectedVelocity[index]!, step),
                    step.probability,
                    false,
                    this.id,
                    this.rejectedTrackId[index]
                );
            }
        }
    }

    private fillRejectedCandidates(pool: readonly HeldNote[]): void {
        this.rejectedCandidateCount = 0;
        if (this.octaveDirection === 'down') {
            for (let octave = 0; octave > -this.octaveRange; octave--) {
                this.appendRejectedOctave(pool, octave);
            }
            return;
        }
        for (let octave = 0; octave < this.octaveRange; octave++) {
            this.appendRejectedOctave(pool, octave);
        }
        if (this.octaveDirection === 'upDown') {
            for (let octave = this.octaveRange - 2; octave > 0; octave--) {
                this.appendRejectedOctave(pool, octave);
            }
        }
    }

    private appendRejectedOctave(pool: readonly HeldNote[], octave: number): void {
        for (let index = 0; index < pool.length; index++) {
            if (this.rejectedCandidateCount === YEAST_PREVIEW_CAPACITY) {
                return;
            }
            const held = pool[index]!;
            const pitch = held.note + octave * 12;
            if (pitch < 0 || pitch > 127) {
                continue;
            }
            const slot = this.rejectedCandidateCount++;
            this.rejectedPitch[slot] = pitch;
            this.rejectedVelocity[slot] = held.velocity;
            this.rejectedChannel[slot] = held.channel;
            this.rejectedTrackId[slot] = held.trackId;
        }
    }

    private sortRejectedCandidates(): void {
        for (let index = 1; index < this.rejectedCandidateCount; index++) {
            let cursor = index;
            while (cursor > 0 && this.rejectedPitch[cursor - 1]! > this.rejectedPitch[cursor]!) {
                const previousPitch = this.rejectedPitch[cursor - 1]!;
                const previousVelocity = this.rejectedVelocity[cursor - 1]!;
                const previousChannel = this.rejectedChannel[cursor - 1]!;
                const previousTrackId = this.rejectedTrackId[cursor - 1];
                this.rejectedPitch[cursor - 1] = this.rejectedPitch[cursor]!;
                this.rejectedVelocity[cursor - 1] = this.rejectedVelocity[cursor]!;
                this.rejectedChannel[cursor - 1] = this.rejectedChannel[cursor]!;
                this.rejectedTrackId[cursor - 1] = this.rejectedTrackId[cursor];
                this.rejectedPitch[cursor] = previousPitch;
                this.rejectedVelocity[cursor] = previousVelocity;
                this.rejectedChannel[cursor] = previousChannel;
                this.rejectedTrackId[cursor] = previousTrackId;
                cursor -= 1;
            }
        }
    }

    private expireNotes(output: MidiEvent[], now: number): void {
        // Audio-thread: in-place removal avoids two .filter() allocations
        let writeIdx = 0;
        for (let index = 0; index < this.activeGenerated.length; index++) {
            const node = this.activeGenerated[index]!;
            if (node.offTimeSamples <= now) {
                output.push({
                    timeSamples: node.offTimeSamples,
                    trackId: node.trackId,
                    noteInstanceId: node.noteInstanceId,
                    kind: { type: 'noteOff', channel: node.channel, note: node.note },
                });
                // Keep the scheduled queue in sync: the off is emitted here,
                // so the queue must not re-emit it at the block-end drain.
                this.scheduled.removeNoteOff(
                    node.trackId,
                    node.channel,
                    node.note,
                    node.offTimeSamples,
                    node.noteInstanceId
                );
            } else {
                this.activeGenerated[writeIdx] = node;
                writeIdx++;
            }
        }
        this.activeGenerated.length = writeIdx;
    }

    private drainScheduledNoteOffs(output: MidiEvent[], blockEnd: number): void {
        const drained = this.drainScratch;
        drained.length = 0;
        this.scheduled.drainRangeInto(0, blockEnd, drained, this.trackId);
        for (const event of drained) {
            output.push(event);
            if (event.kind.type === 'noteOff') {
                this.removeActiveGenerated(
                    event.trackId,
                    event.kind.channel,
                    event.kind.note,
                    event.timeSamples,
                    event.noteInstanceId
                );
            }
        }
        drained.length = 0;
    }

    private removeActiveGenerated(
        trackId: string | undefined,
        channel: number,
        note: number,
        offTimeSamples: number,
        noteInstanceId?: string
    ): void {
        const idx = this.activeGenerated.findIndex(
            (an) =>
                an.trackId === trackId &&
                an.channel === channel &&
                an.note === note &&
                an.offTimeSamples === offTimeSamples &&
                (noteInstanceId === undefined || an.noteInstanceId === noteInstanceId)
        );
        if (idx !== -1) {
            this.activeGenerated.splice(idx, 1);
        }
    }
}
