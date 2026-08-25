import { type ReactElement, useEffect, useRef } from 'react';

import { NOTE_NAMES } from '#/utils/noteNames';
import { cn } from '#/utils/Styles/cn';

/**
 * Interactive 3D grand piano model.
 *
 * Renders a simplified grand piano from a front-quarter view using WebGL2.
 * Animates hammers on note-on, key depression, damper lift on sustain/hold,
 * and vibrating strings with amber glow. The lid opens/closes with the
 * lidPosition prop.
 *
 * Uses a flat 2D projection with perspective skew — no matrix library needed.
 */

const LOWEST_MIDI = 21; // A0
const NUM_KEYS = 88;
const BLACK_KEY_CLASSES = new Set([1, 3, 6, 8, 10]);

const isBlackKey = (midi: number): boolean => BLACK_KEY_CLASSES.has(midi % 12);

/** Human-readable note name for a MIDI number, e.g. 60 -> "C4". */
const midiToNoteName = (midi: number): string => {
    // `midi % 12` is always 0..11 and NOTE_NAMES has 12 entries.
    const name = NOTE_NAMES[midi % 12]!;
    return `${name}${Math.floor(midi / 12) - 1}`;
};

/** Build the screen-reader announcement for the currently sounding notes. */
const describeActiveNotes = (activeNotes: ReadonlyMap<number, number>): string => {
    if (activeNotes.size === 0) {
        return 'No notes playing';
    }
    const names = [...activeNotes.keys()].sort((a, b) => a - b).map(midiToNoteName);
    return `Playing ${names.join(', ')}`;
};

// Count white keys for layout
const NUM_WHITE_KEYS = (() => {
    let count = 0;
    for (let i = 0; i < NUM_KEYS; i += 1) {
        if (!isBlackKey(LOWEST_MIDI + i)) {
            count += 1;
        }
    }
    return count;
})();

type PianoModel3DProps = {
    activeNotes: ReadonlyMap<number, number>;
    sustainPedal: number;
    lidPosition: number;
    onNoteOn?: (midiNote: number, velocity: number) => void;
    onNoteOff?: (midiNote: number) => void;
    className?: string;
};

// Per-key animation state (mutated each frame, never triggers React renders).
type KeyAnim = {
    hammerT: number; // 0..1 hammer throw progress (1 = striking)
    hammerVel: number; // velocity that triggered the hammer
    keyDepress: number; // 0..1 depression amount
    damperLift: number; // 0..1 lift amount
    stringVib: number; // 0..1 vibration energy
};

const BODY_COLOR: [number, number, number] = [0.102, 0.102, 0.102]; // #1a1a1a
const AMBER: [number, number, number] = [0.984, 0.749, 0.141]; // #fbbf24
const GOLD_DIM: [number, number, number] = [0.6, 0.55, 0.35];
const STRING_REST: [number, number, number] = [0.35, 0.33, 0.25];
const WHITE_KEY: [number, number, number] = [0.95, 0.93, 0.9];
const WHITE_KEY_PRESSED: [number, number, number] = [0.88, 0.82, 0.7];
const BLACK_KEY: [number, number, number] = [0.08, 0.08, 0.08];
const BLACK_KEY_PRESSED: [number, number, number] = [0.18, 0.15, 0.1];
const DAMPER_COLOR: [number, number, number] = [0.55, 0.2, 0.15];
const DAMPER_LIFTED: [number, number, number] = [0.7, 0.35, 0.25];
const LID_COLOR: [number, number, number, number] = [0.12, 0.12, 0.12, 0.65];

const VERT_SRC = `#version 300 es
precision mediump float;
in vec2 a_pos;
in vec4 a_color;
out vec4 v_color;
uniform vec2 u_res;
void main() {
    // Map pixel coords to clip space.
    vec2 clip = (a_pos / u_res) * 2.0 - 1.0;
    clip.y = -clip.y; // flip Y so 0 is top
    gl_Position = vec4(clip, 0.0, 1.0);
    v_color = a_color;
}
`;

const FRAG_SRC = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 fragColor;
void main() {
    fragColor = v_color;
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
    const s = gl.createShader(type);
    if (s === null) {
        return null;
    }
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        gl.deleteShader(s);
        return null;
    }
    return s;
}

function buildProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (vs === null || fs === null) {
        return null;
    }
    const prog = gl.createProgram();
    if (prog === null) {
        return null;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        gl.deleteProgram(prog);
        return null;
    }
    return prog;
}

/** Push a quad (two triangles) into the vertex buffer. */
function pushQuad(
    buf: number[],
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    g: number,
    b: number,
    a: number
): void {
    // Each vertex: x, y, r, g, b, a  (6 floats)
    const x2 = x + w;
    const y2 = y + h;
    // Triangle 1
    buf.push(x, y, r, g, b, a);
    buf.push(x2, y, r, g, b, a);
    buf.push(x, y2, r, g, b, a);
    // Triangle 2
    buf.push(x2, y, r, g, b, a);
    buf.push(x2, y2, r, g, b, a);
    buf.push(x, y2, r, g, b, a);
}

/** Push a skewed quad for fake perspective (top edge narrower). */
function pushSkewQuad(
    buf: number[],
    x: number,
    y: number,
    w: number,
    h: number,
    skew: number,
    r: number,
    g: number,
    b: number,
    a: number
): void {
    const x2 = x + w;
    const y2 = y + h;
    const tx1 = x + skew;
    const tx2 = x2 - skew;
    // Triangle 1: top-left, top-right, bottom-left
    buf.push(tx1, y, r, g, b, a);
    buf.push(tx2, y, r, g, b, a);
    buf.push(x, y2, r, g, b, a);
    // Triangle 2: top-right, bottom-right, bottom-left
    buf.push(tx2, y, r, g, b, a);
    buf.push(x2, y2, r, g, b, a);
    buf.push(x, y2, r, g, b, a);
}

/** Push a thin horizontal line as a 1px-high quad. */
function pushLine(buf: number[], x1: number, y: number, x2: number, r: number, g: number, b: number, a: number): void {
    pushQuad(buf, x1, y, x2 - x1, 1.2, r, g, b, a);
}

/** Hit-test a canvas coordinate against the key region. Returns MIDI note or null. */
function hitTestKey(canvasX: number, canvasY: number, canvasW: number, canvasH: number): number | null {
    const margin = canvasW * 0.04;
    const bodyX = margin;
    const bodyW = canvasW - margin * 2;
    const bodyH = canvasH * 0.82;
    const bodyY = canvasH * 0.08;
    const keyAreaY = bodyY + bodyH * 0.72;
    const keyAreaH = bodyH * 0.22;
    const strX = bodyX + bodyW * 0.06;
    const whiteW = (bodyW * 0.88) / NUM_WHITE_KEYS;

    // Outside key area vertically?
    if (canvasY < keyAreaY || canvasY > keyAreaY + keyAreaH) {
        return null;
    }

    const relX = canvasX - strX;
    if (relX < 0 || relX > whiteW * NUM_WHITE_KEYS) {
        return null;
    }

    const blackKeyH = keyAreaH * 0.62;
    const inBlackRegion = canvasY < keyAreaY + blackKeyH;

    // Check black keys first (they overlap white keys in the upper region)
    if (inBlackRegion) {
        let whiteIdx = 0;
        for (let i = 0; i < NUM_KEYS; i += 1) {
            const midi = LOWEST_MIDI + i;
            if (isBlackKey(midi)) {
                const bkW = whiteW * 0.65;
                const bkx = (whiteIdx - 0.5) * whiteW + (whiteW - bkW) * 0.5;
                if (relX >= bkx && relX <= bkx + bkW) {
                    return midi;
                }
            } else {
                whiteIdx += 1;
            }
        }
    }

    // White key: simple division
    const whiteIdx = Math.floor(relX / whiteW);
    let count = 0;
    for (let i = 0; i < NUM_KEYS; i += 1) {
        const midi = LOWEST_MIDI + i;
        if (!isBlackKey(midi)) {
            if (count === whiteIdx) {
                return midi;
            }
            count += 1;
        }
    }
    return null;
}

export const PianoModel3D = ({
    activeNotes,
    sustainPedal,
    lidPosition,
    onNoteOn,
    onNoteOff,
    className,
}: PianoModel3DProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    // Map of active pointerId -> MIDI note. A Map (not a single ref) lets
    // multiple simultaneous pointers each hold their own note, so multi-touch
    // chords release independently instead of one pointer-down stomping the
    // prior note's pending release.
    const pressedNotesRef = useRef<Map<number, number>>(new Map());
    const animRef = useRef<KeyAnim[]>(
        Array.from({ length: NUM_KEYS }, () => ({
            hammerT: 0,
            hammerVel: 0,
            keyDepress: 0,
            damperLift: 0,
            stringVib: 0,
        }))
    );
    const prevNotesRef = useRef<ReadonlyMap<number, number>>(new Map());
    const lidRef = useRef(lidPosition);
    lidRef.current = lidPosition;
    // The rAF render loop is created once in a []-deps effect, so it would
    // otherwise close over the first-render activeNotes/sustainPedal forever.
    // Mirror both changing inputs into refs and read *.current inside the loop
    // (same pattern as StringVibrationView's notesRef).
    const activeNotesRef = useRef(activeNotes);
    activeNotesRef.current = activeNotes;
    const sustainPedalRef = useRef(sustainPedal);
    sustainPedalRef.current = sustainPedal;
    // Keep the latest onNoteOff reachable from the window-level fallback
    // listener without re-subscribing it on every render.
    const onNoteOffRef = useRef(onNoteOff);
    onNoteOffRef.current = onNoteOff;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas === null) {
            return undefined;
        }

        const gl = canvas.getContext('webgl2', { alpha: false, antialias: true });
        if (gl === null) {
            return undefined;
        }

        const prog = buildProgram(gl);
        if (prog === null) {
            return undefined;
        }

        gl.useProgram(prog);
        const aPos = gl.getAttribLocation(prog, 'a_pos');
        const aColor = gl.getAttribLocation(prog, 'a_color');
        const uRes = gl.getUniformLocation(prog, 'u_res');

        const vao = gl.createVertexArray();
        const vbo = gl.createBuffer();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);

        const STRIDE = 6 * 4; // 6 floats, 4 bytes each
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, STRIDE, 0);
        gl.enableVertexAttribArray(aColor);
        gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, STRIDE, 2 * 4);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // Vertex scratch reused across frames. Truncating with `length = 0`
        // keeps the V8 backing store, so per-frame array growth amortises
        // to zero allocation once the maximum vertex count is reached.
        // Same idea for the typed-array upload buffer — only reallocate
        // when the vertex count exceeds the currently-cached capacity.
        const vertexScratch: number[] = [];
        let uploadBuffer: Float32Array | null = null;
        let rafId = 0;

        const render = (): void => {
            const W = canvas.width;
            const H = canvas.height;
            gl.viewport(0, 0, W, H);
            gl.uniform2f(uRes, W, H);
            gl.clearColor(0.07, 0.07, 0.07, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            const anims = animRef.current;

            // Read the latest props through their refs so the loop reflects
            // live play instead of the mount-time snapshot.
            const currentNotes = activeNotesRef.current;
            const currentSustain = sustainPedalRef.current;

            // --- Update animation state ---
            for (let i = 0; i < NUM_KEYS; i += 1) {
                const midi = LOWEST_MIDI + i;
                const a = anims[i]!;
                const vel = currentNotes.get(midi);
                const isHeld = vel !== undefined;

                // Hammer: snap up on new note-on, decay back
                if (isHeld && !prevNotesRef.current.has(midi)) {
                    a.hammerT = 1.0;
                    a.hammerVel = vel;
                }
                a.hammerT = Math.max(0, a.hammerT - 0.06);

                // Key depression
                const targetDepress = isHeld ? 1.0 : 0.0;
                a.keyDepress += (targetDepress - a.keyDepress) * 0.25;

                // Damper: lifted when note held OR sustain pedal engaged
                const targetDamper = isHeld || currentSustain > 0.3 ? 1.0 : 0.0;
                a.damperLift += (targetDamper - a.damperLift) * 0.15;

                // String vibration: energised while held or damper up
                if (isHeld) {
                    a.stringVib = Math.max(a.stringVib, vel * 0.8);
                }
                a.stringVib *= a.damperLift > 0.3 ? 0.998 : 0.96;
                if (a.stringVib < 0.005) {
                    a.stringVib = 0;
                }
            }
            prevNotesRef.current = currentNotes;

            // --- Layout constants (pixel coords) ---
            const margin = W * 0.04;
            const bodyX = margin;
            const bodyW = W - margin * 2;
            const bodyY = H * 0.08;
            const bodyH = H * 0.82;
            const skew = bodyW * 0.04; // perspective skew

            const keyAreaY = bodyY + bodyH * 0.72;
            const keyAreaH = bodyH * 0.22;
            const stringAreaY = bodyY + bodyH * 0.15;
            const stringAreaH = bodyH * 0.48;
            const hammerY = keyAreaY - bodyH * 0.08;
            const hammerH = bodyH * 0.05;
            const damperY = stringAreaY + stringAreaH + 2;
            const damperH = bodyH * 0.04;

            vertexScratch.length = 0;
            const buf = vertexScratch;

            // --- Piano body (skewed trapezoid) ---
            pushSkewQuad(buf, bodyX, bodyY, bodyW, bodyH, skew, ...BODY_COLOR, 1);

            // --- Strings ---
            const strX = bodyX + bodyW * 0.06;
            const strW = bodyW * 0.88;
            for (let i = 0; i < NUM_KEYS; i += 1) {
                const a = anims[i]!;
                const t = i / (NUM_KEYS - 1);
                const y = stringAreaY + t * stringAreaH;
                if (a.stringVib > 0.01) {
                    const mix = Math.min(1, a.stringVib);
                    const r = STRING_REST[0] + (AMBER[0] - STRING_REST[0]) * mix;
                    const g = STRING_REST[1] + (AMBER[1] - STRING_REST[1]) * mix;
                    const b = STRING_REST[2] + (AMBER[2] - STRING_REST[2]) * mix;
                    pushLine(buf, strX, y, strX + strW, r, g, b, 0.5 + mix * 0.5);
                } else {
                    pushLine(buf, strX, y, strX + strW, ...STRING_REST, 0.2);
                }
            }

            // --- Damper rail ---
            let whiteIdx = 0;
            const whiteW = (bodyW * 0.88) / NUM_WHITE_KEYS;
            for (let i = 0; i < NUM_KEYS; i += 1) {
                const midi = LOWEST_MIDI + i;
                const a = anims[i]!;
                const black = isBlackKey(midi);
                const dw = black ? whiteW * 0.6 : whiteW * 0.85;
                const dx = black
                    ? strX + (whiteIdx - 0.5) * whiteW + (whiteW - dw) * 0.5
                    : strX + whiteIdx * whiteW + (whiteW - dw) * 0.5;
                const lift = a.damperLift * damperH * 1.2;
                const cr = DAMPER_COLOR[0] + (DAMPER_LIFTED[0] - DAMPER_COLOR[0]) * a.damperLift;
                const cg = DAMPER_COLOR[1] + (DAMPER_LIFTED[1] - DAMPER_COLOR[1]) * a.damperLift;
                const cb = DAMPER_COLOR[2] + (DAMPER_LIFTED[2] - DAMPER_COLOR[2]) * a.damperLift;
                pushQuad(buf, dx, damperY - lift, dw, damperH, cr, cg, cb, 0.85);
                if (!black) {
                    whiteIdx += 1;
                }
            }

            // --- Hammer rail ---
            whiteIdx = 0;
            for (let i = 0; i < NUM_KEYS; i += 1) {
                const midi = LOWEST_MIDI + i;
                const a = anims[i]!;
                const black = isBlackKey(midi);
                const hw = black ? whiteW * 0.5 : whiteW * 0.7;
                const hx = black
                    ? strX + (whiteIdx - 0.5) * whiteW + (whiteW - hw) * 0.5
                    : strX + whiteIdx * whiteW + (whiteW - hw) * 0.5;
                const throw_ = a.hammerT * a.hammerVel * hammerH * 1.8;
                const intensity = a.hammerT * a.hammerVel;
                const hr = GOLD_DIM[0] + (AMBER[0] - GOLD_DIM[0]) * intensity;
                const hg = GOLD_DIM[1] + (AMBER[1] - GOLD_DIM[1]) * intensity;
                const hb = GOLD_DIM[2] + (AMBER[2] - GOLD_DIM[2]) * intensity;
                pushQuad(buf, hx, hammerY - throw_, hw, hamperHSmall(hammerH), hr, hg, hb, 0.9);
                if (!black) {
                    whiteIdx += 1;
                }
            }

            // --- Keys (white then black, so black draws on top) ---
            const keyX = strX;
            whiteIdx = 0;
            // White keys
            for (let i = 0; i < NUM_KEYS; i += 1) {
                const midi = LOWEST_MIDI + i;
                if (isBlackKey(midi)) {
                    continue;
                }
                const a = anims[i]!;
                const kx = keyX + whiteIdx * whiteW;
                const depress = a.keyDepress * 3;
                const cr = WHITE_KEY[0] + (WHITE_KEY_PRESSED[0] - WHITE_KEY[0]) * a.keyDepress;
                const cg = WHITE_KEY[1] + (WHITE_KEY_PRESSED[1] - WHITE_KEY[1]) * a.keyDepress;
                const cb = WHITE_KEY[2] + (WHITE_KEY_PRESSED[2] - WHITE_KEY[2]) * a.keyDepress;
                pushQuad(buf, kx + 0.5, keyAreaY + depress, whiteW - 1, keyAreaH - depress, cr, cg, cb, 1);
                whiteIdx += 1;
            }
            // Black keys
            whiteIdx = 0;
            for (let i = 0; i < NUM_KEYS; i += 1) {
                const midi = LOWEST_MIDI + i;
                if (isBlackKey(midi)) {
                    const a = anims[i]!;
                    const bkW = whiteW * 0.65;
                    const bkx = keyX + (whiteIdx - 0.5) * whiteW + (whiteW - bkW) * 0.5;
                    const bkH = keyAreaH * 0.62;
                    const depress = a.keyDepress * 2;
                    const cr = BLACK_KEY[0] + (BLACK_KEY_PRESSED[0] - BLACK_KEY[0]) * a.keyDepress;
                    const cg = BLACK_KEY[1] + (BLACK_KEY_PRESSED[1] - BLACK_KEY[1]) * a.keyDepress;
                    const cb = BLACK_KEY[2] + (BLACK_KEY_PRESSED[2] - BLACK_KEY[2]) * a.keyDepress;
                    pushQuad(buf, bkx, keyAreaY + depress, bkW, bkH - depress, cr, cg, cb, 1);
                } else {
                    whiteIdx += 1;
                }
            }

            // --- Lid (translucent, position-dependent) ---
            const currentLid = lidRef.current;
            if (currentLid < 0.98) {
                const lidH = bodyH * 0.55 * (1 - currentLid);
                const lidY = bodyY;
                const [lr, lg, lb, la] = LID_COLOR;
                const lidAlpha = la * (1 - currentLid * 0.6);
                pushSkewQuad(buf, bodyX + 2, lidY, bodyW - 4, lidH, skew * 0.8, lr, lg, lb, lidAlpha);
            }

            // --- Body rim outline (four thin quads) ---
            const rimC: [number, number, number] = [0.22, 0.2, 0.18];
            const rimW = 2;
            pushSkewQuad(buf, bodyX, bodyY, bodyW, rimW, skew, ...rimC, 1);
            pushQuad(buf, bodyX, bodyY + bodyH - rimW, bodyW, rimW, ...rimC, 1);
            pushQuad(buf, bodyX, bodyY, rimW, bodyH, ...rimC, 1);
            pushQuad(buf, bodyX + bodyW - rimW, bodyY, rimW, bodyH, ...rimC, 1);

            // --- Upload and draw ---
            // Grow the typed-array upload buffer on demand and copy from the
            // reused scratch array. After a couple of frames the capacity
            // matches the steady-state vertex count and no further allocation
            // happens on the hot path.
            const vertexCount = buf.length;
            if (uploadBuffer === null || uploadBuffer.length < vertexCount) {
                uploadBuffer = new Float32Array(vertexCount);
            }
            for (let i = 0; i < vertexCount; i += 1) {
                uploadBuffer[i] = buf[i]!;
            }
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            gl.bufferData(gl.ARRAY_BUFFER, uploadBuffer.subarray(0, vertexCount), gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, vertexCount / 6);

            rafId = requestAnimationFrame(render);
        };

        rafId = requestAnimationFrame(render);
        return () => {
            cancelAnimationFrame(rafId);
        };
    }, []);

    // Fallback release path: if setPointerCapture silently no-ops, the canvas
    // never sees pointerup and the note would hang. A window-level listener
    // releases any pointer still recorded as held, guaranteeing every
    // pointer-down is eventually matched by a release.
    useEffect(() => {
        const pressed = pressedNotesRef.current;
        const releaseFromWindow = (e: PointerEvent): void => {
            const note = pressed.get(e.pointerId);
            if (note === undefined) {
                return;
            }
            pressed.delete(e.pointerId);
            onNoteOffRef.current?.(note);
        };
        window.addEventListener('pointerup', releaseFromWindow);
        window.addEventListener('pointercancel', releaseFromWindow);
        return () => {
            window.removeEventListener('pointerup', releaseFromWindow);
            window.removeEventListener('pointercancel', releaseFromWindow);
        };
    }, []);

    const canvasToPixel = (clientX: number, clientY: number): [number, number] => {
        const canvas = canvasRef.current;
        if (canvas === null) {
            return [0, 0];
        }
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return [(clientX - rect.left) * scaleX, (clientY - rect.top) * scaleY];
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
        if (onNoteOn === undefined) {
            return;
        }
        const canvas = canvasRef.current;
        if (canvas === null) {
            return;
        }
        // Capture is best-effort: if it silently no-ops the captured element
        // never receives pointerup, so the window-level fallback listener
        // installed in the effect below releases the note instead.
        try {
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        } catch {
            // Capture unsupported/failed — fallback listener covers release.
        }
        const [px, py] = canvasToPixel(e.clientX, e.clientY);
        const midi = hitTestKey(px, py, canvas.width, canvas.height);
        if (midi !== null) {
            pressedNotesRef.current.set(e.pointerId, midi);
            onNoteOn(midi, 0.8);
        }
    };

    const releasePointer = (pointerId: number): void => {
        const note = pressedNotesRef.current.get(pointerId);
        if (note === undefined) {
            return;
        }
        pressedNotesRef.current.delete(pointerId);
        onNoteOff?.(note);
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
        releasePointer(e.pointerId);
    };

    const handlePointerLeave = handlePointerUp;

    return (
        <>
            <canvas
                ref={canvasRef}
                width={800}
                height={480}
                className={cn('rounded-lg select-none touch-none', className)}
                aria-label="Grand Boule interactive piano"
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={handlePointerLeave}
            />
            {/* The canvas itself is opaque to assistive tech; announce the
                currently sounding notes through a polite live region. */}
            <span className="sr-only" role="status" aria-live="polite">
                {describeActiveNotes(activeNotes)}
            </span>
        </>
    );
};

/** Hammer element height — kept small to suggest a thin shank. */
function hamperHSmall(baseH: number): number {
    return baseH * 0.4;
}
