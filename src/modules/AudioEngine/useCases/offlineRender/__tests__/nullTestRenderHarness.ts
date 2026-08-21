/**
 * A deterministic, *sample-producing* model of Web Audio, built so two
 * production graph-construction paths can be rendered and subtracted.
 *
 * ── What this is for ──────────────────────────────────────────────────────
 *
 * The question `liveOfflineNullTest.spec.ts` asks is "does an export sound like
 * the session?". Answering it needs samples out of both runtimes, and nothing
 * in the suite could produce them: jsdom has no Web Audio, and `setupTests.ts`
 * supplies only enough of one for `instanceof` checks and node construction.
 * Every existing live/offline parity spec therefore asserts a *call shape* —
 * `toasterLiveOfflineParity.spec.ts` stubs `getTrackStrip` outright, so the live
 * side is never built at all — and a projection that is wrong but
 * self-consistent passes all of them.
 *
 * `src/helpers/__tests__/offlineWorkletRenderHarness.ts` renders, and is the
 * right instrument for the question it was built for ("did the transport
 * deliver any energy at all?"). It cannot answer this one, by its own
 * declaration: its `AudioParam`s are `vi.fn()` no-ops, its delay lines do not
 * delay, its oscillators emit one fixed-frequency sine whatever waveform and
 * pitch they were given, and it has no filter, waveshaper or analyser. A null
 * test run on it would report a clean null for a fixture whose filter cutoff
 * differed by an octave, because neither side would filter — and for one whose
 * waveform differed, because both would come back a sine. An instrument that
 * cannot see the parameter under test is worse than none.
 *
 * ── What it models, and what that buys ────────────────────────────────────
 *
 * Every node whose *output depends on a parameter the two paths might set
 * differently* is implemented for real:
 *
 *   - `GainNode`               multiplies.
 *   - `StereoPannerNode`       the spec's stereo equal-power law.
 *   - `BiquadFilterNode`       the spec's transfer functions, running
 *                              direct-form-1 with per-node state across quanta.
 *   - `WaveShaperNode`         the spec's curve lookup with linear interpolation.
 *   - `AnalyserNode`           pass-through, which is what it is.
 *   - `AudioWorkletNode`       runs the real registered processor's `process()`.
 *   - `AudioBufferSourceNode`  starts when it was told to, reads from the offset
 *                              it was given, stops once it has consumed the
 *                              source duration it was handed (the spec's
 *                              playback algorithm — so `d / r`
 *                              of the timeline at rate `r`), and interpolates
 *                              between frames at a non-unity rate. Only on a
 *                              `scheduled` context — see the automation
 *                              sections below.
 *
 * A node type nothing here models throws on construction rather than degrading
 * to a pass-through. That is deliberate: a silently-inert node turns this from a
 * null test into a shape test, which is the defect the whole file exists to stop
 * repeating. Adding a fixture device that needs a compressor or a delay line
 * means implementing it here first.
 *
 * **The throw alone does not reach the caller on the offline leg, and must not
 * be relied on there.** `buildDeviceChain` catches every construction failure,
 * routes it to `onWarning` and `continue`s (`buildDeviceChain.ts:254-296`), so
 * the device is dropped and the render *succeeds* — `builtin-delay`,
 * `builtin-compressor`, `builtin-reverb` and `builtin-tremolo` all null to
 * `-Infinity` against a bare strip that way, because neither leg has the device.
 * That is correct production behaviour, not a harness bug: an export degrades
 * rather than refusing. It means the *fixture* has to be what refuses.
 * `liveOfflineNullTest.spec.ts` does that in `renderOffline` — an `onWarning`
 * that throws, plus a post-build check that every fixtured device id is present
 * in `deviceEntries`. Any new caller of this harness owes the same two guards.
 *
 * ── What it is not ────────────────────────────────────────────────────────
 *
 * It is a model, not Chromium. `oversample` is ignored, block-rate is used where
 * the spec says a-rate, and no absolute output of this harness should be
 * compared against a browser's. That costs nothing for the measurement being
 * made, because **both legs run through the same model**: what is measured is
 * the difference between two production construction paths, and the model
 * cancels out of the subtraction. A residual it reports is a real divergence in
 * `src/`. A null it reports is proof that the two paths configure the graph
 * identically — not proof that an un-modelled browser behaviour also agrees.
 *
 * **The cancellation is conditional on both legs being this model, and one
 * caller's are not**: `renderOfflineNativeParity.spec.ts` subtracts a native
 * render from a harness render, so there every modelled shortcut is measured
 * rather than cancelled. A shortcut taken here on the grounds that "no fixture
 * exercises it" therefore has to be revisited, not restated, when a fixture
 * does — which is why the panner below reads its position a-rate.
 *
 * ── Automation is settled, not glided ─────────────────────────────────────
 *
 * `AudioParam` records writes and reports the value the last write targets.
 * `startRendering()` settles every param before the first quantum.
 *
 * This is the difference between comparing the product and comparing the test
 * setup. Live writes the fader with `setTargetAtTime(v, now, 0.01)` and offline
 * assigns `.value` outright, so a harness that glided would show a ~100 ms
 * exponential residual at the head of every render — an artefact of choosing to
 * press play at t=0, not of anything the product does. A user's export is
 * compared against playback with the mixer *at rest*, and that is the state
 * modelled here. It costs no sensitivity to the thing under test: settling
 * collapses to the value live actually wrote, so a live target that differs from
 * the offline assignment still reds. Automation *during* a render is a different
 * property with its own specs (`automationScheduling`, `offlineVcaGainParity`).
 *
 * **The settle is where a cancel-and-replace sequence comes to rest**, which is
 * what makes it an instrument for `ramp-to` and `hold` rather than a blind spot:
 * `cancelScheduledValues(t)` drops the events at or after `t` exactly as the
 * spec has it, so a backend that appends instead of replacing rests on a stale
 * target and a backend that ignores a `hold` rests on the ramp the hold was
 * supposed to drop. What settling cannot see is the *path* between two writes.
 *
 * ── Opt-in: automation the render actually walks ──────────────────────────
 *
 * A clip fade is a shape, not a resting value: a `fadeGain` that settled would
 * hold the fade-out's final `0` for the whole render and the clip would be
 * silent. A context constructed with `{ automation: 'scheduled' }` therefore
 * skips the settle and evaluates each param's timeline at render time —
 * per sample for a gain and a pan, once per quantum elsewhere.
 *
 * It is opt-in, and must stay opt-in, for the reason the settle exists: the live
 * writers glide, so a globally-scheduled harness would put a ~100 ms exponential
 * at the head of every existing null. Both legs of any one subtraction run in
 * the same mode, so the choice cancels out of the measurement exactly as the
 * rest of the model does.
 */

import { vi } from 'vitest';

/** The Web Audio render quantum. */
const QUANTUM_FRAMES = 128;

/**
 * How a context resolves its parameters. See the two automation sections in the
 * module header.
 */
export type HarnessAutomationMode = 'settled' | 'scheduled';

type ScheduledWriteKind = 'step' | 'linear' | 'exponential' | 'target';

type ScheduledWrite = {
    kind: ScheduledWriteKind;
    time: number;
    target: number;
    /** τ, for `setTargetAtTime`. Ignored by every other kind. */
    timeConstant: number;
    /** Insertion order, so two writes at one time resolve to the later one. */
    sequence: number;
};

/** The exponential approach `setTargetAtTime` leaves running until the next event. */
type ActiveApproach = { from: number; target: number; timeConstant: number; startTime: number };

/**
 * Records what was written, reports where the graph comes to rest, and — when
 * the context asked for it — reports where the graph *is* at a given time.
 *
 * See the automation notes in the module header for why rest is the default
 * state this harness renders and why walking the timeline is opt-in.
 */
class HarnessAudioParam {
    private readonly writes: ScheduledWrite[] = [];
    private settled = false;
    private sortedWrites: ScheduledWrite[] | null = null;
    private sequence = 0;

    constructor(
        public value: number,
        private readonly mode: HarnessAutomationMode = 'settled'
    ) {}

    setValueAtTime(target: number, time: number): void {
        this.record('step', target, time, 0);
    }
    linearRampToValueAtTime(target: number, time: number): void {
        this.record('linear', target, time, 0);
    }
    exponentialRampToValueAtTime(target: number, time: number): void {
        this.record('exponential', target, time, 0);
    }
    setTargetAtTime(target: number, time: number, timeConstant: number): void {
        this.record('target', target, time, timeConstant);
    }

    /**
     * Drop every event at or after `time`, per the spec's
     * `AudioParam.cancelScheduledValues` — **not** every
     * event.
     *
     * The difference is the whole content of the contract's cancel-and-replace
     * write: `applyParameterWrite` re-anchors with `setValueAtTime(param.value,
     * startTime)` immediately after cancelling, and a cancel that wiped the past
     * as well would make that anchor the only surviving history of the
     * parameter. Modelling it as "clear everything" happens to produce the same
     * resting value for a well-behaved backend, which is exactly why it has to
     * be right: the fixture would be green either way and blind to the law.
     */
    cancelScheduledValues(time: number): void {
        for (let index = this.writes.length - 1; index >= 0; index--) {
            if (this.writes[index]!.time >= time) {
                this.writes.splice(index, 1);
            }
        }
        this.sortedWrites = null;
    }

    setValueCurveAtTime(curve: Float32Array, time: number, _duration: number): void {
        const last = curve.at(-1);
        if (last !== undefined) {
            this.record('step', last, time, 0);
        }
    }

    /** Collapse the recorded writes into `value`. Idempotent. */
    settle(): void {
        if (this.settled) {
            return;
        }
        this.settled = true;
        let latest: ScheduledWrite | null = null;
        for (const write of this.writes) {
            if (!latest || write.time >= latest.time) {
                latest = write;
            }
        }
        if (latest) {
            this.value = latest.target;
        }
    }

    /**
     * The parameter's value at `time`.
     *
     * In `settled` mode this is `value` by construction — the settle already
     * collapsed the timeline — so every existing fixture reads exactly what it
     * read before. In `scheduled` mode it walks the events.
     */
    sample(time: number): number {
        if (this.mode === 'settled' || this.writes.length === 0) {
            return this.value;
        }

        let current = this.value;
        let cursor = 0;
        let approach: ActiveApproach | null = null;

        function valueAt(at: number): number {
            if (!approach) {
                return current;
            }
            if (approach.timeConstant <= 0) {
                return approach.target;
            }
            return (
                approach.target +
                (approach.from - approach.target) * Math.exp(-(at - approach.startTime) / approach.timeConstant)
            );
        }

        for (const event of this.sorted()) {
            if (event.time > time) {
                // The segment that contains `time` ends at this event. A ramp is
                // the only kind whose value depends on where in the segment we
                // are; anything else holds what the previous event left.
                if (event.kind === 'linear' || event.kind === 'exponential') {
                    const span = event.time - cursor;
                    const fraction = span > 0 ? Math.min(1, Math.max(0, (time - cursor) / span)) : 1;
                    const from = valueAt(cursor);
                    if (event.kind === 'linear') {
                        return from + (event.target - from) * fraction;
                    }
                    // The spec's `exponentialRampToValueAtTime` refuses a ramp
                    // through zero;
                    // a from-value of zero degrades to the linear reading rather
                    // than producing a NaN the render would carry everywhere.
                    if (from === 0 || event.target === 0 || from * event.target < 0) {
                        return from + (event.target - from) * fraction;
                    }
                    return from * (event.target / from) ** fraction;
                }
                return valueAt(time);
            }

            const at = valueAt(event.time);
            if (event.kind === 'target') {
                approach = {
                    from: at,
                    target: event.target,
                    timeConstant: event.timeConstant,
                    startTime: event.time,
                };
            } else {
                approach = null;
                current = event.target;
            }
            cursor = event.time;
        }
        return valueAt(time);
    }

    private sorted(): ScheduledWrite[] {
        this.sortedWrites ??= [...this.writes].sort(
            (left, right) => left.time - right.time || left.sequence - right.sequence
        );
        return this.sortedWrites;
    }

    private record(kind: ScheduledWriteKind, target: number, time: number, timeConstant: number): void {
        this.writes.push({ kind, time, target, timeConstant, sequence: this.sequence++ });
        this.sortedWrites = null;
    }
}

/**
 * The rate param the buffer source reads as a plain `.value` — its
 * `transform` never walks the timeline, so a scheduled write here would be
 * recorded and then silently ignored, the silent-inert-node failure this
 * module exists to refuse. Scheduling therefore throws until the node samples
 * the timeline. A constant rate — what a stretched clip sets — is a plain
 * `.value` write and is unaffected.
 */
class HarnessPlaybackRateParam extends HarnessAudioParam {
    private static refuse(): never {
        throw new Error(
            'nullTestRenderHarness: AudioBufferSourceNode.playbackRate is read as a plain value; ' +
                'a scheduled write would be silently ignored — teach the node to sample the timeline first'
        );
    }

    override setValueAtTime(): never {
        HarnessPlaybackRateParam.refuse();
    }
    override linearRampToValueAtTime(): never {
        HarnessPlaybackRateParam.refuse();
    }
    override exponentialRampToValueAtTime(): never {
        HarnessPlaybackRateParam.refuse();
    }
    override setTargetAtTime(): never {
        HarnessPlaybackRateParam.refuse();
    }
    override setValueCurveAtTime(): never {
        HarnessPlaybackRateParam.refuse();
    }
}

type StereoBlock = { left: Float32Array; right: Float32Array };

class HarnessAudioNode {
    numberOfInputs = 1;
    numberOfOutputs = 1;
    /** Upstream edges, in connect order. */
    readonly inputs: HarnessAudioNode[] = [];
    /** Downstream edges. Kept in step with `inputs` so `disconnect` is real. */
    readonly outputs: HarnessAudioNode[] = [];
    protected readonly out: StereoBlock = {
        left: new Float32Array(QUANTUM_FRAMES),
        right: new Float32Array(QUANTUM_FRAMES),
    };
    /** The quantum `out` currently holds, and the one `transform()` is shaping. */
    protected renderedQuantum = -1;

    /**
     * One argument, one kind of destination — anything else throws.
     *
     * Web Audio's `connect` also takes output/input indices and accepts an
     * `AudioParam` as a destination. Production uses both:
     * `connectOfflineSidechainRoutes.ts:70` connects to input 1 of a two-input
     * node. Modelling those as "push an edge and ignore the index" would make an
     * indexed connect silently collapse onto input 0, and a source→param connect
     * silently become no edge at all — a fixture using either would render
     * confidently wrong audio. Refusing is the same discipline the unmodelled
     * node constructors follow.
     */
    connect(destination: unknown, ...indices: unknown[]): unknown {
        if (indices.length > 0) {
            throw new Error(
                'nullTestRenderHarness models no indexed connect(); it would collapse onto input 0. ' +
                    'Model multi-input routing before fixturing a device that needs it.'
            );
        }
        if (!(destination instanceof HarnessAudioNode)) {
            throw new Error(
                'nullTestRenderHarness models no connect() to an AudioParam or foreign node; the edge ' +
                    'would silently not exist. Model param-rate modulation before fixturing a device that needs it.'
            );
        }
        destination.inputs.push(this);
        this.outputs.push(destination);
        return destination;
    }

    /**
     * Real edge removal, not a no-op. `TrackNode.rebuildChain` tears the whole
     * strip down and rewires it on every device change; a harness that ignored
     * `disconnect()` would leave the pre-rebuild edges in place and render each
     * strip summed with a stale copy of itself.
     */
    disconnect(destination?: unknown): void {
        const targets = destination instanceof HarnessAudioNode ? [destination] : [...this.outputs];
        for (const target of targets) {
            removeFirst(target.inputs, this);
            removeFirst(this.outputs, target);
        }
    }

    render(quantum: number): StereoBlock {
        if (this.renderedQuantum === quantum) {
            return this.out;
        }
        // Marked before recursing so a fan-out is summed once per quantum rather
        // than once per edge.
        //
        // It also stops a cycle spinning the stack, but note what it renders
        // instead: `out` is zeroed on the next two lines *before* the recursion,
        // so a node re-entered through a feedback edge hands back silence — not
        // the previous quantum's block, which is what a real delay-line feedback
        // path would carry. No fixtured device has a cycle, and none can be
        // added until this models a one-quantum delay, or the loop will render
        // quiet and look correct.
        this.renderedQuantum = quantum;
        this.out.left.fill(0);
        this.out.right.fill(0);
        for (const source of this.inputs) {
            const block = source.render(quantum);
            for (let index = 0; index < QUANTUM_FRAMES; index++) {
                this.out.left[index] = this.out.left[index]! + block.left[index]!;
                this.out.right[index] = this.out.right[index]! + block.right[index]!;
            }
        }
        this.transform();
        return this.out;
    }

    protected transform(): void {}
}

function removeFirst(list: HarnessAudioNode[], entry: HarnessAudioNode): void {
    const index = list.indexOf(entry);
    if (index >= 0) {
        list.splice(index, 1);
    }
}

/**
 * The one node evaluated at a-rate.
 *
 * Everything a fade, a ramp or a mixer move writes lands on a gain, and a fade
 * read once per quantum would quantise a 3 ms anti-click micro-fade to a single
 * step. In `settled` mode `sample()` returns the resting value for every frame,
 * so this loop is the same multiply it always was.
 */
class HarnessGainNode extends HarnessAudioNode {
    constructor(
        readonly gain: HarnessAudioParam,
        private readonly sampleRate: number
    ) {
        super();
    }

    protected override transform(): void {
        const startFrame = this.renderedQuantum * QUANTUM_FRAMES;
        for (let index = 0; index < QUANTUM_FRAMES; index++) {
            const level = this.gain.sample((startFrame + index) / this.sampleRate);
            if (level === 1) {
                continue;
            }
            this.out.left[index] = this.out.left[index]! * level;
            this.out.right[index] = this.out.right[index]! * level;
        }
    }
}

/**
 * The spec's `StereoPannerNode` panning algorithm, the stereo-input branch.
 *
 * A-rate, as the spec defines `pan`: the position is read once per frame, not
 * once per quantum. An earlier revision read it per quantum on the reasoning
 * that no fixture moves a pan lane inside one — which held only because every
 * fixture time landed on a quantum boundary at 48 kHz. It stops holding the
 * moment a fixture renders at another rate (44 100 is not a multiple of 128),
 * and a block-rate read then quantises a step to the next boundary and reads
 * as a backend divergence that is really the model's.
 */
class HarnessStereoPannerNode extends HarnessAudioNode {
    constructor(
        readonly pan: HarnessAudioParam,
        private readonly sampleRate: number
    ) {
        super();
    }

    protected override transform(): void {
        const startFrame = this.renderedQuantum * QUANTUM_FRAMES;
        for (let index = 0; index < QUANTUM_FRAMES; index++) {
            const position = Math.max(-1, Math.min(1, this.pan.sample((startFrame + index) / this.sampleRate)));
            const x = position <= 0 ? position + 1 : position;
            const gainLeft = Math.cos((x * Math.PI) / 2);
            const gainRight = Math.sin((x * Math.PI) / 2);
            const left = this.out.left[index]!;
            const right = this.out.right[index]!;
            if (position <= 0) {
                this.out.left[index] = left + right * gainLeft;
                this.out.right[index] = right * gainRight;
            } else {
                this.out.left[index] = left * gainLeft;
                this.out.right[index] = right + left * gainRight;
            }
        }
    }
}

type BiquadCoefficients = { b0: number; b1: number; b2: number; a1: number; a2: number };

/**
 * The spec's `BiquadFilterNode` filter characteristics. `Q` is interpreted in
 * dB for lowpass/highpass, as the spec
 * requires, and linearly elsewhere — the two are different numbers and a
 * harness that used one everywhere would be insensitive to `filter-resonance`
 * on exactly the device most likely to carry it.
 */
function biquadCoefficients(input: {
    type: string;
    frequency: number;
    q: number;
    gainDb: number;
    sampleRate: number;
}): BiquadCoefficients {
    const w0 = (2 * Math.PI * input.frequency) / input.sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alphaQ = sinW0 / (2 * input.q);
    const alphaQdB = sinW0 / (2 * 10 ** (input.q / 20));
    const amplitude = 10 ** (input.gainDb / 40);

    function normalize(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): BiquadCoefficients {
        return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
    }

    if (input.type === 'lowpass') {
        const b1 = 1 - cosW0;
        return normalize(b1 / 2, b1, b1 / 2, 1 + alphaQdB, -2 * cosW0, 1 - alphaQdB);
    }
    if (input.type === 'highpass') {
        const b1 = -(1 + cosW0);
        return normalize(-b1 / 2, b1, -b1 / 2, 1 + alphaQdB, -2 * cosW0, 1 - alphaQdB);
    }
    if (input.type === 'bandpass') {
        return normalize(alphaQ, 0, -alphaQ, 1 + alphaQ, -2 * cosW0, 1 - alphaQ);
    }
    if (input.type === 'notch') {
        return normalize(1, -2 * cosW0, 1, 1 + alphaQ, -2 * cosW0, 1 - alphaQ);
    }
    if (input.type === 'peaking') {
        return normalize(
            1 + alphaQ * amplitude,
            -2 * cosW0,
            1 - alphaQ * amplitude,
            1 + alphaQ / amplitude,
            -2 * cosW0,
            1 - alphaQ / amplitude
        );
    }
    if (input.type === 'lowshelf' || input.type === 'highshelf') {
        const alphaS = (sinW0 / 2) * Math.SQRT2;
        const twoSqrtAAlpha = 2 * Math.sqrt(amplitude) * alphaS;
        const sign = input.type === 'lowshelf' ? 1 : -1;
        return normalize(
            amplitude * (amplitude + 1 - sign * (amplitude - 1) * cosW0 + twoSqrtAAlpha),
            2 * sign * amplitude * (amplitude - 1 - sign * (amplitude + 1) * cosW0),
            amplitude * (amplitude + 1 - sign * (amplitude - 1) * cosW0 - twoSqrtAAlpha),
            amplitude + 1 + sign * (amplitude - 1) * cosW0 + twoSqrtAAlpha,
            -2 * sign * (amplitude - 1 + sign * (amplitude + 1) * cosW0),
            amplitude + 1 + sign * (amplitude - 1) * cosW0 - twoSqrtAAlpha
        );
    }
    throw new Error(`nullTestRenderHarness models no biquad type "${input.type}"`);
}

class HarnessBiquadFilterNode extends HarnessAudioNode {
    type = 'lowpass';
    private coefficients: BiquadCoefficients | null = null;
    private readonly state = [
        { x1: 0, x2: 0, y1: 0, y2: 0 },
        { x1: 0, x2: 0, y1: 0, y2: 0 },
    ];

    constructor(
        readonly frequency: HarnessAudioParam,
        readonly Q: HarnessAudioParam,
        readonly gain: HarnessAudioParam,
        readonly detune: HarnessAudioParam,
        private readonly sampleRate: number
    ) {
        super();
    }

    protected override transform(): void {
        // Coefficients are computed once, from the parameters as they stand at
        // the head of the render. A filter whose cutoff is automated mid-render
        // is out of scope for this model either way; see the module header.
        const at = (this.renderedQuantum * QUANTUM_FRAMES) / this.sampleRate;
        this.coefficients ??= biquadCoefficients({
            type: this.type,
            frequency: this.frequency.sample(at) * 2 ** (this.detune.sample(at) / 1200),
            q: this.Q.sample(at),
            gainDb: this.gain.sample(at),
            sampleRate: this.sampleRate,
        });
        const { b0, b1, b2, a1, a2 } = this.coefficients;
        const channels: Array<keyof StereoBlock> = ['left', 'right'];
        for (const [channel, key] of channels.entries()) {
            const data = this.out[key];
            const state = this.state[channel]!;
            for (let index = 0; index < QUANTUM_FRAMES; index++) {
                const x0 = data[index]!;
                const y0 = b0 * x0 + b1 * state.x1 + b2 * state.x2 - a1 * state.y1 - a2 * state.y2;
                state.x2 = state.x1;
                state.x1 = x0;
                state.y2 = state.y1;
                state.y1 = y0;
                data[index] = y0;
            }
        }
    }
}

/** The spec's `WaveShaperNode`. `oversample` is ignored; see the module header. */
class HarnessWaveShaperNode extends HarnessAudioNode {
    curve: Float32Array | null = null;
    oversample = 'none';

    protected override transform(): void {
        const { curve } = this;
        if (!curve || curve.length === 0) {
            return;
        }
        const lastIndex = curve.length - 1;
        const channels: Array<keyof StereoBlock> = ['left', 'right'];
        for (const key of channels) {
            const data = this.out[key];
            for (let index = 0; index < QUANTUM_FRAMES; index++) {
                const clamped = Math.max(-1, Math.min(1, data[index]!));
                const position = ((clamped + 1) / 2) * lastIndex;
                const lower = Math.min(lastIndex, Math.floor(position));
                const upper = Math.min(lastIndex, lower + 1);
                const fraction = position - lower;
                data[index] = curve[lower]! + fraction * (curve[upper]! - curve[lower]!);
            }
        }
    }
}

/** Pass-through, which is all an analyser is in the signal path. */
class HarnessAnalyserNode extends HarnessAudioNode {
    fftSize = 2048;
    smoothingTimeConstant = 0.8;
    get frequencyBinCount(): number {
        return this.fftSize / 2;
    }
    getFloatTimeDomainData(data: Float32Array): void {
        data.fill(0);
    }
    getFloatFrequencyData(data: Float32Array): void {
        data.fill(-Infinity);
    }
}

type HarnessPort = {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: (message: unknown) => void;
    close: () => void;
};

type HarnessProcessorLike = {
    process: (inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) => boolean;
};

function createPortPair(): { outer: HarnessPort; inner: HarnessPort } {
    const outer: HarnessPort = {
        onmessage: null,
        postMessage: (message) => inner.onmessage?.({ data: message } as MessageEvent),
        close: () => {},
    };
    const inner: HarnessPort = {
        onmessage: null,
        postMessage: (message) => outer.onmessage?.({ data: message } as MessageEvent),
        close: () => {},
    };
    return { outer, inner };
}

export type HarnessContextOptions = {
    /** Defaults to `settled`. See the two automation sections in the header. */
    automation?: HarnessAutomationMode;
};

export type NullTestRenderHarness = {
    /**
     * Install the `AudioWorkletGlobalScope` globals a processor module reads at
     * import time. Call before importing any processor module.
     */
    installWorkletGlobals: (input: { sampleRate: number }) => void;
    /** Stub as the global `OfflineAudioContext`. */
    OfflineAudioContext: new (
        numberOfChannels: number,
        length: number,
        sampleRate: number,
        options?: HarnessContextOptions
    ) => HarnessRenderContext;
    /** Stub as the global `AudioWorkletNode`. */
    AudioWorkletNode: new (context: unknown, processorName: string, options?: AudioWorkletNodeOptions) => unknown;
    registeredProcessorNames: () => string[];
};

export type HarnessRenderContext = {
    destination: HarnessAudioNode;
    sampleRate: number;
    length: number;
    currentTime: number;
    createGain: () => unknown;
    createStereoPanner: () => unknown;
    createBiquadFilter: () => unknown;
    createWaveShaper: () => unknown;
    createAnalyser: () => unknown;
    createBufferSource: () => unknown;
    /** A fixed, pre-computed stereo signal. Not part of Web Audio; see `createSignalSource`. */
    createSignalSource: (samples: { left: Float32Array; right: Float32Array }) => HarnessAudioNode;
    startRendering: () => Promise<RenderedBuffer>;
};

/**
 * The shape `scheduleOfflineClipSource` reads off an `AudioBuffer`.
 *
 * Structural rather than the DOM type because jsdom has no `AudioBuffer` to
 * construct, and the four members below are the whole of what the clip path
 * touches. `createFixtureAudioBuffer` builds one.
 */
export type HarnessAudioBuffer = {
    sampleRate: number;
    length: number;
    duration: number;
    numberOfChannels: number;
    getChannelData: (channel: number) => Float32Array;
};

export type RenderedBuffer = {
    sampleRate: number;
    length: number;
    numberOfChannels: number;
    getChannelData: (channel: number) => Float32Array;
};

export function createNullTestRenderHarness(): NullTestRenderHarness {
    const processorRegistry = new Map<string, new () => HarnessProcessorLike>();
    let pendingProcessorPort: HarnessPort | null = null;
    let harnessFrame = 0;

    class AudioWorkletProcessorShim {
        readonly port: HarnessPort;
        constructor() {
            if (!pendingProcessorPort) {
                throw new Error('AudioWorkletProcessor was constructed outside a harness worklet node');
            }
            this.port = pendingProcessorPort;
        }
    }

    class HarnessAudioWorkletNode extends HarnessAudioNode {
        readonly port: HarnessPort;
        readonly parameters = new Map<string, HarnessAudioParam>();
        private readonly processor: HarnessProcessorLike;
        private readonly scratch: StereoBlock = {
            left: new Float32Array(QUANTUM_FRAMES),
            right: new Float32Array(QUANTUM_FRAMES),
        };

        constructor(_context: unknown, processorName: string, options?: AudioWorkletNodeOptions) {
            super();
            this.numberOfInputs = options?.numberOfInputs ?? 1;
            const Processor = processorRegistry.get(processorName);
            if (!Processor) {
                throw new Error(`AudioWorklet processor "${processorName}" is not registered with the harness`);
            }
            const { outer, inner } = createPortPair();
            this.port = outer;
            pendingProcessorPort = inner;
            try {
                this.processor = new Processor();
            } finally {
                pendingProcessorPort = null;
            }
        }

        protected override transform(): void {
            // A real processor reads `inputs` and writes `outputs`; handing it the
            // same arrays for both would let a pass-through look correct while a
            // processor that accumulates silently doubled.
            this.scratch.left.set(this.out.left);
            this.scratch.right.set(this.out.right);
            this.out.left.fill(0);
            this.out.right.fill(0);
            this.processor.process([[this.scratch.left, this.scratch.right]], [[this.out.left, this.out.right]], {});
        }
    }

    class HarnessSignalSourceNode extends HarnessAudioNode {
        override numberOfInputs = 0;
        private frame = 0;

        constructor(private readonly samples: { left: Float32Array; right: Float32Array }) {
            super();
        }

        protected override transform(): void {
            for (let index = 0; index < QUANTUM_FRAMES; index++) {
                const position = this.frame + index;
                this.out.left[index] = this.samples.left[position] ?? 0;
                this.out.right[index] = this.samples.right[position] ?? 0;
            }
            this.frame += QUANTUM_FRAMES;
        }
    }

    /**
     * A real `AudioBufferSourceNode`: it starts when it was told to, reads from
     * the offset it was given, and stops once it has consumed the *source*
     * duration it was handed.
     *
     * The unit of that third argument is the whole of the spec's
     * `AudioBufferSourceNode.start(when, offset, duration)` contract: `start`'s
     * `duration` is measured in the buffer's own time, so a clip handed `d` at
     * rate `r` sounds for `d / r` of the destination timeline. Modelling it as a
     * destination span reads the same at rate 1 — every fixture here would stay
     * green — and hides every stretched clip's length, which is why it is
     * modelled in source frames even though nothing but the stretched fixture
     * can tell the difference.
     *
     * Those three numbers are the whole content of a clip command, so a model
     * that ignored any of them would let a backend schedule a clip at the wrong
     * place and still null. `start()` is refused twice, as Web Audio refuses it,
     * because a second start on one node is a graph the product cannot build.
     *
     * ── Rate conversion ───────────────────────────────────────────────────
     *
     * The buffer's own rate is the fourth number. Web Audio resamples material
     * decoded at another rate onto the context's clock, which is the same law
     * as an added playback rate of `buffer.sampleRate / context.sampleRate`:
     * the read head advances that many *source* frames per rendered frame, so
     * the material keeps its pitch and its duration in seconds. `offset` and
     * `duration` are both measured in the buffer's own time, so both resolve
     * against the buffer's rate, not the context's — which is why they are
     * held here in seconds and converted where the buffer is known. At an
     * equal-rate buffer every quantity collapses to what it was before.
     */
    class HarnessAudioBufferSourceNode extends HarnessAudioNode {
        override numberOfInputs = 0;
        buffer: HarnessAudioBuffer | null = null;
        readonly playbackRate: HarnessAudioParam;
        private startFrame: number | null = null;
        /** Source seconds, per `start`'s second argument. */
        private offsetSeconds = 0;
        /** Source seconds, per `start`'s third argument. */
        private durationSourceSeconds = Infinity;
        /** Destination frame `stop()` cuts the sound off at, in its own unit. */
        private stopFrame = Infinity;

        constructor(
            playbackRate: HarnessAudioParam,
            private readonly sampleRate: number
        ) {
            super();
            this.playbackRate = playbackRate;
        }

        start(when = 0, offset = 0, duration?: number): void {
            if (this.startFrame !== null) {
                throw new Error('nullTestRenderHarness: AudioBufferSourceNode.start() called twice');
            }
            this.startFrame = Math.round(when * this.sampleRate);
            this.offsetSeconds = offset;
            this.durationSourceSeconds = duration ?? Infinity;
        }

        stop(when = 0): void {
            this.stopFrame = Math.min(this.stopFrame, Math.max(this.startFrame ?? 0, when * this.sampleRate));
        }

        protected override transform(): void {
            const { buffer, startFrame } = this;
            if (!buffer || startFrame === null) {
                return;
            }
            // The buffer's rate against the context's is the resampling half
            // of the read rate; the node's own `playbackRate` is the other.
            const rate = this.playbackRate.value * (buffer.sampleRate / this.sampleRate);
            const offsetFrames = this.offsetSeconds * buffer.sampleRate;
            const durationSourceFrames = this.durationSourceSeconds * buffer.sampleRate;
            const left = buffer.getChannelData(0);
            const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
            const blockStart = this.renderedQuantum * QUANTUM_FRAMES;
            for (let index = 0; index < QUANTUM_FRAMES; index++) {
                const frame = blockStart + index;
                const elapsed = frame - startFrame;
                if (elapsed < 0 || frame >= this.stopFrame) {
                    continue;
                }
                // The read head, in source frames since the offset. It is also
                // what `duration` bounds, so the two are compared in one unit.
                const consumed = elapsed * rate;
                if (consumed >= durationSourceFrames) {
                    continue;
                }
                // Linear interpolation, because a non-unity rate lands between
                // frames. At rate 1 with an integral start the position is
                // integral and this reads the sample itself.
                const position = offsetFrames + consumed;
                const lower = Math.floor(position);
                if (lower < 0 || lower >= buffer.length) {
                    continue;
                }
                const upper = Math.min(buffer.length - 1, lower + 1);
                const fraction = position - lower;
                this.out.left[index] = left[lower]! + fraction * (left[upper]! - left[lower]!);
                this.out.right[index] = right[lower]! + fraction * (right[upper]! - right[lower]!);
            }
        }
    }

    class HarnessOfflineAudioContext implements HarnessRenderContext {
        readonly destination = new HarnessAudioNode();
        readonly audioWorklet = { addModule: (): Promise<void> => Promise.resolve() };
        currentTime = 0;
        state = 'suspended';
        private readonly params: HarnessAudioParam[] = [];
        private readonly automation: HarnessAutomationMode;

        constructor(
            readonly numberOfChannels: number,
            readonly length: number,
            readonly sampleRate: number,
            options: HarnessContextOptions = {}
        ) {
            this.automation = options.automation ?? 'settled';
        }

        private param(value: number): HarnessAudioParam {
            const param = new HarnessAudioParam(value, this.automation);
            this.params.push(param);
            return param;
        }

        createGain(): HarnessGainNode {
            return new HarnessGainNode(this.param(1), this.sampleRate);
        }
        createStereoPanner(): HarnessStereoPannerNode {
            return new HarnessStereoPannerNode(this.param(0), this.sampleRate);
        }
        createBiquadFilter(): HarnessBiquadFilterNode {
            return new HarnessBiquadFilterNode(
                this.param(350),
                this.param(1),
                this.param(0),
                this.param(0),
                this.sampleRate
            );
        }
        /**
         * Refused outside `scheduled` mode, and the refusal is the point.
         *
         * A clip's `fadeGain` is driven entirely by scheduled writes, and a
         * settled param collapses them to the fade-out's final `0` — so a clip
         * fixture on a settled context renders silence, nulls against another
         * silence, and reports a green that means nothing.
         */
        createBufferSource(): HarnessAudioBufferSourceNode {
            if (this.automation !== 'scheduled') {
                throw new Error(
                    'nullTestRenderHarness: an AudioBufferSourceNode needs a context constructed with ' +
                        "{ automation: 'scheduled' }; a settled context collapses its fade envelope to silence"
                );
            }
            const rate = new HarnessPlaybackRateParam(1, this.automation);
            this.params.push(rate);
            return new HarnessAudioBufferSourceNode(rate, this.sampleRate);
        }
        createWaveShaper(): HarnessWaveShaperNode {
            return new HarnessWaveShaperNode();
        }
        createAnalyser(): HarnessAnalyserNode {
            return new HarnessAnalyserNode();
        }
        createSignalSource(samples: { left: Float32Array; right: Float32Array }): HarnessAudioNode {
            return new HarnessSignalSourceNode(samples);
        }

        // Unmodelled constructors throw rather than degrade. See the module header.
        createDelay(): never {
            throw new Error(
                'nullTestRenderHarness models no DelayNode — implement one before fixturing a device that needs it'
            );
        }
        createDynamicsCompressor(): never {
            throw new Error(
                'nullTestRenderHarness models no DynamicsCompressorNode — implement one before fixturing a device that needs it'
            );
        }
        createConvolver(): never {
            throw new Error(
                'nullTestRenderHarness models no ConvolverNode — implement one before fixturing a device that needs it'
            );
        }
        createOscillator(): never {
            throw new Error(
                'nullTestRenderHarness models no OscillatorNode — implement one before fixturing a device that needs it'
            );
        }

        async startRendering(): Promise<RenderedBuffer> {
            if (this.automation === 'settled') {
                for (const param of this.params) {
                    param.settle();
                }
            }
            const left = new Float32Array(this.length);
            const right = new Float32Array(this.length);
            for (let frame = 0; frame < this.length; frame += QUANTUM_FRAMES) {
                harnessFrame = frame;
                this.currentTime = frame / this.sampleRate;
                const block = this.destination.render(frame / QUANTUM_FRAMES);
                const count = Math.min(QUANTUM_FRAMES, this.length - frame);
                left.set(block.left.subarray(0, count), frame);
                right.set(block.right.subarray(0, count), frame);
            }
            const channels = [left, right];
            return await Promise.resolve({
                sampleRate: this.sampleRate,
                length: this.length,
                numberOfChannels: 2,
                getChannelData: (channel: number) => channels[channel] ?? left,
            });
        }
    }

    return {
        installWorkletGlobals: ({ sampleRate }) => {
            Object.defineProperty(globalThis, 'currentFrame', { configurable: true, get: () => harnessFrame });
            Object.defineProperty(globalThis, 'sampleRate', { configurable: true, get: () => sampleRate });
            vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
            vi.stubGlobal('registerProcessor', (name: string, processor: new () => HarnessProcessorLike) => {
                processorRegistry.set(name, processor);
            });
        },
        OfflineAudioContext: HarnessOfflineAudioContext,
        AudioWorkletNode: HarnessAudioWorkletNode,
        registeredProcessorNames: () => [...processorRegistry.keys()],
    };
}

/** Peak absolute sample across every channel, as a linear amplitude. */
function peakAmplitude(buffer: RenderedBuffer): number {
    let peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        for (const sample of data) {
            const magnitude = Math.abs(sample);
            if (magnitude > peak) {
                peak = magnitude;
            }
        }
    }
    return peak;
}

/** `20·log₁₀`, with a true zero reported as `-Infinity` rather than clamped. */
function amplitudeToDbfs(amplitude: number): number {
    if (amplitude === 0) {
        return -Infinity;
    }
    return 20 * Math.log10(amplitude);
}

export type NullTestResult = {
    /** Peak of `a − b`, in dBFS. `-Infinity` when the two renders are bit-identical. */
    residualPeakDbfs: number;
    /** Peak of `a`, in dBFS. The presence pin: a null against silence is not a null. */
    signalPeakDbfs: number;
    /** Frame index of the largest residual sample, for locating a divergence. */
    worstFrame: number;
};

/**
 * Subtract two renders sample-for-sample and report the peak of what is left.
 *
 * `signalPeakDbfs` is not decoration. Per ADR 0015 rule 4, an assertion that a
 * residual is absent is satisfied forever by two renders that are both silent —
 * which is precisely the failure `renderTrackSubgraphOffline` shipped (97–99 %
 * silence, INVENTORY-device-clock-parity G-1). Every caller must pin the signal.
 */
export function nullTest(input: { a: RenderedBuffer; b: RenderedBuffer }): NullTestResult {
    const { a, b } = input;
    if (a.length !== b.length || a.numberOfChannels !== b.numberOfChannels) {
        throw new Error(
            `nullTest needs two renders of the same shape; got ${a.numberOfChannels}×${a.length} and ${b.numberOfChannels}×${b.length}`
        );
    }
    let residual = 0;
    let worstFrame = -1;
    for (let channel = 0; channel < a.numberOfChannels; channel++) {
        const left = a.getChannelData(channel);
        const right = b.getChannelData(channel);
        for (let frame = 0; frame < a.length; frame++) {
            const difference = Math.abs(left[frame]! - right[frame]!);
            if (difference > residual) {
                residual = difference;
                worstFrame = frame;
            }
        }
    }
    return {
        residualPeakDbfs: amplitudeToDbfs(residual),
        signalPeakDbfs: amplitudeToDbfs(peakAmplitude(a)),
        worstFrame,
    };
}

/**
 * The fixture signal: broadband, deterministic, and different per channel.
 *
 * Broadband because a filter fixture is only tested by content at the cutoff;
 * deterministic because a null test that is nondeterministic proves nothing;
 * and asymmetric across channels because a pan-law divergence is invisible on a
 * mono-correlated signal. Generated from a plain LCG rather than `Math.random`
 * so two calls in the same run produce identical samples, which is what lets the
 * two legs be fed independent source nodes carrying the same audio.
 */
export function createFixtureSignal(input: { frames: number; sampleRate: number }): {
    left: Float32Array;
    right: Float32Array;
} {
    const left = new Float32Array(input.frames);
    const right = new Float32Array(input.frames);
    let seed = 0x2f6e_2b1;
    for (let frame = 0; frame < input.frames; frame++) {
        seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
        const noise = (seed / 0xffff_ffff) * 2 - 1;
        const time = frame / input.sampleRate;
        left[frame] = 0.25 * Math.sin(2 * Math.PI * 220 * time) + 0.1 * noise;
        right[frame] = 0.25 * Math.sin(2 * Math.PI * 330 * time + 0.7) + 0.1 * noise;
    }
    return { left, right };
}

/**
 * The fixture signal as clip material.
 *
 * The same generator as {@link createFixtureSignal}, so a clip fixture carries
 * the broadband, channel-asymmetric content the rest of the file relies on, and
 * so the material two legs read is identical sample for sample rather than
 * merely statistically alike.
 */
export function createFixtureAudioBuffer(input: { frames: number; sampleRate: number }): HarnessAudioBuffer {
    const { left, right } = createFixtureSignal(input);
    const channels = [left, right];
    return {
        sampleRate: input.sampleRate,
        length: input.frames,
        duration: input.frames / input.sampleRate,
        numberOfChannels: 2,
        getChannelData: (channel: number) => channels[channel] ?? left,
    };
}
