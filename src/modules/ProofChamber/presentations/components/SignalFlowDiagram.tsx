/**
 * SignalFlowDiagram — SVG-based routing visualization.
 *
 * Shows the current algorithm topology: input → processing stages → output.
 * Updates dynamically when the algorithm or routing changes.
 */
import { type ReactElement } from 'react';

import { DawDiagramFrame } from '#/components/daw/DawDiagramFrame';

import { type ProofChamberAlgorithm } from '../../models/ProofChamberState';

type SignalFlowDiagramProps = {
    algorithm: ProofChamberAlgorithm;
    shimmerEnabled: boolean;
    freezeEnabled: boolean;
};

type FlowNode = { id: string; label: string; x: number; y: number; active: boolean; color: string };
type FlowEdge = { from: string; to: string; label?: string };

function getFlowForAlgorithm(
    algorithm: ProofChamberAlgorithm,
    shimmer: boolean,
    freeze: boolean
): { nodes: FlowNode[]; edges: FlowEdge[] } {
    const accent = '#7fb8c4';
    const dim = '#444';

    switch (algorithm) {
        case 'plate':
            return {
                nodes: [
                    { id: 'in', label: 'Input', x: 10, y: 30, active: !freeze, color: accent },
                    { id: 'bw', label: 'BW Filter', x: 80, y: 30, active: true, color: accent },
                    { id: 'diff', label: '4× Diffuser', x: 170, y: 30, active: true, color: accent },
                    { id: 'tank_l', label: 'Tank L', x: 280, y: 15, active: true, color: '#a89bc4' },
                    { id: 'tank_r', label: 'Tank R', x: 280, y: 45, active: true, color: '#a89bc4' },
                    { id: 'taps', label: '14 Taps', x: 380, y: 30, active: true, color: accent },
                    { id: 'out', label: 'Stereo Out', x: 470, y: 30, active: true, color: accent },
                    ...(shimmer
                        ? [{ id: 'shim', label: 'Shimmer', x: 340, y: 55, active: true, color: '#c9a07a' }]
                        : []),
                ],
                edges: [
                    { from: 'in', to: 'bw' },
                    { from: 'bw', to: 'diff' },
                    { from: 'diff', to: 'tank_l' },
                    { from: 'diff', to: 'tank_r' },
                    { from: 'tank_l', to: 'tank_r', label: '×decay' },
                    { from: 'tank_r', to: 'tank_l', label: '×decay' },
                    { from: 'tank_l', to: 'taps' },
                    { from: 'tank_r', to: 'taps' },
                    { from: 'taps', to: 'out' },
                    ...(shimmer
                        ? [
                              { from: 'tank_l', to: 'shim' },
                              { from: 'shim', to: 'tank_r' },
                          ]
                        : []),
                ],
            };

        case 'fdn-8':
        case 'fdn-16': {
            const node = algorithm === 'fdn-8' ? 8 : 16;
            return {
                nodes: [
                    { id: 'in', label: 'Input', x: 10, y: 30, active: !freeze, color: accent },
                    { id: 'early', label: 'Early Ref', x: 90, y: 15, active: true, color: '#7db8a0' },
                    { id: 'fdn', label: `FDN-${node}`, x: 200, y: 30, active: true, color: '#a89bc4' },
                    { id: 'matrix', label: 'Hadamard', x: 310, y: 30, active: true, color: '#a89bc4' },
                    { id: 'absorb', label: 'Absorptive', x: 310, y: 55, active: true, color: dim },
                    { id: 'mix', label: 'E/L Mix', x: 400, y: 30, active: true, color: accent },
                    { id: 'out', label: 'Stereo Out', x: 470, y: 30, active: true, color: accent },
                ],
                edges: [
                    { from: 'in', to: 'early' },
                    { from: 'in', to: 'fdn' },
                    { from: 'fdn', to: 'matrix' },
                    { from: 'matrix', to: 'fdn', label: 'feedback' },
                    { from: 'matrix', to: 'absorb' },
                    { from: 'absorb', to: 'fdn' },
                    { from: 'early', to: 'mix' },
                    { from: 'matrix', to: 'mix' },
                    { from: 'mix', to: 'out' },
                ],
            };
        }

        case 'spring':
            return {
                nodes: [
                    { id: 'in', label: 'Input', x: 10, y: 30, active: true, color: accent },
                    { id: 'disp', label: '80× Allpass', x: 120, y: 30, active: true, color: '#c9a07a' },
                    { id: 'delay', label: 'Spring Delay', x: 260, y: 30, active: true, color: '#c9a07a' },
                    { id: 'damp', label: 'Damping', x: 260, y: 55, active: true, color: dim },
                    { id: 'out', label: 'Stereo Out', x: 400, y: 30, active: true, color: accent },
                ],
                edges: [
                    { from: 'in', to: 'disp' },
                    { from: 'disp', to: 'delay' },
                    { from: 'delay', to: 'damp' },
                    { from: 'damp', to: 'disp', label: 'feedback' },
                    { from: 'delay', to: 'out' },
                ],
            };

        // Reverse is the one engine with no feedback path: input fills one of
        // two buffers while the other is read backwards, so the diagram is a
        // straight line through the swap rather than a loop. `reverse.rs`.
        case 'reverse':
            return {
                nodes: [
                    { id: 'in', label: 'Input', x: 10, y: 30, active: !freeze, color: accent },
                    { id: 'buf', label: 'Reverse Buf', x: 100, y: 30, active: true, color: '#a89bc4' },
                    { id: 'swap', label: 'A/B Swap', x: 200, y: 55, active: true, color: dim },
                    { id: 'flip', label: 'Grain Flip', x: 240, y: 30, active: true, color: '#c9a07a' },
                    { id: 'fade', label: 'Hann Fade', x: 350, y: 30, active: true, color: accent },
                    { id: 'out', label: 'Stereo Out', x: 450, y: 30, active: true, color: accent },
                ],
                edges: [
                    { from: 'in', to: 'buf' },
                    { from: 'buf', to: 'swap' },
                    { from: 'swap', to: 'flip' },
                    { from: 'buf', to: 'flip', label: 'backwards' },
                    { from: 'flip', to: 'fade' },
                    { from: 'fade', to: 'out' },
                ],
            };

        default:
            return { nodes: [], edges: [] };
    }
}

export const SignalFlowDiagram = ({
    algorithm,
    shimmerEnabled,
    freezeEnabled,
}: SignalFlowDiagramProps): ReactElement => {
    const { nodes, edges } = getFlowForAlgorithm(algorithm, shimmerEnabled, freezeEnabled);

    return (
        <DawDiagramFrame title="Signal flow" compact className="bg-black/[0.16]" viewportClassName="p-2">
            <svg viewBox="0 0 500 65" className="h-[65px] w-full" xmlns="http://www.w3.org/2000/svg">
                {edges.map((edge, index) => {
                    const from = nodes.find((node) => node.id === edge.from);
                    const to = nodes.find((node) => node.id === edge.to);
                    if (!from || !to) {
                        return null;
                    }
                    const x1 = from.x + 30;
                    const y1 = from.y;
                    const x2 = to.x - 5;
                    const y2 = to.y;
                    return (
                        <g key={index}>
                            <line
                                x1={x1}
                                y1={y1}
                                x2={x2}
                                y2={y2}
                                stroke="rgba(127,184,196,0.3)"
                                strokeWidth="1"
                                markerEnd="url(#arrowhead)"
                            />
                            {edge.label ? (
                                <text
                                    x={(x1 + x2) / 2}
                                    y={(y1 + y2) / 2 - 3}
                                    fill="rgba(255,255,255,0.25)"
                                    fontSize="6"
                                    textAnchor="middle"
                                >
                                    {edge.label}
                                </text>
                            ) : null}
                        </g>
                    );
                })}

                {nodes.map((node) => (
                    <g key={node.id}>
                        <rect
                            x={node.x - 5}
                            y={node.y - 8}
                            width={60}
                            height={16}
                            rx="3"
                            fill={node.active ? `${node.color}20` : 'rgba(50,50,50,0.5)'}
                            stroke={node.active ? `${node.color}60` : 'rgba(80,80,80,0.3)'}
                            strokeWidth="0.5"
                        />
                        <text
                            x={node.x + 25}
                            y={node.y + 1}
                            fill={node.active ? node.color : 'rgba(100,100,100,0.5)'}
                            fontSize="7"
                            textAnchor="middle"
                            dominantBaseline="middle"
                        >
                            {node.label}
                        </text>
                    </g>
                ))}

                <defs>
                    <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
                        <polygon points="0 0, 6 2, 0 4" fill="rgba(127,184,196,0.3)" />
                    </marker>
                </defs>
            </svg>
        </DawDiagramFrame>
    );
};
