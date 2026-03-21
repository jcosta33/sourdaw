import { type TimelineRenderer } from '../models/RendererBackend';
import { type TimelineRenderModel } from '../models/TimelineRenderModel';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';

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
function hexToRgba(hex: string, alpha = 1): [number, number, number, number] {
    const clean = hex.replace('#', '');
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
    x1: number, y1: number,
    x2: number, y2: number,
    r: number, g: number, b: number, a: number,
    w: number, h: number,
): number {
    // Convert pixel coords → NDC (WebGPU: Y+ is up)
    const nx1 = (x1 / w) * 2 - 1;
    const nx2 = (x2 / w) * 2 - 1;
    const ny1 = 1 - (y1 / h) * 2;
    const ny2 = 1 - (y2 / h) * 2;

    // Triangle 1: top-left, top-right, bottom-left
    // Triangle 2: top-right, bottom-right, bottom-left
    const verts: number[] = [
        nx1, ny1,  r, g, b, a,
        nx2, ny1,  r, g, b, a,
        nx1, ny2,  r, g, b, a,
        nx2, ny1,  r, g, b, a,
        nx2, ny2,  r, g, b, a,
        nx1, ny2,  r, g, b, a,
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
                            { shaderLocation: 0, offset: 0,      format: 'float32x2' }, // xy
                            { shaderLocation: 1, offset: 2 * 4,  format: 'float32x4' }, // rgba
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
            const dpr = window.devicePixelRatio || 1;

            // Viewport beat range → pixel helpers
            const { viewportStartBeat, pixelsPerBeat, scrollY, selectedClipIds, selectedTrackId, playheadPosition } = model;

            function beatToX(beat: number): number {
                return (beat - viewportStartBeat) * pixelsPerBeat * dpr;
            }

            let offset = 0;
            let rectCount = 0;

            function addRect(x1: number, y1: number, x2: number, y2: number, color: string, alpha = 1): void {
                if (rectCount >= MAX_RECTS) {
                    return;
                }
                const [r, g, b] = hexToRgba(color, alpha);
                offset = pushRect(cpuBuf, offset, x1, y1, x2, y2, r, g, b, alpha, w, h);
                rectCount++;
            }

            // 1. Track background rows
            let trackY = -scrollY * dpr;
            for (const track of model.tracks) {
                const th = track.height * dpr;
                const isSelected = track.id === selectedTrackId;
                const bg = isSelected ? '#1e2a3a' : '#131313';
                addRect(0, trackY, w, trackY + th, bg);
                // Row separator line
                addRect(0, trackY + th - dpr, w, trackY + th, '#000000', 0.6);
                trackY += th;
            }

            // 2. Clips
            trackY = -scrollY * dpr;
            for (const track of model.tracks) {
                const th = track.height * dpr;
                const clipTop    = trackY + 2 * dpr;
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
                    const color = clip.color || track.color || '#3B82F6';
                    addRect(cx1, clipTop, cx2, clipBottom, color, alpha * 0.65);

                    // Clip top accent stripe
                    addRect(cx1, clipTop, cx2, clipTop + 3 * dpr, color, alpha);

                    // Selection highlight border (2px inside edges)
                    if (isSelected) {
                        addRect(cx1, clipTop, cx2, clipTop + 2 * dpr, '#ffffff', 0.9);
                        addRect(cx1, clipTop, cx1 + 2 * dpr, clipBottom, '#ffffff', 0.9);
                        addRect(cx2 - 2 * dpr, clipTop, cx2, clipBottom, '#ffffff', 0.9);
                        addRect(cx1, clipBottom - 2 * dpr, cx2, clipBottom, '#ffffff', 0.9);
                    }

                    // MIDI mini-notes
                    if (clip.type === 'midi' && clip.midiNotes.length > 0) {
                        const clippedNotes = clip.midiNotes.slice(0, 64); // limit for perf
                        const pitches = clippedNotes.map((n) => n.pitch);
                        const minPitch = Math.min(...pitches);
                        const maxPitch = Math.max(...pitches);
                        const pitchRange = Math.max(maxPitch - minPitch, 12);
                        const noteAreaH = clipBottom - clipTop - 10 * dpr;
                        for (const note of clippedNotes) {
                            const nx1 = beatToX(clip.startBeat + note.startBeat);
                            const nx2 = beatToX(clip.startBeat + note.startBeat + Math.max(note.duration, 0.125));
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
                                alpha * 0.8,
                            );
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
                            const amplitude = ((clipBottom - clipTop) - padding * 2) * 0.35;
                            const binWidth = w / numBins;
                            
                            // Color analogous to canvas renderer's 'rgba(120, 200, 160, 0.5)'
                            const wfColor = '#78c8a0';
                            
                            for (let i = 0; i < numBins; i++) {
                                const peakHeight = peaks[i]! * amplitude;
                                if (peakHeight > 0.5) {
                                    const bx1 = cx1 + i * binWidth;
                                    const bx2 = bx1 + binWidth;
                                    // Draw thin vertical rect for this bin's peak
                                    addRect(bx1, midY - peakHeight, bx2, midY + peakHeight, wfColor, alpha * 0.6);
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
            const lastBar  = Math.ceil((viewportStartBeat + (w / pixelsPerBeat / dpr)) / barBeats) + 1;
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
                addRect(phX - dpr, 0, phX + dpr, h, '#EF4444', 0.9); // red needle
                addRect(phX - 4 * dpr, 0, phX + 4 * dpr, 12 * dpr, '#EF4444', 0.9); // head cap
            }

            if (rectCount === 0) {
                return;
            }

            // Upload vertex data
            device.queue.writeBuffer(gpuBuf, 0, cpuBuf, 0, rectCount * FLOATS_PER_RECT);

            // Record + submit
            const encoder   = device.createCommandEncoder();
            const textureView = gpuContext!.getCurrentTexture().createView();
            const renderPass = encoder.beginRenderPass({
                colorAttachments: [
                    {
                        view: textureView,
                        clearValue: { r: 0.07, g: 0.07, b: 0.07, a: 1.0 },
                        loadOp:  'clear' as GPULoadOp,
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
            canvasW = w * dpr;
            canvasH = h * dpr;
            canvas.width  = canvasW;
            canvas.height = canvasH;
            canvas.style.width  = `${w}px`;
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
