import { type TimelineRenderer } from '../../models/RendererBackend';
import { type TimelineRenderModel } from '../../models/TimelineRenderModel';
import { audioBufferCache } from '#/modules/AudioEngine';
import { resolveToken } from '#/helpers/UI/resolveToken';

// ─── WGSL shaders ────────────────────────────────────────────────────────────
// Each vertex carries: xy (NDC) + rgba (f32 × 4) = 6 floats = 24 bytes
const WGSL_SHADER = /* wgsl */ `
struct VertexOut {
    @builtin(position) pos : vec4f,
    @location(0)       col : vec4f,
}

@vertex
fn vs_main(
    @location(0) xy : vec2f,
    @location(1) col: vec4f,
) -> VertexOut {
    var out : VertexOut;
    out.pos = vec4f(xy, 0.0, 1.0);
    out.col = col;
    return out;
}

@fragment
fn fs_main(@location(0) col: vec4f) -> @location(0) vec4f {
    return col;
}
`;

// Floats per vertex: xy (2) + rgba (4) = 6
const FLOATS_PER_VERTEX = 6;
// 2 triangles per rect = 6 vertices
const VERTICES_PER_RECT = 6;
const FLOATS_PER_RECT = VERTICES_PER_RECT * FLOATS_PER_VERTEX;
// Upper bound: many tracks × many clips + track rows + playhead + bar lines, now + waveform rects
const MAX_RECTS = 32768;

// ─── Colour helpers ───────────────────────────────────────────────────────────
/** Parse hex (#rrggbb / #rgb) OR oklch(L C H) into [r, g, b, a] with values in 0..1 */
function colorToRgba(color: string, alpha = 1): [number, number, number, number] {
    // oklch(L C H) → OKLab → linear sRGB → sRGB
    const oklchMatch = color.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/);
    if (oklchMatch) {
        const L = parseFloat(oklchMatch[1]!);
        const C = parseFloat(oklchMatch[2]!);
        const H = parseFloat(oklchMatch[3]!) * (Math.PI / 180);
        const a_ = C * Math.cos(H);
        const b_ = C * Math.sin(H);
        // OKLab → linear sRGB (approximate via LMS)
        const l_ = L + 0.3963377774 * a_ + 0.2158037573 * b_;
        const m_ = L - 0.1055613458 * a_ - 0.0638541728 * b_;
        const s_ = L - 0.0894841775 * a_ - 1.291485548 * b_;
        const l3 = l_ * l_ * l_;
        const m3 = m_ * m_ * m_;
        const s3 = s_ * s_ * s_;
        const lr = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
        const lg = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
        const lb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;
        // Linear → sRGB gamma, clamped to [0,1]
        const gamma = (x: number): number => {
            const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
            return Math.max(0, Math.min(1, v));
        };
        return [gamma(lr), gamma(lg), gamma(lb), alpha];
    }

    // Hex fallback
    const clean = color.replace('#', '');
    if (clean.length === 3) {
        const r = parseInt(clean[0]! + clean[0]!, 16) / 255;
        const g = parseInt(clean[1]! + clean[1]!, 16) / 255;
        const b = parseInt(clean[2]! + clean[2]!, 16) / 255;
        return [r, g, b, alpha];
    }
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    return [isNaN(r) ? 0.4 : r, isNaN(g) ? 0.4 : g, isNaN(b) ? 0.4 : b, alpha];
}

// ─── Geometry helper ──────────────────────────────────────────────────────────
/**
 * Push a screen-space rectangle into the Float32Array vertex buffer.
 * Coordinates are in pixels; we convert to NDC using canvas dimensions.
 */
function pushRect(
    buf: Float32Array,
    offset: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    r: number,
    g: number,
    b: number,
    a: number,
    w: number,
    h: number
): number {
    // Convert pixel coords → NDC (WebGPU: Y+ is up)
    const nx1 = (x1 / w) * 2 - 1;
    const nx2 = (x2 / w) * 2 - 1;
    const ny1 = 1 - (y1 / h) * 2;
    const ny2 = 1 - (y2 / h) * 2;

    // Triangle 1: top-left, top-right, bottom-left
    // Triangle 2: top-right, bottom-right, bottom-left
    const verts: number[] = [
        nx1,
        ny1,
        r,
        g,
        b,
        a,
        nx2,
        ny1,
        r,
        g,
        b,
        a,
        nx1,
        ny2,
        r,
        g,
        b,
        a,
        nx2,
        ny1,
        r,
        g,
        b,
        a,
        nx2,
        ny2,
        r,
        g,
        b,
        a,
        nx1,
        ny2,
        r,
        g,
        b,
        a,
    ];
    buf.set(verts, offset);
    return offset + FLOATS_PER_RECT;
}

// ─── Main factory ─────────────────────────────────────────────────────────────
export async function createWebGpuRenderer(canvas: HTMLCanvasElement): Promise<TimelineRenderer | null> {
    if (!navigator.gpu) {
        return null;
    }

    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            return null;
        }

        const device = await adapter.requestDevice();
        const gpuContext = canvas.getContext('webgpu');
        if (!gpuContext) {
            return null;
        }

        const format = navigator.gpu.getPreferredCanvasFormat();
        gpuContext.configure({ device, format, alphaMode: 'premultiplied' });

        // ─── Shader & pipeline ────────────────────────────────────────────
        const shaderModule = device.createShaderModule({ code: WGSL_SHADER });

        const pipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [
                    {
                        arrayStride: FLOATS_PER_VERTEX * 4, // bytes
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: 'float32x2' }, // xy
                            { shaderLocation: 1, offset: 2 * 4, format: 'float32x4' }, // rgba
                        ],
                    },
                ],
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [
                    {
                        format,
                        blend: {
                            color: {
                                srcFactor: 'src-alpha',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add',
                            },
                            alpha: {
                                srcFactor: 'one',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add',
                            },
                        },
                    },
                ],
            },
            primitive: { topology: 'triangle-list' },
        });

        // ─── Vertex buffer (CPU-mapped every frame) ───────────────────────
        const maxBytes = MAX_RECTS * FLOATS_PER_RECT * 4;
        const cpuBuf = new Float32Array(MAX_RECTS * FLOATS_PER_RECT);

        let gpuBuf = device.createBuffer({
            size: maxBytes,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        let canvasW = canvas.width;
        let canvasH = canvas.height;

        // ─── Per-frame render ─────────────────────────────────────────────
        function render(model: TimelineRenderModel): void {
            const w = canvasW;
            const h = canvasH;
            if (w <= 0 || h <= 0) {
                return;
            }
            const dpr = window.devicePixelRatio || 1;

            // Viewport beat range → pixel helpers
            const { viewportStartBeat, pixelsPerBeat, scrollY, selectedClipIds, selectedTrackId, playheadPosition } =
                model;

            function beatToX(beat: number): number {
                return (beat - viewportStartBeat) * pixelsPerBeat * dpr;
            }

            let offset = 0;
            let rectCount = 0;

            function addRect(x1: number, y1: number, x2: number, y2: number, color: string, alpha = 1): void {
                if (rectCount >= MAX_RECTS) {
                    return;
                }
                const [r, g, b] = colorToRgba(color, alpha);
                offset = pushRect(cpuBuf, offset, x1, y1, x2, y2, r, g, b, alpha, w, h);
                rectCount++;
            }

            // 1. Track background rows
            let trackY = -scrollY * dpr;
            for (const track of model.tracks) {
                const th = track.height * dpr;
                const isSelected = track.id === selectedTrackId;
                const bg = isSelected
                    ? resolveToken('--color-bg-well', '#0d0d0d')
                    : resolveToken('--color-bg-tray', '#0a0a0a');
                addRect(0, trackY, w, trackY + th, bg);
                // Row separator line
                addRect(0, trackY + th - dpr, w, trackY + th, '#000000', 0.6);
                trackY += th;
            }

            // 2. Clips
            trackY = -scrollY * dpr;
            for (const track of model.tracks) {
                const th = track.height * dpr;
                const clipTop = trackY + 2 * dpr;
                const clipBottom = trackY + th - 2 * dpr;

                for (const clip of track.clips) {
                    const cx1 = beatToX(clip.startBeat);
                    const cx2 = beatToX(clip.endBeat);
                    if (cx2 < 0 || cx1 > w) {
                        continue;
                    }
                    const isSelected = selectedClipIds.includes(clip.id);
                    const alpha = clip.muted ? 0.35 : 1.0;

                    // Clip body
                    const color = clip.color || track.color || 'oklch(0.40 0.08 250)';
                    addRect(cx1, clipTop, cx2, clipBottom, color, alpha * 1);

                    // Clip top accent stripe
                    addRect(cx1, clipTop, cx2, clipTop + 3 * dpr, color, alpha);

                    // Selection highlight — warm metallic border + inner brightening
                    if (isSelected) {
                        // Inner brightening overlay to make clip pop
                        addRect(cx1, clipTop, cx2, clipBottom, '#ffffff', 0.06);
                        // Warm metallic border (2px, high alpha)
                        const bw = 2 * dpr;
                        addRect(cx1, clipTop, cx2, clipTop + bw, 'oklch(0.62 0.05 55)', 0.75);
                        addRect(cx1, clipTop, cx1 + bw, clipBottom, 'oklch(0.62 0.05 55)', 0.75);
                        addRect(cx2 - bw, clipTop, cx2, clipBottom, 'oklch(0.62 0.05 55)', 0.75);
                        addRect(cx1, clipBottom - bw, cx2, clipBottom, 'oklch(0.62 0.05 55)', 0.75);
                    }

                    // MIDI mini-notes
                    if (clip.type === 'midi' && clip.midiNotes.length > 0) {
                        const pitches = clip.midiNotes.map((n) => n.pitch);
                        const minPitch = Math.min(...pitches);
                        const maxPitch = Math.max(...pitches);
                        const pitchRange = Math.max(maxPitch - minPitch, 12);
                        const noteAreaH = clipBottom - clipTop - 10 * dpr;

                        const clipDuration = clip.endBeat - clip.startBeat;
                        const loopLen = clip.loopEnabled && clip.loopLength ? clip.loopLength : clipDuration;

                        let loopOffset = 0;
                        let drawnNotes = 0;
                        const MAX_NOTES_PER_CLIP = 300;

                        while (loopOffset < clipDuration) {
                            for (const note of clip.midiNotes) {
                                if (drawnNotes >= MAX_NOTES_PER_CLIP) break;

                                // note.startBeat is absolute (timeline position).
                                // Convert to clip-relative, then add loop offset.
                                const noteRelative = note.startBeat - clip.startBeat;
                                const relBeat = noteRelative + loopOffset;
                                if (relBeat < 0 || relBeat >= clipDuration) continue;

                                const nx1 = beatToX(clip.startBeat + relBeat);
                                const nx2 = beatToX(clip.startBeat + relBeat + Math.max(note.duration, 0.125));
                                if (nx2 < cx1 || nx1 > cx2) {
                                    continue;
                                }
                                const noteY = clipBottom - 5 * dpr - ((note.pitch - minPitch) / pitchRange) * noteAreaH;
                                addRect(
                                    Math.max(nx1, cx1 + 2),
                                    noteY - dpr,
                                    Math.min(nx2, cx2 - 2),
                                    noteY + 2 * dpr,
                                    '#ffffff',
                                    alpha * 0.35
                                );
                                drawnNotes++;
                            }
                            if (drawnNotes >= MAX_NOTES_PER_CLIP) break;
                            loopOffset += loopLen;
                            if (!clip.loopEnabled || loopLen <= 0) break;
                        }
                    }

                    // AUDIO waveform peaks
                    if (clip.type === 'audio' && clip.audioBufferId && audioBufferCache.has(clip.audioBufferId)) {
                        const w = cx2 - cx1;
                        if (w >= 4) {
                            // At least 1 rect per pixel, up to max ~2000 bins to balance perf
                            const numBins = Math.min(Math.floor(w * dpr), 2000);
                            const peaks = audioBufferCache.getWaveformPeaks(clip.audioBufferId, numBins);

                            const midY = clipTop + (clipBottom - clipTop) / 2;
                            const padding = 2 * dpr;
                            const amplitude = (clipBottom - clipTop - padding * 2) * 0.35;
                            const binWidth = w / numBins;

                            // White with transparency — matches MIDI note style
                            const wfColor = '#ffffff';

                            for (let i = 0; i < numBins; i++) {
                                const peakHeight = peaks[i]! * amplitude;
                                if (peakHeight > 0.5) {
                                    const bx1 = cx1 + i * binWidth;
                                    const bx2 = bx1 + binWidth;
                                    // Draw thin vertical rect for this bin's peak
                                    addRect(bx1, midY - peakHeight, bx2, midY + peakHeight, wfColor, alpha * 0.18);
                                }
                            }
                        }
                    }
                }
                trackY += track.height * dpr;
            }

            // 3. Bar / beat grid lines
            const barBeats = model.timeSignatureNumerator;
            const firstBar = Math.floor(viewportStartBeat / barBeats);
            const lastBar = Math.ceil((viewportStartBeat + w / pixelsPerBeat / dpr) / barBeats) + 1;
            for (let bar = firstBar; bar <= lastBar; bar++) {
                const beat = bar * barBeats;
                const gx = beatToX(beat);
                if (gx < 0 || gx > w) {
                    continue;
                }
                addRect(gx, 0, gx + dpr, h, '#ffffff', bar % 4 === 0 ? 0.08 : 0.04);
            }

            // 4. Playhead
            const phX = beatToX(playheadPosition);
            if (phX >= 0 && phX <= w) {
                addRect(phX - dpr, 0, phX + dpr, h, resolveToken('--color-state-record', '#c45040'), 0.9); // red needle
                addRect(
                    phX - 4 * dpr,
                    0,
                    phX + 4 * dpr,
                    12 * dpr,
                    resolveToken('--color-state-record', '#c45040'),
                    0.9
                ); // head cap
            }

            if (rectCount === 0) {
                return;
            }

            // Upload vertex data
            device.queue.writeBuffer(gpuBuf, 0, cpuBuf, 0, rectCount * FLOATS_PER_RECT);

            // Record + submit
            const encoder = device.createCommandEncoder();
            const textureView = gpuContext!.getCurrentTexture().createView();
            const renderPass = encoder.beginRenderPass({
                colorAttachments: [
                    {
                        view: textureView,
                        clearValue: { r: 0.07, g: 0.07, b: 0.07, a: 1.0 },
                        loadOp: 'clear' as GPULoadOp,
                        storeOp: 'store' as GPUStoreOp,
                    },
                ],
            });

            renderPass.setPipeline(pipeline);
            renderPass.setVertexBuffer(0, gpuBuf);
            renderPass.draw(rectCount * VERTICES_PER_RECT);
            renderPass.end();
            device.queue.submit([encoder.finish()]);
        }

        function resize(w: number, h: number): void {
            const dpr = window.devicePixelRatio || 1;
            const pw = Math.round(w * dpr);
            const ph = Math.round(h * dpr);
            if (pw <= 0 || ph <= 0) {
                return;
            }
            canvasW = pw;
            canvasH = ph;
            canvas.width = pw;
            canvas.height = ph;
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
            gpuContext!.configure({ device, format, alphaMode: 'premultiplied' });

            // Recreate GPU buffer if sizing up
            const needed = MAX_RECTS * FLOATS_PER_RECT * 4;
            if (gpuBuf.size < needed) {
                gpuBuf.destroy();
                gpuBuf = device.createBuffer({
                    size: needed,
                    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
                });
            }
        }

        function dispose(): void {
            gpuBuf.destroy();
            device.destroy();
        }

        return { backend: 'webgpu', render, resize, dispose };
    } catch {
        return null;
    }
}
