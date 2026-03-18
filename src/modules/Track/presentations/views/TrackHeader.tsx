import { type ReactElement } from 'react';
import { Button } from '#/components/ui/button';
import {
    Volume2,
    VolumeX,
    Headphones,
    Circle,
    ChevronRight,
    ChevronDown,
    Folder,
    Music,
    AudioLines,
    Radio,
    Monitor,
} from 'lucide-react';
import { cn } from '#/helpers/Styles/cn';
import { type Track, type InputMonitoring } from '../../models/Track';
import { muteTrack, soloTrack, soloTrackExclusive, selectTrack } from '../../useCases/toggleTrackState';
import { armTrack } from '../../useCases/recordingUseCases';
import { toggleFolderCollapse } from '../../useCases/folderUseCases';
import { setInputMonitoring } from '../../useCases/setTrackGainPan';
import { engineSetTrackMute } from '../../useCases/trackViewActions';
import { TrackContextMenu } from './TrackContextMenu';
import { Tooltip, TooltipTrigger, TooltipContent } from '#/components/ui/tooltip';
import { InlineTrackName } from './trackHeader/InlineTrackName';
import { ResizeHandle } from './trackHeader/ResizeHandle';
import { InputSelector } from './trackHeader/InputSelector';

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
                        'relative flex shrink-0 items-center gap-1 border-b border-border/30 px-1 cursor-pointer',
                        isSelected ? 'bg-accent/30' : ''
                    )}
                    style={{ height: trackHeight }}
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
                        className="size-5"
                    >
                        {track.collapsed ? (
                            <ChevronRight className="size-3" aria-hidden="true" />
                        ) : (
                            <ChevronDown className="size-3" aria-hidden="true" />
                        )}
                    </Button>
                    <Folder className="size-3 text-muted-foreground" aria-hidden="true" />
                    <InlineTrackName track={track} />
                    <ResizeHandle trackId={track.id} />
                </div>
            </TrackContextMenu>
        );
    }

    return (
        <TrackContextMenu track={track}>
            <div
                className={cn(
                    'relative flex shrink-0 items-center gap-1 border-b border-border/30 px-2 cursor-pointer',
                    track.parentId ? 'pl-5' : '',
                    isSelected ? 'bg-accent/30' : ''
                )}
                style={{ height: trackHeight }}
                role="row"
                aria-selected={isSelected}
                onClick={() => selectTrack(track.id)}
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

                {track.frozen ? <span className="text-[8px] text-blue-400 font-medium">FRZ</span> : null}

                {track.kind === 'audio' && isSelected ? (
                    <InputSelector trackId={track.id} inputId={track.inputId} />
                ) : null}

                <div className="flex items-center gap-0.5">
                    {track.kind === 'audio' || track.kind === 'midi' ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={`Input monitoring: ${INPUT_MONITORING_LABEL[track.inputMonitoring]}`}
                                    className={cn(
                                        'size-5 text-[7px] font-bold',
                                        track.inputMonitoring === 'on' ? 'text-green-400' : ''
                                    )}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setInputMonitoring(track.id, INPUT_MONITORING_CYCLE[track.inputMonitoring]);
                                    }}
                                >
                                    {INPUT_MONITORING_LABEL[track.inputMonitoring][0]}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                                Input monitoring: {INPUT_MONITORING_LABEL[track.inputMonitoring]}
                            </TooltipContent>
                        </Tooltip>
                    ) : null}

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={track.armed ? `Disarm ${track.name}` : `Arm ${track.name}`}
                                aria-pressed={track.armed}
                                className={cn('size-5', track.armed ? 'text-red-500' : '')}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    armTrack(track.id, !track.armed);
                                }}
                            >
                                <Circle
                                    className={cn('size-2.5', track.armed ? 'fill-current' : '')}
                                    aria-hidden="true"
                                />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{track.armed ? 'Disarm' : 'Arm for recording'}</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
                                aria-pressed={track.muted}
                                className={cn('size-5', track.muted ? 'text-destructive-foreground' : '')}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    muteTrack(track.id, !track.muted);
                                    engineSetTrackMute(track.id, !track.muted, track.gain);
                                }}
                            >
                                {track.muted ? (
                                    <VolumeX className="size-3" aria-hidden="true" />
                                ) : (
                                    <Volume2 className="size-3" aria-hidden="true" />
                                )}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{track.muted ? 'Unmute' : 'Mute'}</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={track.soloed ? `Unsolo ${track.name}` : `Solo ${track.name}`}
                                aria-pressed={track.soloed}
                                className={cn('size-5', track.soloed ? 'text-yellow-400' : '')}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (e.metaKey || e.ctrlKey) {
                                        soloTrack(track.id, !track.soloed);
                                    } else {
                                        soloTrackExclusive(track.id);
                                    }
                                }}
                            >
                                <Headphones className="size-3" aria-hidden="true" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                            {track.soloed ? 'Unsolo' : 'Solo (⌘+click for additive)'}
                        </TooltipContent>
                    </Tooltip>
                </div>

                <ResizeHandle trackId={track.id} />
            </div>
        </TrackContextMenu>
    );
};
