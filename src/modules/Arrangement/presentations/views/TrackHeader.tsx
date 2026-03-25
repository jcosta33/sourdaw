import { type ReactElement } from 'react';
import { Button } from '#/components/ui/button';
import { LatchButton } from '#/components/daw/LatchButton';
import { Circle, ChevronRight, ChevronDown, Folder, Music, AudioLines, Radio, Monitor } from 'lucide-react';
import { cn } from '#/helpers/Styles/cn';
import { type Track, type InputMonitoring } from '../../models/Track';
import { muteTrack, soloTrack, soloTrackExclusive, selectTrack } from '../../useCases/toggleTrackState';
import { armTrack } from '../../useCases/recording';
import { toggleFolderCollapse } from '../../useCases/folder';
import { setInputMonitoring } from '../../useCases/setTrackGainPan';


import { TrackContextMenu } from './TrackContextMenu';
import { Tooltip, TooltipTrigger, TooltipContent } from '#/components/ui/tooltip';
import { InlineTrackName } from './TrackHeader/InlineTrackName';
import { ResizeHandle } from './TrackHeader/ResizeHandle';
import { InputSelector } from './TrackHeader/InputSelector';

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
        return (
            <TrackContextMenu track={track}>
                <div
                    className={cn(
                        'relative flex shrink-0 items-center gap-1 border-b border-border-soft px-1 cursor-pointer transition-colors',
                        isSelected
                            ? 'bg-surface-overlay shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]'
                            : 'bg-surface-tray hover:bg-surface-base'
                    )}
                    style={{ height: 26 }}
                    role="row"
                    aria-selected={isSelected}
                    onClick={() => selectTrack(track.id)}
                >
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
                    <Folder className="size-3 shrink-0 text-[var(--color-accent-peach)]/70" aria-hidden="true" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate flex-1 min-w-0 select-none">
                        {track.name}
                    </span>
                    <ResizeHandle trackId={track.id} />
                </div>
            </TrackContextMenu>
        );
    }

    return (
        <TrackContextMenu track={track}>
            <div
                className={cn(
                    'relative flex shrink-0 flex-col border-b border-border-soft cursor-pointer transition-colors duration-fast',
                    track.parentId ? 'border-l-2 border-l-white/5' : '',
                    isSelected ? 'bg-surface-base shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)]' : 'hover:bg-surface-panel'
                )}
                style={{ height: trackHeight }}
                role="row"
                aria-selected={isSelected}
                onClick={() => selectTrack(track.id)}
            >
                <div
                    className={cn(
                        'flex items-center gap-1 px-2',
                        track.parentId ? 'pl-7' : ''
                    )}
                    style={{ height: trackHeight }}
                >
                    <div
                        className="h-6 w-1 shrink-0 rounded-full"
                        style={{ backgroundColor: track.color }}
                        aria-hidden="true"
                    />

                    {(() => {
                        const KindIcon = TRACK_KIND_ICON[track.kind];
                        return KindIcon ? (
                            <KindIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                        ) : null;
                    })()}

                    <InlineTrackName track={track} />

                    {track.frozen ? <span className="text-[10px] text-[var(--color-accent-cyan)] font-medium">FRZ</span> : null}

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
                            <TooltipContent side="bottom">{track.armed ? 'Disarm' : 'Arm for recording'}</TooltipContent>
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
