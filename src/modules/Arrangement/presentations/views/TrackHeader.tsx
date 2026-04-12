import { type ReactElement } from 'react';
import { Button } from '#/components/ui/button';
import { DawHierarchyRow } from '#/components/daw/DawHierarchyRow';
import { LatchButton } from '#/components/daw/LatchButton';
import { Circle, ChevronRight, ChevronDown, Folder, Music, AudioLines, Radio, Monitor, Drum } from 'lucide-react';
import { cn } from '#/utils/Styles/cn';
import { type Track, type InputMonitoring } from '../../models/Track';
import { muteTrack } from '../../useCases/toggleTrackState/muteTrack';
import { soloTrack } from '../../useCases/toggleTrackState/soloTrack';
import { soloTrackExclusive } from '../../useCases/toggleTrackState/soloTrackExclusive';
import { selectTrack } from '../../useCases/toggleTrackState/selectTrack';
import { armTrack } from '../../useCases/recording/armTrack';
import { toggleFolderCollapse } from '../../useCases/folder/toggleFolderCollapse';
import { setInputMonitoring } from '../../useCases/setTrackGainPan/setInputMonitoring';

import { TrackContextMenu } from './TrackContextMenu';
import { Tooltip, TooltipTrigger, TooltipContent } from '#/components/ui/tooltip';
import { InlineTrackName } from './TrackHeader/InlineTrackName';
import { ResizeHandle } from './TrackHeader/ResizeHandle';
import { InputSelector } from './TrackHeader/InputSelector';
import { TrackLevelIndicator } from './TrackHeader/TrackLevelIndicator';
import { LevainLoadingSpinner } from './TrackHeader/LevainLoadingSpinner';

const TRACK_KIND_ICON: Record<string, typeof Music> = {
    audio: AudioLines,
    midi: Music,
    bus: Radio,
    master: Monitor,
};

const INPUT_MONITORING_CYCLE: Record<InputMonitoring, InputMonitoring> = {
    auto: 'on',
    on: 'off',
    off: 'auto',
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

    if (track.kind === 'folder') {
        const isDrumMachine = track.devices.some((d) => d.type === 'toaster');
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
                                onClick={(e) => {
                                    e.stopPropagation();
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

    return (
        <TrackContextMenu track={track}>
            <div
                className={cn(
                    'relative flex shrink-0 flex-col border-b border-border-soft cursor-pointer transition-colors duration-fast',
                    track.parentId ? 'border-l-2 border-l-white/5' : '',
                    isSelected ? 'bg-surface-base' : 'hover:bg-surface-panel'
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

                    {(() => {
                        const KindIcon = TRACK_KIND_ICON[track.kind];
                        return KindIcon ? (
                            <KindIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                        ) : null;
                    })()}

                    <LevainLoadingSpinner track={track} />

                    <InlineTrackName track={track} />

                    {track.frozen ? (
                        <span className="text-[10px] text-[var(--color-accent-cyan)] font-medium">FRZ</span>
                    ) : null}

                    {track.kind === 'audio' && isSelected ? (
                        <InputSelector trackId={track.id} inputId={track.inputId} />
                    ) : null}

                    <div className="flex items-center gap-1 ml-auto">
                        {track.kind === 'audio' || track.kind === 'midi' ? (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <LatchButton
                                        active={track.inputMonitoring === 'on'}
                                        variant="mint"
                                        size="icon-sm"
                                        aria-label={`Input monitoring: ${INPUT_MONITORING_LABEL[track.inputMonitoring]}`}
                                        className="font-bold text-[10px]"
                                        onClick={(e) => {
                                            e.stopPropagation();
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
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        armTrack(track.id, !track.armed);
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
                                    className="font-bold text-[9px]"
                                    onClick={(e) => {
                                        e.stopPropagation();
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
                                    className="font-bold text-[9px]"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (e.metaKey || e.ctrlKey) {
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
                    </div>
                </div>

                <ResizeHandle trackId={track.id} />
            </div>
        </TrackContextMenu>
    );
};
