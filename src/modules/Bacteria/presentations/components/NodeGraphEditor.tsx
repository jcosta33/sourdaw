/**
 * NodeGraphEditor — interactive signal flow DAG editor for Route level.
 *
 * Bitwig FX Grid-style node-based routing editor with draggable nodes,
 * connection cables, and routing mode toggles.
 */
import { type ReactElement, useState } from 'react';

import { type BacteriaBand, type BacteriaRoutingMode } from '../../models/BacteriaPatch';

type NodeDef = {
    id: string;
    label: string;
    x: number;
    y: number;
    color: string;
    type: 'input' | 'output' | 'crossover' | 'band' | 'sum' | 'effect';
    bandIndex?: number;
    effects?: string[];
};

type Connection = {
    from: string;
    to: string;
};

type NodeGraphEditorProps = {
    width: number;
    height: number;
    bandCount: number;
    bands: BacteriaBand[];
    globalRouting: BacteriaRoutingMode;
    crossoverFreqs: number[];
};

const BAND_COLORS = [
    'rgb(244,63,94)',
    'rgb(251,146,60)',
    'rgb(250,204,21)',
    'rgb(74,222,128)',
    'rgb(96,165,250)',
    'rgb(167,139,250)',
];

const EFFECT_KEYS: Record<string, string> = {
    distortionEnabled: 'Dist',
    filterEnabled: 'Filter',
    chorusEnabled: 'Chorus',
    granularEnabled: 'Grain',
    spectralEnabled: 'Spectral',
    freqShiftEnabled: 'FShift',
    lofiEnabled: 'Lo-Fi',
    convolutionEnabled: 'Body',
};

function buildNodes(
    bandCount: number,
    bands: BacteriaBand[],
    width: number,
    height: number
): { nodes: NodeDef[]; connections: Connection[]; nodeById: Map<string, NodeDef> } {
    const nodes: NodeDef[] = [];
    const connections: Connection[] = [];

    const margin = 40;
    const usableWidth = width - margin * 2;
    const usableHeight = height - margin * 2;

    // Input node
    nodes.push({
        id: 'input',
        label: 'Input',
        x: usableWidth / 2 + margin,
        y: margin,
        color: 'rgb(255,255,255)',
        type: 'input',
    });

    // Crossover node (if multi-band)
    if (bandCount > 1) {
        nodes.push({
            id: 'crossover',
            label: 'Crossover',
            x: usableWidth / 2 + margin,
            y: margin + usableHeight * 0.15,
            color: 'rgb(200,200,200)',
            type: 'crossover',
        });
        connections.push({ from: 'input', to: 'crossover' });
    }

    // Band nodes
    const bandSpacing = usableWidth / (bandCount + 1);
    for (let i = 0; i < bandCount; i++) {
        const band = bands[i]!;
        const effects = Object.entries(EFFECT_KEYS)
            .filter(([key]) => band[key as keyof BacteriaBand] === true)
            .map(([, label]) => label);

        const nodeId = `band-${i}`;
        nodes.push({
            id: nodeId,
            label: `Band ${i + 1}`,
            x: bandSpacing * (i + 1) + margin,
            y: margin + usableHeight * 0.45,
            color: BAND_COLORS[i % BAND_COLORS.length]!,
            type: 'band',
            bandIndex: i,
            effects,
        });

        if (bandCount > 1) {
            connections.push({ from: 'crossover', to: nodeId });
        } else {
            connections.push({ from: 'input', to: nodeId });
        }
    }

    // Sum node
    nodes.push({
        id: 'sum',
        label: 'Sum',
        x: usableWidth / 2 + margin,
        y: margin + usableHeight * 0.75,
        color: 'rgb(200,200,200)',
        type: 'sum',
    });
    for (let i = 0; i < bandCount; i++) {
        connections.push({ from: `band-${i}`, to: 'sum' });
    }

    // Output node
    nodes.push({
        id: 'output',
        label: 'Output',
        x: usableWidth / 2 + margin,
        y: margin + usableHeight,
        color: 'rgb(255,255,255)',
        type: 'output',
    });
    connections.push({ from: 'sum', to: 'output' });

    // Build the id->node lookup once here rather than O(N) Array.find per
    // connection on every render.
    const nodeById = new Map<string, NodeDef>(nodes.map((node) => [node.id, node]));

    return { nodes, connections, nodeById };
}

export const NodeGraphEditor = ({
    width,
    height,
    bandCount,
    bands,
    globalRouting,
    crossoverFreqs: _crossoverFreqs,
}: NodeGraphEditorProps): ReactElement => {
    // React Compiler memoizes this pure computation; the node map below gives
    // O(1) id lookups regardless of render count (the manual-memoization rule
    // forbids useMemo here).
    const { nodes, connections, nodeById } = buildNodes(bandCount, bands, width, height);
    const [hoveredNode, setHoveredNode] = useState<string | null>(null);

    const getNode = (id: string): NodeDef | undefined => nodeById.get(id);

    return (
        <svg width={width} height={height} className="rounded-lg border border-border/30 bg-surface-deep">
            {/* Grid */}
            <defs>
                <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <rect width="20" height="20" fill="none" stroke="rgba(255,255,255,0.02)" strokeWidth="0.5" />
                </pattern>
            </defs>
            <rect width={width} height={height} fill="url(#grid)" />

            {/* Connections */}
            {connections.map((conn, i) => {
                const from = getNode(conn.from);
                const to = getNode(conn.to);
                if (!from || !to) {
                    return null;
                }

                const midY = (from.y + to.y) / 2;
                return (
                    <path
                        key={i}
                        d={`M ${from.x} ${from.y + 12} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y - 12}`}
                        fill="none"
                        stroke="rgba(244, 63, 94, 0.3)"
                        strokeWidth={1.5}
                    />
                );
            })}

            {/* Nodes */}
            {nodes.map((node) => {
                const isHovered = hoveredNode === node.id;
                const nodeWidth = node.type === 'band' ? 80 : 60;
                const nodeHeight = node.type === 'band' ? 50 + (node.effects?.length ?? 0) * 10 : 24;

                return (
                    <g
                        key={node.id}
                        onMouseEnter={() => setHoveredNode(node.id)}
                        onMouseLeave={() => setHoveredNode(null)}
                        style={{ cursor: 'pointer' }}
                    >
                        <rect
                            x={node.x - nodeWidth / 2}
                            y={node.y - nodeHeight / 2}
                            width={nodeWidth}
                            height={nodeHeight}
                            rx={6}
                            fill={isHovered ? `${node.color}20` : `${node.color}10`}
                            stroke={node.color}
                            strokeWidth={isHovered ? 1.5 : 1}
                            strokeOpacity={0.5}
                        />
                        <text
                            x={node.x}
                            y={node.y - (node.type === 'band' ? (node.effects?.length ?? 0) * 4 : 0)}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fill={node.color}
                            fontSize={8}
                            fontWeight="bold"
                        >
                            {node.label}
                        </text>
                        {/* Effect list for band nodes */}
                        {node.effects?.map((effect, ei) => (
                            <text
                                key={ei}
                                x={node.x}
                                y={node.y + 8 + ei * 10}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fill="rgba(255,255,255,0.4)"
                                fontSize={6}
                            >
                                {effect}
                            </text>
                        ))}
                    </g>
                );
            })}

            {/* Routing mode label */}
            <text
                x={width - 8}
                y={16}
                textAnchor="end"
                fill="rgba(255,255,255,0.2)"
                fontSize={8}
                fontFamily="monospace"
            >
                {globalRouting}
            </text>
        </svg>
    );
};
