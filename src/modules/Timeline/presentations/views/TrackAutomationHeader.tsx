import { type ReactElement, useSyncExternalStore } from 'react';
import { cn } from '#/helpers/Styles/cn';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { trackStore } from '#/modules/Track/stores/trackStore';
import { automationStore } from '#/modules/Track/stores/automationStore';
import { addAutomationLane } from '#/modules/Track/useCases/automationUseCases';
import { timelineViewStore } from '#/modules/Timeline/stores/timelineViewStore';
import { AUTOMATION_SUB_LANE_HEIGHT } from '#/modules/Timeline/models/automationConstants';
import { ChevronDown, Plus, X } from 'lucide-react';

const RULER_HEIGHT = 24;

const PARAMETER_OPTIONS = [
    { id: 'gain', label: 'Volume' },
    { id: 'pan', label: 'Pan' },
    { id: 'send1', label: 'Send 1' },
    { id: 'send2', label: 'Send 2' },
    { id: 'mute', label: 'Mute' },
    { id: 'eq-low', label: 'EQ Low' },
    { id: 'eq-mid', label: 'EQ Mid' },
    { id: 'eq-high', label: 'EQ High' },
    { id: 'filter-freq', label: 'Filter Freq' },
    { id: 'filter-res', label: 'Filter Res' },
] as const;

type TrackAutomationHeadersProps = {
    containerHeight: number;
};

export const TrackAutomationHeaders = ({ containerHeight }: TrackAutomationHeadersProps): ReactElement | null => {
    const ws = useSyncExternalStore(
        (cb) => workspaceStore.subscribe(() => cb()),
        () => workspaceStore.value,
        () => workspaceStore.value,
    );
    const tracks = useSyncExternalStore(
        (cb) => trackStore.subscribe(() => cb()),
        () => trackStore.value,
        () => trackStore.value,
    );
    const autoState = useSyncExternalStore(
        (cb) => automationStore.subscribe(() => cb()),
        () => automationStore.value,
        () => automationStore.value,
    );
    const viewState = useSyncExternalStore(
        (cb) => timelineViewStore.subscribe(() => cb()),
        () => timelineViewStore.value,
        () => timelineViewStore.value,
    );

    if (!ws || ws.automationVisibility === 'hidden' || !tracks || !viewState) {
        return null;
    }

    const subLaneMap = ws.automationSubLanes;
    const scrollY = viewState.scrollY ?? 0;
    let trackYOffset = 0;

    const headers: ReactElement[] = [];

    for (const track of tracks.tracks) {
        const paramIds = subLaneMap[track.id] ?? [];
        const baseHeight = track.height - paramIds.length * AUTOMATION_SUB_LANE_HEIGHT;
        const totalHeight = track.height;

        if (paramIds.length > 0) {
            for (let si = 0; si < paramIds.length; si++) {
                const paramId = paramIds[si]!;
                const laneTop = trackYOffset + baseHeight + si * AUTOMATION_SUB_LANE_HEIGHT - scrollY + RULER_HEIGHT;

                // Skip if out of viewport
                if (laneTop + AUTOMATION_SUB_LANE_HEIGHT < 0 || laneTop > containerHeight) {
                    continue;
                }

                const lane = autoState?.lanes.find(
                    (l) => l.trackId === track.id && l.parameterId === paramId,
                );
                const paramLabel = PARAMETER_OPTIONS.find((p) => p.id === paramId)?.label ?? paramId;

                headers.push(
                    <div
                        key={`${track.id}-${paramId}-${si}`}
                        className="absolute left-0 flex items-center gap-1 px-1 z-20"
                        style={{
                            top: laneTop,
                            height: AUTOMATION_SUB_LANE_HEIGHT,
                            width: 120,
                        }}
                    >
                        {/* Parameter selector dropdown */}
                        <div className="relative group">
                            <button
                                type="button"
                                className={cn(
                                    'flex items-center gap-0.5 text-[9px] font-mono px-1.5 py-0.5 rounded',
                                    'bg-surface-raised/60 border border-border/30 hover:border-border/60',
                                    'text-muted-foreground hover:text-foreground transition-colors',
                                )}
                                aria-label={`Select parameter for automation lane ${si + 1}`}
                            >
                                <span className="truncate max-w-[60px]">{paramLabel}</span>
                                <ChevronDown className="size-2.5 shrink-0" />
                            </button>
                            {/* Dropdown menu - appears on hover */}
                            <div className="hidden group-hover:block absolute top-full left-0 mt-0.5 bg-surface-raised border border-border/40 rounded-md shadow-lg z-50 min-w-[100px] py-0.5">
                                {PARAMETER_OPTIONS.map((opt) => (
                                    <button
                                        key={opt.id}
                                        type="button"
                                        className={cn(
                                            'w-full text-left text-[9px] px-2 py-1 hover:bg-surface-overlay/50 transition-colors',
                                            opt.id === paramId ? 'text-foreground font-medium' : 'text-muted-foreground',
                                        )}
                                        onClick={() => {
                                            // Swap parameter for this sub-lane
                                            const newParams = [...paramIds];
                                            newParams[si] = opt.id;
                                            workspaceStore.set({
                                                ...ws,
                                                automationSubLanes: {
                                                    ...ws.automationSubLanes,
                                                    [track.id]: newParams,
                                                },
                                            });
                                            // Ensure lane exists
                                            if (!autoState?.lanes.find((l) => l.trackId === track.id && l.parameterId === opt.id)) {
                                                addAutomationLane(track.id, opt.id, opt.label);
                                            }
                                        }}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Remove sub-lane button */}
                        <button
                            type="button"
                            className="size-4 flex items-center justify-center text-muted-foreground/40 hover:text-foreground rounded hover:bg-surface-raised/80 transition-colors"
                            onClick={() => {
                                const newParams = paramIds.filter((_, idx) => idx !== si);
                                workspaceStore.set({
                                    ...ws,
                                    automationSubLanes: {
                                        ...ws.automationSubLanes,
                                        [track.id]: newParams,
                                    },
                                });
                            }}
                            aria-label={`Remove ${paramLabel} automation lane`}
                        >
                            <X className="size-2.5" />
                        </button>

                        {/* Mode badge */}
                        {lane && (
                            <span
                                className={cn(
                                    'text-[7px] font-mono px-1 py-0.5 rounded',
                                    lane.enabled === false
                                        ? 'text-muted-foreground/40 bg-muted/10'
                                        : 'text-primary/60 bg-primary/10',
                                )}
                            >
                                {lane.enabled === false ? 'OFF' : 'R'}
                            </span>
                        )}
                    </div>,
                );
            }
        }

        // "Add sub-lane" button at the bottom of each track's sub-lane area
        const addBtnTop = trackYOffset + totalHeight - scrollY + RULER_HEIGHT - 16;
        if (addBtnTop > 0 && addBtnTop < containerHeight) {
            headers.push(
                <button
                    key={`add-${track.id}`}
                    type="button"
                    className="absolute left-1 z-20 size-4 flex items-center justify-center text-muted-foreground/30 hover:text-foreground rounded-sm hover:bg-surface-raised/80 transition-colors"
                    style={{ top: addBtnTop }}
                    onClick={() => {
                        const existing = subLaneMap[track.id] ?? [];
                        // Find first unused parameter
                        const usedSet = new Set(existing);
                        const nextParam = PARAMETER_OPTIONS.find((p) => !usedSet.has(p.id));
                        if (nextParam) {
                            workspaceStore.set({
                                ...ws,
                                automationSubLanes: {
                                    ...ws.automationSubLanes,
                                    [track.id]: [...existing, nextParam.id],
                                },
                            });
                            // Ensure lane exists
                            if (!autoState?.lanes.find((l) => l.trackId === track.id && l.parameterId === nextParam.id)) {
                                addAutomationLane(track.id, nextParam.id, nextParam.label);
                            }
                        }
                    }}
                    aria-label="Add automation lane"
                >
                    <Plus className="size-3" />
                </button>,
            );
        }

        trackYOffset += totalHeight;
    }

    if (headers.length === 0) {
        return null;
    }

    return <>{headers}</>;
};
