import { type ReactElement, useState, useEffect } from 'react';
import { Play, Pause, Square, Circle, Repeat, Scissors, ListOrdered, Link as LinkIcon } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { cn } from '#/helpers/Styles/cn';
import {
    togglePlayback,
    stopPlayback,
    toggleLoop,
    toggleMetronome,
    setMetronomeVolume,
    toggleRecording,
    togglePunchEnabled,
    toggleCountIn,
    togglePreRoll,
} from '../../../useCases/workspaceViewActions';
import { enableLink, disableLink, getLinkStatus } from '#/modules/AudioEngine/useCases/linkBridge';

export type TransportControlsProps = {
    isPlaying: boolean;
    isRecording: boolean;
    isLooping: boolean;
    metronomeEnabled: boolean;
    metronomeVolume: number;
    punchInEnabled: boolean;
    countInEnabled: boolean;
    preRollEnabled: boolean;
    anyTrackArmed: boolean;
};

export const TransportControls = ({
    isPlaying,
    isRecording,
    isLooping,
    metronomeEnabled,
    metronomeVolume,
    punchInEnabled,
    countInEnabled,
    preRollEnabled,
    anyTrackArmed,
}: TransportControlsProps): ReactElement => {
    const [linkEnabled, setLinkEnabled] = useState(false);

    useEffect(() => {
        getLinkStatus()
            .then((status) => setLinkEnabled(status.enabled))
            .catch(() => {});
    }, []);

    const handleLinkToggle = async () => {
        try {
            if (linkEnabled) {
                await disableLink();
                setLinkEnabled(false);
            } else {
                await enableLink();
                setLinkEnabled(true);
            }
        } catch {
            // Ignore if tauri bridge fails
        }
    };

    return (
        <div className="flex items-center gap-0.5" role="group" aria-label="Playback controls">
            <span className="sr-only" aria-live="polite" role="status">
                {isRecording ? 'Recording' : isPlaying ? 'Playing' : 'Stopped'}
            </span>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={isPlaying ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label={isPlaying ? 'Pause' : 'Play'}
                        onClick={togglePlayback}
                    >
                        {isPlaying ? (
                            <Pause className="size-4" aria-hidden="true" />
                        ) : (
                            <Play className="size-4" aria-hidden="true" />
                        )}
                    </Button>
                </TooltipTrigger>
                <TooltipContent>{isPlaying ? 'Pause' : 'Play'} (Space)</TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Stop" onClick={stopPlayback}>
                        <Square className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Stop (Esc)</TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={isRecording ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label={isRecording ? 'Stop recording' : 'Record'}
                        aria-pressed={isRecording}
                        onClick={toggleRecording}
                        className={cn(!isRecording && anyTrackArmed && 'ring-2 ring-red-500/70')}
                    >
                        <Circle
                            className={cn('size-3.5 text-red-500', isRecording && 'fill-red-500 animate-pulse')}
                            aria-hidden="true"
                        />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    {isRecording ? 'Stop Recording' : anyTrackArmed ? 'Record (tracks armed)' : 'Record'} (R)
                </TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={isLooping ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label="Loop"
                        aria-pressed={isLooping}
                        onClick={toggleLoop}
                    >
                        <Repeat className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Loop (L)</TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={linkEnabled ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label="Ableton Link"
                        aria-pressed={linkEnabled}
                        onClick={handleLinkToggle}
                        className={cn(linkEnabled && 'text-yellow-400')}
                    >
                        <LinkIcon className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Ableton Link Sync</TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={metronomeEnabled ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label="Metronome"
                        aria-pressed={metronomeEnabled}
                        onClick={toggleMetronome}
                    >
                        <svg
                            className="size-3.5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <path d="M12 2L6 22h12L12 2z" />
                            <path d="M12 12l4-8" />
                        </svg>
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Metronome (M)</TooltipContent>
            </Tooltip>

            {metronomeEnabled && (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={metronomeVolume}
                            onChange={(e) => setMetronomeVolume(parseFloat(e.target.value))}
                            className="h-4 w-14 cursor-pointer accent-foreground opacity-70 hover:opacity-100 transition-opacity"
                            aria-label={`Metronome volume: ${Math.round(metronomeVolume * 100)}%`}
                        />
                    </TooltipTrigger>
                    <TooltipContent>Metronome volume: {Math.round(metronomeVolume * 100)}%</TooltipContent>
                </Tooltip>
            )}

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={punchInEnabled ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label="Punch in/out"
                        aria-pressed={punchInEnabled}
                        onClick={togglePunchEnabled}
                    >
                        <Scissors className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Punch In/Out (I)</TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={countInEnabled ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label="Count-in"
                        aria-pressed={countInEnabled}
                        onClick={toggleCountIn}
                    >
                        <ListOrdered className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Count-in</TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={preRollEnabled ? 'secondary' : 'ghost'}
                        size="xs"
                        aria-label="Pre-roll"
                        aria-pressed={preRollEnabled}
                        onClick={togglePreRoll}
                    >
                        <span className="text-[10px] font-semibold">PRE</span>
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Pre-roll (start playback N bars before cursor)</TooltipContent>
            </Tooltip>
        </div>
    );
};
