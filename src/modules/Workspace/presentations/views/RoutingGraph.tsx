import { type ReactElement, useSyncExternalStore } from 'react';
import { trackStore, type TrackStoreState } from '#/modules/Track/stores/trackStore';
import { getAllSidechainRoutes } from '../../useCases/workspaceViewActions';
import { selectTrack } from '../../useCases/workspaceViewActions';
import { type Track } from '../../useCases/workspaceViewActions';
import { type SidechainRoute } from '../../useCases/workspaceViewActions';

const defaultState: TrackStoreState = { tracks: [], selectedTrackId: null };

const NODE_W = 100;
const NODE_H = 32;
const COL_GAP = 80;
const ROW_GAP = 12;
const PAD = 16;

type NodePosition = { x: number; y: number; track: Track };

const KIND_FILLS: Record<string, string> = {
    audio: '#3b82f6',
    midi: '#a855f7',
    bus: '#f59e0b',
    master: '#ef4444',
    folder: '#6b7280',
};

function layoutNodes(tracks: Track[]): {
    sources: NodePosition[];
    buses: NodePosition[];
    master: NodePosition | null;
    width: number;
    height: number;
} {
    const sources = tracks.filter((t) => t.kind === 'audio' || t.kind === 'midi');
    const buses = tracks.filter((t) => t.kind === 'bus');
    const masterTrack = tracks.find((t) => t.kind === 'master') ?? null;

    const sourcePositions: NodePosition[] = sources.map((track, i) => ({
        x: PAD,
        y: PAD + i * (NODE_H + ROW_GAP),
        track,
    }));

    const busColX = PAD + NODE_W + COL_GAP;
    const busPositions: NodePosition[] = buses.map((track, i) => ({
        x: busColX,
        y: PAD + i * (NODE_H + ROW_GAP),
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
    const fill = KIND_FILLS[pos.track.kind] ?? '#6b7280';

    return (
        <g
            className="cursor-pointer"
            onClick={() => {
                selectTrack(pos.track.id);
            }}
            role="button"
            tabIndex={0}
            aria-label={`Select ${pos.track.name}`}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
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
                stroke={isSelected ? '#ffffff' : fill}
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
    const strokeColor = variant === 'sidechain' ? '#ef4444' : highlighted ? '#ffffff' : '#64748b';

    const dashArray = variant === 'output' ? undefined : variant === 'send' ? '4 3' : '2 3';

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
            {label && (
                <text
                    x={midX}
                    y={(from.y + to.y) / 2 - 6}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[7px] pointer-events-none select-none"
                >
                    {label}
                </text>
            )}
        </g>
    );
};

export const RoutingGraph = (): ReactElement => {
    const state = useSyncExternalStore(
        (cb) =>
            trackStore.subscribe(() => {
                cb();
            }),
        () => trackStore.value ?? defaultState,
        () => trackStore.value ?? defaultState
    );

    const { tracks, selectedTrackId } = state;
    const sidechainRoutes: SidechainRoute[] = getAllSidechainRoutes();

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
        const selectedTrack = tracks.find((t) => t.id === selectedTrackId);
        if (!selectedTrack) {
            return false;
        }
        if (selectedTrack.outputId === trackId) {
            return true;
        }
        if (selectedTrack.sends.some((s) => s.busId === trackId)) {
            return true;
        }
        const track = tracks.find((t) => t.id === trackId);
        if (track && (track.outputId === selectedTrackId || track.sends.some((s) => s.busId === selectedTrackId))) {
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
            <div className="flex items-center justify-center p-4">
                <p className="text-[10px] text-muted-foreground">No tracks to display.</p>
            </div>
        );
    }

    return (
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Signal routing graph">
            {/* Output connections (track → output target) */}
            {[...sources, ...buses].map((pos) => {
                const targetId = pos.track.outputId;
                const targetPos = targetId === 'master' ? master : (positionMap.get(targetId) ?? master);

                if (!targetPos) {
                    return null;
                }

                const from = getNodeCenter(pos, 'right');
                const to = getNodeCenter(targetPos, 'left');
                const highlighted = isConnectedToSelected(pos.track.id) || isConnectedToSelected(targetPos.track.id);

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

            {/* Send connections */}
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

            {/* Sidechain connections */}
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

            {/* Nodes on top of lines */}
            {allPositions.map((pos) => (
                <TrackNode key={pos.track.id} pos={pos} isSelected={pos.track.id === selectedTrackId} />
            ))}

            {/* Legend */}
            <g transform={`translate(${PAD}, ${height - 28})`}>
                <line x1={0} y1={0} x2={16} y2={0} stroke="#64748b" strokeWidth={1} />
                <text x={20} y={0} dominantBaseline="central" className="fill-muted-foreground text-[7px]">
                    Output
                </text>

                <line x1={60} y1={0} x2={76} y2={0} stroke="#64748b" strokeWidth={1} strokeDasharray="4 3" />
                <text x={80} y={0} dominantBaseline="central" className="fill-muted-foreground text-[7px]">
                    Send
                </text>

                <line x1={110} y1={0} x2={126} y2={0} stroke="#ef4444" strokeWidth={1} strokeDasharray="2 3" />
                <text x={130} y={0} dominantBaseline="central" className="fill-muted-foreground text-[7px]">
                    Sidechain
                </text>
            </g>
        </svg>
    );
};
