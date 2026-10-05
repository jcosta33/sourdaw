/**
 * Grand Boule engine core shared by two host designs.
 *
 *  - **Live** the WASM engine runs in a Worker and publishes rendered blocks into a
 *    SharedArrayBuffer ring that a consumer worklet drains. A Grand Boule
 *    overload starves its own ring and only Grand Boule drops out; the rest of
 *    the session keeps its deadline.
 *  - **Offline** the engine runs inside an `AudioWorkletProcessor`.
 *    An `OfflineAudioContext` has no system-level audio callback and therefore no
 *    load value and no underrun (Web Audio §2.6), so the ring protects against a
 *    deadline that does not exist — while its back-pressure and its
 *    consumer-offset plane can collapse an export into silence.
 *
 * Every serious plugin API formalises the same split: VST3
 * `ProcessSetup::processMode`, CLAP `clap_plugin_render`. What must *not* differ
 * is the engine and its control surface, and this module is where that is
 * enforced. Both hosts import it; neither may re-implement it.
 *
 * ## Isolation, and why this file lives in `worklets/`
 *
 * It may import `../wasm/daw_dsp.js` and nothing else. One of its two hosts is an
 * `AudioWorkletGlobalScope`, which has no DOM, no `fetch` and no app module
 * graph; the other is a Worker under the same rule. An import added here that
 * reaches into `src/app`, `src/helpers` or another module breaks both.
 *
 * `worklets/` is where that constraint is enforced rather than merely described.
 * `deps:validate` bans `workers/` from importing `services/` — where the DSP
 * processors otherwise live — because a Worker must stay clear of business and
 * runtime code, and this file has to be reachable from *both* hosts.
 * `worklets/` and `workers/` are the two isolated private folders, each barred
 * from the same runtime list and each permitted to import the other, so it is
 * the only home that lets one implementation serve both without weakening a
 * boundary. It also activates a folder the dependency config has been
 * provisioning for exactly this.
 *
 * ## What compile-time enforcement buys
 *
 * `dispatch` switches exhaustively over `GrandBouleDispatchMsg` and ends in a
 * `never` arm, so adding a message type without handling it fails `pnpm
 * typecheck` instead of silently doing nothing in one host. Message drift is the
 * failure `tsc` can catch. Render-loop drift — the two ~30-line loops that differ
 * in trigger, output target and clock — is the accepted residual, and it is what
 * `grandBouleDispatchParity.spec.ts` exists for.
 */

import { initSync, GrandBouleInstance } from '../wasm/daw_dsp.js';

/** Voice ceiling both hosts construct the engine with. */
export const GRAND_BOULE_VOICE_COUNT = 64;

/** Map camelCase param names from TypeScript to snake_case for Rust. */
export const PARAM_MAP: Record<string, string> = {
    masterGain: 'master_gain',
    soundboardSend: 'soundboard_send',
    sympatheticSend: 'sympathetic_send',
    lidPosition: 'lid_position',
    micPosition: 'mic_position',
    stretchAmount: 'stretch_amount',
    attackBite: 'attack_bite',
    velocityCurve: 'velocity_curve',
    hammerHardnessScale: 'hammer_hardness_scale',
    hammerMassScale: 'hammer_mass_scale',
    soundboardBrightness: 'soundboard_brightness',
    sympatheticLevel: 'sympathetic_level',
    bodyResonance: 'body_resonance',
    toneColor: 'tone_color',
};

export type GrandBouleNoteOnMsg = {
    type: 'noteOn';
    midiNote: number;
    velocity: number;
    sampleFrame?: number;
    channel?: number;
};

export type GrandBouleNoteOffMsg = {
    type: 'noteOff';
    midiNote: number;
    sampleFrame?: number;
    releaseVelocity?: number;
    channel?: number;
};

export type GrandBouleNoteExpressionMsg = {
    type: 'noteExpression';
    midiNote: number;
    channel: number;
    bendSemitones: number;
    pressure: number;
    slide: number;
    sampleFrame?: number;
};

export type GrandBouleParamMsg = { type: 'param'; name: string; value: number; sampleFrame?: number };

export type GrandBouleSustainMsg = { type: 'sustain'; position: number; sampleFrame?: number };

export type GrandBouleUnaCordaMsg = { type: 'unaCorda'; engaged: boolean; sampleFrame?: number };

export type GrandBouleSostenutoMsg = { type: 'sostenuto'; engaged: boolean; sampleFrame?: number };

export type GrandBoulePedalMsg = GrandBouleSustainMsg | GrandBouleUnaCordaMsg | GrandBouleSostenutoMsg;

/** Messages that address a moment in time rather than only the device. */
export type GrandBouleFramedMsg =
    | GrandBouleNoteOnMsg
    | GrandBouleNoteOffMsg
    | GrandBouleNoteExpressionMsg
    | GrandBouleParamMsg
    | GrandBouleSustainMsg
    | GrandBouleUnaCordaMsg
    | GrandBouleSostenutoMsg;

/** A framed message that actually carries a usable frame, so it can be queued. */
export type GrandBouleQueuedMsg = GrandBouleFramedMsg & { sampleFrame: number };

export type GrandBouleDispatchMsg =
    | GrandBouleNoteOnMsg
    | GrandBouleNoteOffMsg
    | GrandBouleNoteExpressionMsg
    | GrandBouleParamMsg
    | GrandBouleSustainMsg
    | GrandBouleUnaCordaMsg
    | GrandBouleSostenutoMsg
    | { type: 'noteOnMidi2'; midiNote: number; velocity16bit: number; pitchOffsetQ24: number }
    | { type: 'temperament'; index: number }
    | { type: 'allNotesOff' };

export type CreateGrandBouleInstanceInput = {
    /** The compiled `daw-dsp` module, shared by the node factory across hosts. */
    wasmModule: WebAssembly.Module;
    /** The host clock's rate: the worker is told it, a worklet reads `sampleRate`. */
    sampleRate: number;
};

export type CreateGrandBouleInstanceOutput = {
    instance: GrandBouleInstance;
    /**
     * The engine's linear memory. Read `memory.buffer` fresh every block — a
     * Rust-side allocation grows it and detaches the previous `ArrayBuffer`
     * (audit RT-7).
     */
    memory: WebAssembly.Memory;
};

/**
 * Instantiate the WASM engine. Both hosts use the same voice ceiling and path.
 */
export function createGrandBouleInstance({
    wasmModule,
    sampleRate,
}: CreateGrandBouleInstanceInput): CreateGrandBouleInstanceOutput {
    const exports = initSync({ module: wasmModule });
    return {
        instance: new GrandBouleInstance(sampleRate, GRAND_BOULE_VOICE_COUNT),
        memory: exports.memory,
    };
}

export type GrandBouleBlockViews = {
    /** The engine's left output for the block `update` was last called for. */
    readonly left: Float32Array;
    /** The engine's right output for the block `update` was last called for. */
    readonly right: Float32Array;
    /**
     * Point `left` and `right` at the block the engine just rendered, reusing
     * the cached views whenever the backing buffer, the pointers and the length
     * are unchanged. Pass `memory.buffer` read fresh after `process()`.
     *
     * Returns nothing on purpose: handing back a tuple would allocate an array
     * per block on the hit path and give back exactly what the cache saved.
     */
    update: (buffer: ArrayBufferLike, leftPtr: number, rightPtr: number, frames: number) => void;
};

/**
 * A pair of cached WASM linear-memory views over one rendered block.
 *
 * `new Float32Array(memory.buffer, ptr, length)` allocates even though it copies
 * nothing, so minting a pair per quantum feeds the GC on the render thread. The
 * views are rebuilt only when they must be: first block, a changed pointer or
 * block size, or — the correctness case, audit RT-7 — a `memory.grow()` that
 * *detached* the previous `ArrayBuffer` and left the cached view zero-length.
 * Growth shows up as a new buffer identity, which is why the caller must read
 * `memory.buffer` fresh each block and pass it in.
 *
 * This is the same contract as `services/wasmView.ts`, which the other seven
 * processors use, and it is restated rather than imported: `deps:validate`
 * forbids both `worklets/` and `workers/` from importing `services/`, and this
 * module has to be reachable from both. Consolidating one level up would move a
 * file thirty-one others depend on. In exchange both Grand Boule hosts now share
 * one cache — the engine Worker was allocating a fresh pair every block.
 *
 * **Shared blind spot, inherited deliberately.** Buffer *identity* is the growth
 * signal, and that only holds for a non-shared `WebAssembly.Memory`, where
 * `grow()` detaches the old `ArrayBuffer` and installs a new one. A memory
 * declared `shared` grows in place: `memory.buffer` keeps the same identity and
 * the same `byteLength`, so neither this nor `services/wasmView.ts` would notice.
 * It is safe today because `daw-dsp` is built without threads and its memory is
 * not shared; a threaded build would have to compare `byteLength` as well. Stated
 * here so the next reader does not have to re-derive it.
 *
 * Positional arguments and no return value, deliberately: an options object or a
 * returned tuple would allocate once per block and give back what the cache
 * saved. Read `left` / `right` after `update`.
 */
export function createGrandBouleBlockViews(): GrandBouleBlockViews {
    let cachedBuffer: ArrayBufferLike | null = null;
    let cachedLeftPtr = -1;
    let cachedRightPtr = -1;
    let cachedFrames = -1;

    // Annotated rather than inferred: `new Float32Array(0)` infers a view over a
    // plain `ArrayBuffer`, while a view minted over `WebAssembly.Memory`'s buffer
    // is `Float32Array<ArrayBufferLike>` — the wider type has to be the field's.
    const views: { left: Float32Array; right: Float32Array; update: GrandBouleBlockViews['update'] } = {
        left: new Float32Array(0),
        right: new Float32Array(0),
        update(buffer: ArrayBufferLike, leftPtr: number, rightPtr: number, frames: number): void {
            if (
                buffer === cachedBuffer &&
                leftPtr === cachedLeftPtr &&
                rightPtr === cachedRightPtr &&
                frames === cachedFrames
            ) {
                return;
            }
            views.left = new Float32Array(buffer, leftPtr, frames);
            views.right = new Float32Array(buffer, rightPtr, frames);
            cachedBuffer = buffer;
            cachedLeftPtr = leftPtr;
            cachedRightPtr = rightPtr;
            cachedFrames = frames;
        },
    };

    return views;
}

/**
 * Apply one control message to the engine, `offset` samples into the block it
 * is about to render.
 *
 * Notes and pedals take the engine's offset-queued API, so a scheduled note or
 * pedal lands on its own sample rather than at the block boundary and in push
 * order with the notes around it; an offset of 0 is the "voice now" case both
 * hosts use for a message with no frame of its own. Everything else — params,
 * temperament, MIDI 2.0 notes, the panic — is block-rate and applies
 * immediately, which is what those controls mean.
 *
 * Answers `false` only when the engine's block event list refused a note or
 * pedal, so the caller can hold that message (and everything behind it) back
 * for the next block. Every other message returns `true`.
 *
 * The `default` arm is the whole point of centralising this: a new member of
 * `GrandBouleDispatchMsg` that nobody handles fails to compile here rather than
 * being ignored in whichever host was not updated. It is *not* unreachable at
 * runtime — the senders are not type-welded — so see the arm itself for why it
 * ignores rather than raises.
 */
export function dispatch(instance: GrandBouleInstance, msg: GrandBouleDispatchMsg, offset = 0): boolean {
    switch (msg.type) {
        case 'noteOn':
            return instance.push_note_on(msg.midiNote, msg.velocity, msg.channel ?? 0, offset);
        case 'noteExpression':
            // Grand Boule sounds bend only; pressure and slide are dropped
            // inside the engine rather than faked (audit MD-2). Queued at the
            // same offset as the note it bends so it cannot overtake it.
            return instance.push_note_expression(
                msg.midiNote,
                msg.channel,
                msg.bendSemitones,
                msg.pressure,
                msg.slide,
                offset
            );
        case 'noteOff':
            // `msg.releaseVelocity` (normalized 0..1) is threaded to this engine
            // boundary from the live-MIDI Note Off. The current WASM ABI
            // (`push_note_off(midi_note, offset)`) does not yet consume it; it is
            // forwarded as part of the typed message so the release dynamic is no
            // longer dropped at the control boundary.
            // Without a channel every voice at the pitch is released — the
            // historical behaviour channel-unaware callers rely on.
            if (msg.channel === undefined) {
                return instance.push_note_off(msg.midiNote, offset);
            }
            return instance.push_note_off_on_channel(msg.midiNote, msg.channel, offset);
        case 'param':
            // Block-rate: a parameter belongs to the whole block, and the engine
            // snaps or smooths it once per `process` call either way.
            instance.set_param(PARAM_MAP[msg.name] ?? msg.name, msg.value);
            break;
        case 'sustain':
            return instance.push_sustain(msg.position, offset);
        case 'unaCorda':
            return instance.push_una_corda(msg.engaged, offset);
        case 'sostenuto':
            return instance.push_sostenuto(msg.engaged, offset);
        case 'noteOnMidi2':
            instance.note_on_midi2(msg.midiNote, msg.velocity16bit, msg.pitchOffsetQ24);
            break;
        case 'temperament':
            instance.set_temperament(msg.index);
            break;
        case 'allNotesOff':
            instance.all_notes_off();
            break;
        default: {
            // Compile-time exhaustiveness, runtime tolerance — and the second
            // half is not a hedge.
            //
            // `never` fails the build for any member of `GrandBouleDispatchMsg`
            // nobody handled, which is the property worth having. But the weld
            // stops at the type: `GrandBouleNodeResult`'s `post` takes a
            // `Record<string, unknown>`, and `createWebAudioEngine` already
            // broadcasts `{type:'shutdown'}` to every device worklet, so an
            // unrecognised `type` can arrive here at runtime.
            //
            // Throwing on it was actively dangerous. The offline processor
            // catches whatever escapes its message handler, sets `_faulted`, and
            // then returns early from every remaining `process()`; its
            // `{type:'error'}` reply lands after `ready` has settled and is
            // dropped as 'late'. One stray message would silently produce the
            // exact silent export this transport exists to eliminate. The
            // pre-existing worker switch had no `default` and ignored unknowns;
            // that is the runtime behaviour, restated deliberately.
            const exhaustive: never = msg;
            void exhaustive;
            break;
        }
    }
    return true;
}

export type GrandBouleFrameQueue = {
    /** Place a framed message at its frame, keeping the queue ordered. */
    enqueue: (msg: GrandBouleQueuedMsg) => void;
    /**
     * Deliver everything due strictly before `blockEndFrame`, each note at its
     * own sample offset inside the block starting at `blockStartFrame`.
     *
     * Positional arguments rather than a block object: this runs once per
     * rendered block on both hosts, and an object literal per block would
     * allocate on the render path.
     */
    drain: (instance: GrandBouleInstance, blockStartFrame: number, blockEndFrame: number) => void;
    /** Drop every pending framed message. */
    clear: () => void;
    /** Drop pending notes/expression while preserving scheduled parameter and pedal state. */
    discardNotes: () => void;
    /** Drop every pending move of one pedal, leaving notes, parameters and the other pedals queued. */
    discardPedal: (kind: GrandBoulePedalMsg['type']) => void;
    /**
     * Pull every pending message back to `frame` when it sits later, keeping
     * their order. A host whose clock steps back (a flush that restarts the
     * block clock) calls this so what it kept stays ahead of anything stamped
     * from the new clock afterwards.
     */
    capPendingFrames: (frame: number) => void;
    /** Pending messages, for tests and for host-side assertions. */
    size: () => number;
};

/**
 * A frame-ordered queue of control messages awaiting the block that contains them.
 *
 * Bounded by the transport's scheduling look-ahead live, and by the part length
 * offline — an export posts every note before rendering starts, which is exactly
 * why the queue exists at all. The drain path allocates nothing: only `enqueue`,
 * which runs on message arrival, touches the array's capacity, and the backing
 * array is truncated only once the queue has fully drained.
 */
export function createGrandBouleFrameQueue(): GrandBouleFrameQueue {
    /** `head` is the read index, so draining never shifts the array. */
    const queue: GrandBouleQueuedMsg[] = [];
    let head = 0;

    /** Compact the pending messages in place down to those `keep` accepts, preserving order. */
    function retain(keep: (queued: GrandBouleQueuedMsg) => boolean): void {
        let retained = 0;
        for (let index = head; index < queue.length; index++) {
            const queued = queue[index];
            if (queued && keep(queued)) {
                queue[retained] = queued;
                retained++;
            }
        }
        queue.length = retained;
        head = 0;
    }

    return {
        enqueue(msg) {
            // Insert keeping the queue sorted by frame, and stable within a
            // frame so a `noteExpression` posted after its `noteOn` at the same
            // frame still lands behind it — the voice must exist before it is
            // bent.
            let lo = head;
            let hi = queue.length;
            while (lo < hi) {
                const mid = (lo + hi) >>> 1;
                const candidate = queue[mid];
                if (candidate && candidate.sampleFrame <= msg.sampleFrame) {
                    lo = mid + 1;
                } else {
                    hi = mid;
                }
            }
            queue.splice(lo, 0, msg);
        },

        drain(instance, blockStartFrame, blockEndFrame) {
            // `blockEndFrame` is exclusive. Levain, Fermenter, Toaster and
            // Crumbs used to break on `sampleFrame > blockEnd`, which drained a
            // frame sitting exactly on the boundary one block early. All of them
            // now use this same `>=`, each covered by a boundary test.
            while (head < queue.length) {
                const queued = queue[head];
                if (!queued || queued.sampleFrame >= blockEndFrame) {
                    break;
                }
                // A frame behind this block's start is a message that arrived
                // late; it sounds at the head of the block rather than being
                // held back another one.
                const offset = Math.max(0, queued.sampleFrame - blockStartFrame);
                if (!dispatch(instance, queued, offset)) {
                    // The engine's block list is full. Leave this message and
                    // everything behind it queued for the next block: late,
                    // never dropped, and still in the order the caller wrote.
                    break;
                }
                head++;
            }
            if (head >= queue.length) {
                queue.length = 0;
                head = 0;
            }
        },

        clear() {
            queue.length = 0;
            head = 0;
        },

        discardNotes() {
            retain((queued) => !isNoteMsg(queued));
        },

        discardPedal(kind) {
            retain((queued) => queued.type !== kind);
        },

        capPendingFrames(frame) {
            for (let index = head; index < queue.length; index++) {
                const queued = queue[index];
                if (queued && queued.sampleFrame > frame) {
                    queue[index] = { ...queued, sampleFrame: frame };
                }
            }
        },

        size() {
            return queue.length - head;
        },
    };
}

/** True when a framed message carries a frame a host can actually place. */
export function isPlaceableGrandBouleMsg(msg: GrandBouleFramedMsg): msg is GrandBouleQueuedMsg {
    return msg.sampleFrame !== undefined && Number.isFinite(msg.sampleFrame);
}

/** True for the messages that strike, release or bend a note. */
function isNoteMsg(msg: GrandBouleDispatchMsg): boolean {
    return msg.type === 'noteOn' || msg.type === 'noteOff' || msg.type === 'noteExpression';
}

function isPedalMsg(msg: GrandBouleDispatchMsg): msg is GrandBoulePedalMsg {
    return msg.type === 'sustain' || msg.type === 'unaCorda' || msg.type === 'sostenuto';
}

export function isFramedGrandBouleMsg(msg: GrandBouleDispatchMsg): msg is GrandBouleFramedMsg {
    return (
        isNoteMsg(msg) ||
        msg.type === 'param' ||
        msg.type === 'sustain' ||
        msg.type === 'unaCorda' ||
        msg.type === 'sostenuto'
    );
}

/**
 * The block the engine is about to produce, on the host clock a message's
 * `sampleFrame` is expressed in.
 *
 * The worker reads it off the ring write head plus the consumer offset, the
 * offline worklet off `currentFrame`. `endFrame` is exclusive: a frame landing
 * exactly on it belongs to the next block.
 */
export type GrandBouleBlockFrames = {
    startFrame: number;
    endFrame: number;
};

export type ReceiveGrandBouleMessageInput = {
    instance: GrandBouleInstance;
    queue: GrandBouleFrameQueue;
    msg: GrandBouleDispatchMsg;
    /** `null` when the host cannot place a frame yet, which voices immediately. */
    block: GrandBouleBlockFrames | null;
};

/**
 * Place a control message in the frame queue; the host's once-per-render drain
 * hands it to the engine.
 *
 * This is the one entry point both hosts route control messages through, so the
 * placement rule cannot differ between them. Every framed message is only
 * enqueued — at its own frame, or at the block's first frame when it is behind
 * the block, has no frame, or has none a host can place — and never drained
 * here. Draining on arrival would push a queued note-off ahead of a later
 * arriving pedal that sorts before it. The drain runs once per render, so the
 * engine's list receives pushes in non-decreasing frame order, in arrival order
 * at equal frames. A drain stops at the first message the engine refuses,
 * leaving it and everything behind it for the next block: late, never dropped,
 * never reordered. With no clock to queue against (`block === null`) a message
 * voices immediately.
 *
 * A pedal move with no usable frame is the newest gesture, so it first removes
 * the queued moves of the same pedal; a queued one would otherwise drain after
 * it and put the pedal back. Notes, parameters and the other pedals stay queued.
 */
export function receiveGrandBouleMessage({ instance, queue, msg, block }: ReceiveGrandBouleMessageInput): void {
    if (msg.type === 'allNotesOff') {
        // A panic must also drop what has not sounded yet, or the pending
        // look-ahead window keeps arriving after the user asked for silence.
        queue.discardNotes();
        dispatch(instance, msg);
        return;
    }

    const placeable = isFramedGrandBouleMsg(msg) && isPlaceableGrandBouleMsg(msg);
    if (isPedalMsg(msg) && !placeable) {
        queue.discardPedal(msg.type);
    }

    if (block === null || !isFramedGrandBouleMsg(msg)) {
        dispatch(instance, msg);
        return;
    }

    const sampleFrame = isPlaceableGrandBouleMsg(msg) ? Math.max(msg.sampleFrame, block.startFrame) : block.startFrame;
    queue.enqueue({ ...msg, sampleFrame });
}
