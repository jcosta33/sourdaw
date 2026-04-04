/**
 * Signal Flow View — Level 4 (Route) visualization.
 * Shows the complete audio path from generators through effects to output.
 * Each node is interactive — clicking opens its controls in the inspector.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { DawDiagramFrame } from '#/components/daw/DawDiagramFrame';
import {
    ENGINE_NAMES,
    FILTER_MODEL_NAMES,
    WARP_MODE_NAMES,
    type FermenterPatch,
} from '../../models/FermenterPatch';

type SignalFlowViewProps = {
    patch: FermenterPatch;
    numLayers: number;
    activeLayer: number;
    onSelectSection: (section: string) => void;
};

type FlowNode = {
    label: string;
    subtitle?: string;
    active: boolean;
    color: string;
    section: string;
    x: number;
    y: number;
    w: number;
    h: number;
};

const NODE_W = 90;
const NODE_H = 28;
const GAP_X = 16;
const GAP_Y = 8;

/** Map signal flow node sections to the actual SectionNav section IDs */
const SECTION_MAP: Record<string, string> = {
    osc: 'osc',
    warp: 'osc',
    filter: 'filter',
    voicefx: 'fx',
    dist: 'fx',
    comp: 'fx',
    reverb: 'fx',
    eq: 'fx',
    delay: 'fx',
    chorus: 'fx',
    phaser: 'fx',
    width: 'fx',
    master: 'fx',
};

export const SignalFlowView = ({
    patch, numLayers, activeLayer, onSelectSection,
}: SignalFlowViewProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Build node graph
    const nodes: FlowNode[] = [];
    const connections: Array<[number, number]> = [];

    let x = 10;
    const y0 = 10;

    // Layer generators
    for (let i = 0; i < numLayers; i++) {
        const isActive = i === activeLayer;
        nodes.push({
            label: `Layer ${i + 1}`,
            subtitle: isActive ? ENGINE_NAMES[patch.oscEngine] ?? 'WT' : '—',
            active: isActive,
            color: ['#60C8E8', '#70E8A0', '#E8A060', '#B888E8'][i] ?? '#888',
            section: 'osc',
            x, y: y0 + i * (NODE_H + GAP_Y),
            w: NODE_W, h: NODE_H,
        });
    }

    // Warp
    const warpActive = patch.warpMode > 0 && patch.warpAmount > 0.001;
    x += NODE_W + GAP_X;
    const warpIdx = nodes.length;
    nodes.push({
        label: 'Warp',
        subtitle: warpActive ? WARP_MODE_NAMES[patch.warpMode] : 'Off',
        active: warpActive,
        color: '#E8A060',
        section: 'warp',
        x, y: y0, w: NODE_W, h: NODE_H,
    });
    for (let i = 0; i < numLayers; i++) connections.push([i, warpIdx]);

    // Filter
    x += NODE_W + GAP_X;
    const filterIdx = nodes.length;
    nodes.push({
        label: 'Filter',
        subtitle: FILTER_MODEL_NAMES[patch.filterModel] ?? 'SVF',
        active: true,
        color: '#60C8E8',
        section: 'filter',
        x, y: y0, w: NODE_W, h: NODE_H,
    });
    connections.push([warpIdx, filterIdx]);

    // Voice Drive
    const vdActive = patch.voiceDrive > 0.001;
    x += NODE_W + GAP_X;
    const vdIdx = nodes.length;
    nodes.push({
        label: 'Voice FX',
        subtitle: vdActive ? `Drive ${patch.voiceDrive.toFixed(1)}` : 'Off',
        active: vdActive,
        color: '#E86060',
        section: 'voicefx',
        x, y: y0, w: NODE_W, h: NODE_H,
    });
    connections.push([filterIdx, vdIdx]);

    // Distortion
    const distActive = patch.distMix > 0.001;
    x += NODE_W + GAP_X;
    const distIdx = nodes.length;
    nodes.push({
        label: 'Distortion',
        subtitle: distActive ? `${Math.round(patch.distMix * 100)}%` : 'Off',
        active: distActive,
        color: '#E86060',
        section: 'dist',
        x, y: y0, w: NODE_W, h: NODE_H,
    });
    connections.push([vdIdx, distIdx]);

    // Compressor
    const compActive = patch.compMix > 0.001;
    x += NODE_W + GAP_X;
    const compIdx = nodes.length;
    nodes.push({
        label: 'Compressor',
        subtitle: compActive ? `${patch.compRatio.toFixed(0)}:1` : 'Off',
        active: compActive,
        color: '#B888E8',
        section: 'comp',
        x, y: y0, w: NODE_W, h: NODE_H,
    });
    connections.push([distIdx, compIdx]);

    // Reverb
    x += NODE_W + GAP_X;
    const revIdx = nodes.length;
    const revActive = patch.reverbMix > 0.001;
    nodes.push({
        label: patch.reverbType === 0 ? 'Plate Rev' : 'FDN Rev',
        subtitle: revActive ? `${Math.round(patch.reverbMix * 100)}%` : 'Off',
        active: revActive,
        color: '#70E8A0',
        section: 'reverb',
        x, y: y0, w: NODE_W, h: NODE_H,
    });
    connections.push([compIdx, revIdx]);

    // EQ
    const eqActive = Math.abs(patch.eqLowGain) > 0.1 || Math.abs(patch.eqMidGain) > 0.1 || Math.abs(patch.eqHighGain) > 0.1;
    x += NODE_W + GAP_X;
    const eqIdx = nodes.length;
    nodes.push({
        label: 'EQ',
        subtitle: eqActive ? '3-Band' : 'Flat',
        active: eqActive,
        color: '#E8E060',
        section: 'eq',
        x, y: y0, w: NODE_W, h: NODE_H,
    });
    connections.push([revIdx, eqIdx]);

    // Effects row 2: Delay, Chorus, Phaser
    const row2y = y0 + NODE_H + GAP_Y + 6;
    let fx2x = nodes[distIdx]!.x;

    const delActive = patch.delayMix > 0.001;
    const delIdx = nodes.length;
    nodes.push({
        label: 'Delay',
        subtitle: delActive ? `${Math.round(patch.delayTime)}ms` : 'Off',
        active: delActive,
        color: '#60C8E8',
        section: 'delay',
        x: fx2x, y: row2y, w: 70, h: 22,
    });
    connections.push([distIdx, delIdx]);
    connections.push([delIdx, revIdx]);

    fx2x += 78;
    const chrActive = patch.chorusMix > 0.001;
    const chrIdx = nodes.length;
    nodes.push({
        label: 'Chorus',
        subtitle: chrActive ? `${Math.round(patch.chorusMix * 100)}%` : 'Off',
        active: chrActive,
        color: '#60C8E8',
        section: 'chorus',
        x: fx2x, y: row2y, w: 70, h: 22,
    });
    connections.push([delIdx, chrIdx]);
    connections.push([chrIdx, revIdx]);

    fx2x += 78;
    const phActive = patch.phaserMix > 0.001;
    const phIdx = nodes.length;
    nodes.push({
        label: 'Phaser',
        subtitle: phActive ? `${Math.round(patch.phaserMix * 100)}%` : 'Off',
        active: phActive,
        color: '#60C8E8',
        section: 'phaser',
        x: fx2x, y: row2y, w: 70, h: 22,
    });
    connections.push([chrIdx, phIdx]);

    // Width + Master
    x += NODE_W + GAP_X;
    const widthIdx = nodes.length;
    nodes.push({
        label: 'Width',
        subtitle: `${Math.round(patch.stereoWidth * 100)}%`,
        active: Math.abs(patch.stereoWidth - 1.0) > 0.01,
        color: '#B888E8',
        section: 'width',
        x, y: y0, w: 60, h: NODE_H,
    });
    connections.push([eqIdx, widthIdx]);

    x += 68;
    const masterIdx = nodes.length;
    nodes.push({
        label: 'Master',
        subtitle: `${(patch.masterGain * 100).toFixed(0)}%`,
        active: true,
        color: '#FFF',
        section: 'master',
        x, y: y0, w: 60, h: NODE_H,
    });
    connections.push([widthIdx, masterIdx]);

    const canvasW = x + 70;
    const canvasH = row2y + 30;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvasW * dpr;
        canvas.height = canvasH * dpr;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, canvasW, canvasH);

        // Draw connections with subtle glow
        for (const [from, to] of connections) {
            const fn = nodes[from]!;
            const tn = nodes[to]!;
            const fromActive = fn.active;
            ctx.strokeStyle = fromActive ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(fn.x + fn.w, fn.y + fn.h / 2);
            ctx.lineTo(tn.x, tn.y + tn.h / 2);
            ctx.stroke();
        }

        // Draw nodes
        for (const node of nodes) {
            const alpha = node.active ? 1.0 : 0.35;
            ctx.globalAlpha = alpha;

            // Node background — recessed look
            const grad = ctx.createLinearGradient(node.x, node.y, node.x, node.y + node.h);
            grad.addColorStop(0, 'rgba(18,18,24,0.9)');
            grad.addColorStop(1, 'rgba(24,24,32,0.9)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.roundRect(node.x, node.y, node.w, node.h, 5);
            ctx.fill();

            // Border — colored left edge, subtle elsewhere
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Colored left accent bar
            ctx.fillStyle = node.color;
            ctx.beginPath();
            ctx.roundRect(node.x, node.y, 3, node.h, [5, 0, 0, 5]);
            ctx.fill();

            // Label
            ctx.fillStyle = node.active ? '#e0e0e0' : '#888';
            ctx.font = 'bold 8px system-ui';
            ctx.textAlign = 'center';
            ctx.fillText(node.label, node.x + node.w / 2 + 1, node.y + 12);

            // Subtitle
            if (node.subtitle) {
                ctx.fillStyle = node.color;
                ctx.font = '7px system-ui';
                ctx.fillText(node.subtitle, node.x + node.w / 2 + 1, node.y + 22);
            }

            ctx.globalAlpha = 1.0;
        }
    }, [patch, numLayers, activeLayer]);

    return (
        <DawDiagramFrame title="Signal flow" compact className="bg-black/[0.16]" viewportClassName="p-2">
            <div className="overflow-x-auto">
            <canvas
                ref={canvasRef}
                style={{ width: canvasW, height: canvasH }}
                className="cursor-pointer"
                onClick={(e) => {
                    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
                    const mx = e.clientX - rect.left;
                    const my = e.clientY - rect.top;
                    for (const node of nodes) {
                        if (mx >= node.x && mx <= node.x + node.w && my >= node.y && my <= node.y + node.h) {
                            onSelectSection(SECTION_MAP[node.section] ?? node.section);
                            break;
                        }
                    }
                }}
            />
            </div>
        </DawDiagramFrame>
    );
};
