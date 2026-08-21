import { type ReactElement } from 'react';

import { DawDiagramFrame } from '#/components/daw/DawDiagramFrame';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { Row } from '#/components/layout';
import { useStore } from '#/infra/store/useStore';
import { trackStore } from '#/modules/Arrangement/stores';
import { selectTrack } from '#/modules/Arrangement/useCases';
import { resolveToken } from '#/utils/UI/resolveToken';

import { type Track } from '../../models/TrackViewTypes';
import { defaultSidechainStoreState, sidechainStore } from '../../stores/sidechainStore';

type RoutingTrackState = {
    tracks: Track[];
    selectedTrackId: string | null;
};

type RoutingSidechainRoute = {
    id: string;
    sourceTrackId: string;
    targetTrackId: string;
};

const defaultTrackState: RoutingTrackState = { tracks: [], selectedTrackId: null };

const NODE_W = 100;
const NODE_H = 32;
const COL_GAP = 80;
const ROW_GAP = 12;
const PAD = 16;

type NodePosition = { x: number; y: number; track: Track };

const KIND_FILLS: Record<string, string> = {
    audio: resolveToken('--color-palette-steel', '#4a7090'),
    midi: resolveToken('--color-accent-lavender', '#a89bc4'),
    bus: resolveToken('--color-palette-amber', '#b09040'),
    master: resolveToken('--color-state-record', '#c45040'),
    folder: resolveToken('--color-text-tertiary', '#737373'),
};

function layoutNodes(tracks: Track[]): {
    sources: NodePosition[];
    buses: NodePosition[];
    master: NodePosition | null;
    width: number;
    height: number;
} {
    const sources = tracks.filter((time) => time.kind === 'audio' || time.kind === 'midi');
    const buses = tracks.filter((time) => time.kind === 'bus');
    const masterTrack = tracks.find((time) => time.kind === 'master') ?? null;

    const sourcePositions: NodePosition[] = sources.map((track, index) => ({
        x: PAD,
        y: PAD + index * (NODE_H + ROW_GAP),
        track,
    }));

    const busColX = PAD + NODE_W + COL_GAP;
    const busPositions: NodePosition[] = buses.map((track, index) => ({
        x: busColX,
        y: PAD + index * (NODE_H + ROW_GAP),
        track,
    }));

    const masterColX = buses.length > 0 ? busColX + NODE_W + COL_GAP : PAD + NODE_W + COL_GAP;

    const masterPosition: NodePosition | null = masterTrack ? { x: masterColX, y: PAD, track: masterTrack } : null;

    const maxRows = Math.max(sources.length, buses.length, 1);
    const height = PAD * 2 + maxRows * (NODE_H + ROW_GAP) - ROW_GAP;
    const width = (masterPosition ? masterPosition.x + NODE_W : busColX + NODE_W) + PAD;

    return { sources: sourcePositions, buses: busPositions, master: masterPosition, width, height };
}

function getNodeCenter(pos: NodePosition, side: 'left' | 'right'): { x: number; y: number } {
    return {
        x: side === 'right' ? pos.x + NODE_W : pos.x,
        y: pos.y + NODE_H / 2,
    };
}

const TrackNode = ({ pos, isSelected }: { pos: NodePosition; isSelected: boolean }): ReactElement => {
    const fill = KIND_FILLS[pos.track.kind] ?? resolveToken('--color-text-tertiary', '#737373');

    return (
        <g
            className="cursor-pointer"
            onClick={() => {
                selectTrack(pos.track.id);
            }}
            role="button"
            tabIndex={0}
            aria-label={`Select ${pos.track.name}`}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    selectTrack(pos.track.id);
                }
            }}
        >
            <rect
                x={pos.x}
                y={pos.y}
                width={NODE_W}
                height={NODE_H}
                rx={4}
                fill={fill}
                fillOpacity={0.15}
                stroke={isSelected ? resolveToken('--color-text-primary', '#eaeaea') : fill}
                strokeWidth={isSelected ? 2 : 1}
            />
            <text
                x={pos.x + NODE_W / 2}
                y={pos.y + NODE_H / 2}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-foreground text-[9px] pointer-events-none select-none"
            >
                {pos.track.name.length > 12 ? `${pos.track.name.slice(0, 11)}…` : pos.track.name}
            </text>
        </g>
    );
};

const ConnectionLine = ({
    from,
    to,
    variant,
    label,
    highlighted,
}: {
    from: { x: number; y: number };
    to: { x: number; y: number };
    variant: 'output' | 'send' | 'sidechain';
    label?: string;
    highlighted: boolean;
}): ReactElement => {
    const strokeColor = (() => {
        if (variant === 'sidechain') {
            return resolveToken('--color-state-record', '#c45040');
        }
        if (highlighted) {
            return resolveToken('--color-text-primary', '#eaeaea');
        }
        return resolveToken('--color-text-tertiary', '#737373');
    })();

    const dashArray = (() => {
        if (variant === 'output') {
            return undefined;
        }
        if (variant === 'send') {
            return '4 3';
        }
        return '2 3';
    })();

    const midX = (from.x + to.x) / 2;

    const path = `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;

    return (
        <g>
            <path
                d={path}
                fill="none"
                stroke={strokeColor}
                strokeWidth={highlighted ? 1.5 : 1}
                strokeDasharray={dashArray}
                opacity={highlighted ? 1 : 0.5}
            />
            {label ? (
                <text
                    x={midX}
                    y={(from.y + to.y) / 2 - 6}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[10px] pointer-events-none select-none"
                >
                    {label}
                </text>
            ) : null}
        </g>
    );
};

export const RoutingGraph = (): ReactElement => {
    const state = useStore<RoutingTrackState>(trackStore, defaultTrackState);
    // §201.1 — subscribe reactively so adding/removing a sidechain
    // route re-renders the graph instead of showing stale connections.
    const sidechainState = useStore(sidechainStore, defaultSidechainStoreState);

    const { tracks, selectedTrackId } = state;
    const sidechainRoutes: RoutingSidechainRoute[] = sidechainState.routes;

    const { sources, buses, master, width, height } = layoutNodes(tracks);

    const allPositions = [...sources, ...buses, ...(master ? [master] : [])];
    const positionMap = new Map<string, NodePosition>();
    for (const pos of allPositions) {
        positionMap.set(pos.track.id, pos);
    }

    const isConnectedToSelected = (trackId: string): boolean => {
        if (!selectedTrackId) {
            return false;
        }
        if (trackId === selectedTrackId) {
            return true;
        }
        const selectedTrack = tracks.find((time) => time.id === selectedTrackId);
        if (!selectedTrack) {
            return false;
        }
        if (selectedTrack.outputId === trackId) {
            return true;
        }
        if (selectedTrack.sends.some((state1) => state1.busId === trackId)) {
            return true;
        }
        const track = tracks.find((time) => time.id === trackId);
        if (
            track &&
            (track.outputId === selectedTrackId || track.sends.some((state1) => state1.busId === selectedTrackId))
        ) {
            return true;
        }
        return sidechainRoutes.some(
            (r) =>
                (r.sourceTrackId === selectedTrackId && r.targetTrackId === trackId) ||
                (r.targetTrackId === selectedTrackId && r.sourceTrackId === trackId)
        );
    };

    if (tracks.length === 0) {
        return (
            <DawDiagramFrame title="Routing graph" className="h-full">
                <Row justify="center" className="h-full p-4">
                    <DawEmptyState
                        title="No routing to display"
                        description="Add tracks or buses to inspect the project signal graph."
                        className="max-w-xs"
                    />
                </Row>
            </DawDiagramFrame>
        );
    }

    return (
        <DawDiagramFrame
            title="Routing graph"
            className="h-full"
            viewportClassName="p-3"
            footer={
                <Row wrap gap={4} className="text-[10px] text-muted-foreground">
                    <Row gap={2}>
                        <span className="h-px w-4 bg-muted-foreground/70" />
                        Output
                    </Row>
                    <Row gap={2}>
                        <span className="h-px w-4 border-t border-dashed border-muted-foreground/70" />
                        Send
                    </Row>
                    <Row gap={2}>
                        <span className="h-px w-4 border-t border-dashed border-[var(--color-state-record)]/80" />
                        Sidechain
                    </Row>
                </Row>
            }
        >
            <div className="overflow-x-auto">
                <svg
                    viewBox={`0 0 ${width} ${height}`}
                    className="min-w-[420px]"
                    role="img"
                    aria-label="Signal routing graph"
                    data-testid="routing-graph"
                >
                    {[...sources, ...buses].map((pos) => {
                        const targetId = pos.track.outputId;
                        const targetPos = targetId === 'master' ? master : (positionMap.get(targetId) ?? master);

                        if (!targetPos) {
                            return null;
                        }

                        const from = getNodeCenter(pos, 'right');
                        const to = getNodeCenter(targetPos, 'left');
                        const highlighted =
                            isConnectedToSelected(pos.track.id) || isConnectedToSelected(targetPos.track.id);

                        return (
                            <ConnectionLine
                                key={`out-${pos.track.id}`}
                                from={from}
                                to={to}
                                variant="output"
                                highlighted={highlighted}
                            />
                        );
                    })}

                    {[...sources, ...buses].flatMap((pos) =>
                        pos.track.sends
                            .filter((send) => send.level > 0)
                            .map((send) => {
                                const busPos = positionMap.get(send.busId);
                                if (!busPos) {
                                    return null;
                                }

                                const from = getNodeCenter(pos, 'right');
                                const to = getNodeCenter(busPos, 'left');
                                const highlighted =
                                    isConnectedToSelected(pos.track.id) || isConnectedToSelected(busPos.track.id);
                                const label = `${(send.level * 100).toFixed(0)}%${send.preFader ? ' pre' : ''}`;

                                return (
                                    <ConnectionLine
                                        key={`send-${pos.track.id}-${send.busId}`}
                                        from={from}
                                        to={to}
                                        variant="send"
                                        label={label}
                                        highlighted={highlighted}
                                    />
                                );
                            })
                    )}

                    {sidechainRoutes.map((route) => {
                        const sourcePos = positionMap.get(route.sourceTrackId);
                        const targetPos = positionMap.get(route.targetTrackId);
                        if (!sourcePos || !targetPos) {
                            return null;
                        }

                        const from = getNodeCenter(sourcePos, 'right');
                        const to = getNodeCenter(targetPos, 'left');
                        const highlighted =
                            isConnectedToSelected(route.sourceTrackId) || isConnectedToSelected(route.targetTrackId);

                        return (
                            <ConnectionLine
                                key={`sc-${route.id}`}
                                from={from}
                                to={to}
                                variant="sidechain"
                                highlighted={highlighted}
                            />
                        );
                    })}

                    {allPositions.map((pos) => (
                        <TrackNode key={pos.track.id} pos={pos} isSelected={pos.track.id === selectedTrackId} />
                    ))}
                </svg>
            </div>
        </DawDiagramFrame>
    );
};
