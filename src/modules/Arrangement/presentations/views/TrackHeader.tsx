import { type ReactElement } from 'react';

import {
    Circle,
    ChevronRight,
    ChevronDown,
    Folder,
    Music,
    AudioLines,
    Radio,
    Monitor,
    Drum,
    Layers,
    Snowflake,
    AlertCircle,
} from 'lucide-react';

import { DawHierarchyRow } from '#/components/daw/DawHierarchyRow';
import { DawMeterBar } from '#/components/daw/DawMeterBar';
import { LatchButton } from '#/components/daw/LatchButton';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '#/components/ui/tooltip';
import { executeAppAction } from '#/modules/Command/useCases';
import { cn } from '#/utils/Styles/cn';

import { type Track, type InputMonitoring } from '../../models/Track';
import { toggleFolderCollapse } from '../../useCases/folder/toggleFolderCollapse';
import { setInputMonitoring } from '../../useCases/setTrackGainPan/setInputMonitoring';
import { muteTrack } from '../../useCases/toggleTrackState/muteTrack';
import { selectTrack } from '../../useCases/toggleTrackState/selectTrack';
import { soloTrack } from '../../useCases/toggleTrackState/soloTrack';
import { soloTrackExclusive } from '../../useCases/toggleTrackState/soloTrackExclusive';
import { INPUT_MONITORING_CYCLE } from '../../useCases/toggleTrackState/toggleInputMonitoring';
import { toggleVariationLanes } from '../../useCases/toggleTrackState/toggleVariationLanes';

import { TrackContextMenu } from './TrackContextMenu';
import { InlineTrackName } from './TrackHeader/InlineTrackName';
import { InputSelector } from './TrackHeader/InputSelector';
import { LevainLoadingSpinner } from './TrackHeader/LevainLoadingSpinner';
import { ResizeHandle } from './TrackHeader/ResizeHandle';
import { TrackLevelIndicator } from './TrackHeader/TrackLevelIndicator';

const TRACK_KIND_ICON: Record<string, typeof Music> = {
    audio: AudioLines,
    midi: Music,
    bus: Radio,
    master: Monitor,
};

const INPUT_MONITORING_LABEL: Record<InputMonitoring, string> = {
    auto: 'Auto',
    on: 'On',
    off: 'Off',
};

type TrackHeaderProps = {
    track: Track;
    isSelected: boolean;
};

export const TrackHeader = ({ track, isSelected }: TrackHeaderProps): ReactElement => {
    const trackHeight = track.height;
    const isFreezing = track.freezeState.status === 'freezing';
    const isStale = track.freezeState.status === 'stale';

    if (track.kind === 'folder') {
        const isDrumMachine = track.devices.some((data) => data.type === 'toaster');
        const FolderIcon = isDrumMachine ? Drum : Folder;

        return (
            <TrackContextMenu track={track}>
                <DawHierarchyRow
                    as="div"
                    active={isSelected}
                    className={cn(
                        'relative shrink-0 border-b border-border-soft px-1 py-0',
                        isSelected ? 'bg-surface-overlay' : '',
                        isDrumMachine
                            ? 'bg-surface-panel hover:bg-surface-base'
                            : 'bg-surface-tray hover:bg-surface-base'
                    )}
                    title={track.name}
                    titleClassName="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground select-none"
                    startSlot={
                        <>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={track.collapsed ? 'Expand folder' : 'Collapse folder'}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    toggleFolderCollapse(track.id);
                                }}
                                className="size-5 shrink-0"
                            >
                                {track.collapsed ? (
                                    <ChevronRight className="size-3" aria-hidden="true" />
                                ) : (
                                    <ChevronDown className="size-3" aria-hidden="true" />
                                )}
                            </Button>
                            <FolderIcon
                                className={cn(
                                    'size-3 shrink-0',
                                    isDrumMachine
                                        ? 'text-[var(--color-accent-blue)]/80'
                                        : 'text-[var(--color-accent-peach)]/70'
                                )}
                                aria-hidden="true"
                            />
                        </>
                    }
                    endSlot={<ResizeHandle trackId={track.id} />}
                    style={{
                        height: 26,
                        boxShadow: isSelected
                            ? 'inset 0 1px 3px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.03)'
                            : 'inset 0 1px 0 rgba(255,255,255,0.03)',
                        borderTop: '1px solid rgba(255,255,255,0.04)',
                    }}
                    role="row"
                    aria-selected={isSelected}
                    onClick={() => selectTrack(track.id)}
                />
            </TrackContextMenu>
        );
    }

    const KindIcon = TRACK_KIND_ICON[track.kind];
    const kindIconContent = KindIcon ? (
        <KindIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
    ) : null;

    let freezeStateContent = null;
    if (isFreezing) {
        freezeStateContent = (
            <Stack gap={1} className="w-16 ml-2" data-testid="track-freezing-badge">
                <span className="text-[8px] font-bold text-primary animate-pulse">FREEZING</span>
                <DawMeterBar
                    value={(track.freezeState.renderProgress ?? 0) * 100}
                    size="sm"
                    fillClassName="bg-primary"
                />
            </Stack>
        );
    } else if (track.frozen) {
        freezeStateContent = (
            <Row gap={1} className="ml-2" data-testid="track-frozen-badge">
                <Snowflake className="size-2.5 text-[var(--color-accent-cyan)]" />
                <span className="text-[9px] text-[var(--color-accent-cyan)] font-bold tracking-tight">FROZEN</span>
                {isStale ? (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Row
                                gap={0.5}
                                className="ml-1 px-1 rounded bg-state-warning/30 border border-state-warning/40"
                            >
                                <AlertCircle className="size-2.5 text-state-warning" />
                                <span className="text-[8px] text-state-warning font-bold">STALE</span>
                            </Row>
                        </TooltipTrigger>
                        <TooltipContent>Track content has changed since freezing. Update required.</TooltipContent>
                    </Tooltip>
                ) : null}
            </Row>
        );
    }

    return (
        <TrackContextMenu track={track}>
            <div
                className={cn(
                    'relative flex shrink-0 flex-col border-b border-border-soft cursor-pointer transition-colors duration-fast',
                    track.parentId ? 'border-l-2 border-l-white/5' : '',
                    isSelected ? 'bg-surface-base' : 'hover:bg-surface-panel',
                    isStale ? 'bg-state-warning/10 border-state-warning/20' : ''
                )}
                style={{
                    height: trackHeight,
                    boxShadow: isSelected
                        ? 'inset 0 1px 3px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03)'
                        : 'inset 0 1px 0 rgba(255,255,255,0.03)',
                    borderTop: '1px solid rgba(255,255,255,0.04)',
                }}
                role="row"
                aria-selected={isSelected}
                onClick={() => selectTrack(track.id)}
            >
                <div
                    className={cn('flex items-center gap-1 px-2', track.parentId ? 'pl-7' : '')}
                    style={{ height: trackHeight }}
                >
                    <div
                        className="h-6 w-1 shrink-0 rounded-full"
                        style={{ backgroundColor: track.color }}
                        aria-hidden="true"
                    />

                    <TrackLevelIndicator trackId={track.id} height={Math.min(trackHeight - 8, 24)} />

                    {kindIconContent}

                    <LevainLoadingSpinner track={track} />

                    <InlineTrackName track={track} />

                    {freezeStateContent}

                    {track.kind === 'audio' && isSelected ? (
                        <InputSelector trackId={track.id} inputId={track.inputId} />
                    ) : null}

                    <Row gap={1} className="ml-auto">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    aria-label="Toggle variation lanes"
                                    aria-pressed={track.showVariationLanes}
                                    className={cn(
                                        'size-5 rounded flex items-center justify-center transition-colors',
                                        track.showVariationLanes
                                            ? 'bg-accent-gold/20 text-accent-gold'
                                            : 'text-muted-foreground hover:text-foreground'
                                    )}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        toggleVariationLanes(track.id);
                                    }}
                                >
                                    <Layers className="size-3" />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">Variation Lanes (Track Alternatives)</TooltipContent>
                        </Tooltip>

                        {track.kind === 'audio' || track.kind === 'midi' ? (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <LatchButton
                                        active={track.inputMonitoring === 'on'}
                                        variant="mint"
                                        size="icon-sm"
                                        aria-label={`Input monitoring: ${INPUT_MONITORING_LABEL[track.inputMonitoring]}`}
                                        className="font-bold text-[10px]"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setInputMonitoring(track.id, INPUT_MONITORING_CYCLE[track.inputMonitoring]);
                                        }}
                                    >
                                        {INPUT_MONITORING_LABEL[track.inputMonitoring][0]}
                                    </LatchButton>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">
                                    Input monitoring: {INPUT_MONITORING_LABEL[track.inputMonitoring]}
                                </TooltipContent>
                            </Tooltip>
                        ) : null}

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <LatchButton
                                    active={track.armed}
                                    variant="red"
                                    size="icon-sm"
                                    aria-label={track.armed ? `Disarm ${track.name}` : `Arm ${track.name}`}
                                    data-testid={`track-arm-${track.id}`}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        void executeAppAction({
                                            type: 'armTrack',
                                            payload: { trackId: track.id, armed: !track.armed },
                                        });
                                    }}
                                >
                                    <Circle
                                        className={cn('size-2.5', track.armed ? 'fill-state-record' : '')}
                                        aria-hidden="true"
                                    />
                                </LatchButton>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                                {track.armed ? 'Disarm' : 'Arm for recording'}
                            </TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <LatchButton
                                    active={track.muted}
                                    variant="amber"
                                    size="icon-sm"
                                    aria-label={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
                                    data-testid={`track-mute-${track.id}`}
                                    className="font-bold text-[9px]"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        muteTrack(track.id, !track.muted);
                                    }}
                                >
                                    M
                                </LatchButton>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">{track.muted ? 'Unmute' : 'Mute'}</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <LatchButton
                                    active={track.soloed}
                                    variant="cyan"
                                    size="icon-sm"
                                    aria-label={track.soloed ? `Unsolo ${track.name}` : `Solo ${track.name}`}
                                    data-testid={`track-solo-${track.id}`}
                                    className="font-bold text-[9px]"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        if (event.metaKey || event.ctrlKey) {
                                            soloTrack(track.id, !track.soloed);
                                        } else {
                                            soloTrackExclusive(track.id);
                                        }
                                    }}
                                >
                                    S
                                </LatchButton>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                                {track.soloed ? 'Unsolo' : 'Solo (⌘+click for additive)'}
                            </TooltipContent>
                        </Tooltip>
                    </Row>
                </div>

                <ResizeHandle trackId={track.id} />
            </div>
        </TrackContextMenu>
    );
};
