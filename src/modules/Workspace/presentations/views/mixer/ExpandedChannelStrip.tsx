import { type ReactElement, type MouseEvent as ReactMouseEvent, useState, useRef, useEffect } from 'react';
import { Button } from '#/components/ui/button';
import { Slider } from '#/components/ui/slider';
import { Knob } from '#/components/ui/knob';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { Volume2, VolumeX, Headphones, Circle, Ear, ShieldCheck } from 'lucide-react';
import { cn } from '#/helpers/Styles/cn';
import {
    muteTrack,
    soloTrack,
    soloTrackExclusive,
    selectTrack,
    toggleInputMonitoring,
    toggleSoloSafe,
} from '../../../useCases/workspaceViewActions';
import { setTrackGain, setTrackPan, setTrackColor } from '../../../useCases/workspaceViewActions';
import { armTrack } from '../../../useCases/workspaceViewActions';
import { removeTrack } from '../../../useCases/workspaceViewActions';
import { renameTrack } from '../../../useCases/workspaceViewActions';
import {
    setTrackMute as engineSetTrackMute,
    setTrackGain as engineSetTrackGain,
    setTrackPan as engineSetTrackPan,
} from '../../../useCases/workspaceViewActions';
import { useMeterLevel } from '../../hooks/useMeterLevel';
import { LevelMeter } from '../../components/LevelMeter';
import { VUMeterCanvas } from '../../components/VUMeterCanvas';
import { DeviceChainSection } from './DeviceChainSection';
import { SendsSection } from './SendsSection';
import { IOSection } from './IOSection';
import { type Track } from '../../../useCases/workspaceViewActions';
import {
    getAllVCAGroups,
    assignTrackToVCA,
    removeTrackFromVCA,
    createVCAGroup,
} from '#/modules/Track/useCases/vcaFaderUseCases';

type MixerMenu = { x: number; y: number } | null;

const TRACK_COLORS = ['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

const menuBtnClass = 'flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent text-left';

export type ExpandedChannelStripProps = {
    track: Track;
    isSelected: boolean;
    widthClass: string;
};

export const ExpandedChannelStrip = ({ track, isSelected, widthClass }: ExpandedChannelStripProps): ReactElement => {
    const { peak, rms, peakHold } = useMeterLevel(track.id);
    const [ctxMenu, setCtxMenu] = useState<MixerMenu>(null);
    const [isRenaming, setIsRenaming] = useState(false);
    const ctxRef = useRef<HTMLDivElement>(null);
    const renameRef = useRef<HTMLInputElement>(null);

    const handleContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setCtxMenu({ x: e.clientX, y: e.clientY });
    };

    useEffect(() => {
        if (!ctxMenu) {
            return;
        }
        const dismiss = (e: MouseEvent) => {
            if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) {
                setCtxMenu(null);
            }
        };
        const esc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setCtxMenu(null);
            }
        };
        document.addEventListener('mousedown', dismiss);
        document.addEventListener('keydown', esc);
        return () => {
            document.removeEventListener('mousedown', dismiss);
            document.removeEventListener('keydown', esc);
        };
    }, [ctxMenu]);

    useEffect(() => {
        if (isRenaming) {
            renameRef.current?.focus();
            renameRef.current?.select();
        }
    }, [isRenaming]);

    const act = (fn: () => void) => () => {
        fn();
        setCtxMenu(null);
    };

    return (
        <div
            className={cn(
                'flex shrink-0 flex-col items-center gap-1.5 rounded-lg p-2',
                widthClass,
                'bg-surface-0 border border-border shadow-sm',
                isSelected && 'ring-1 ring-ring border-transparent'
            )}
            onClick={() => selectTrack(track.id)}
            onContextMenu={handleContextMenu}
            role="group"
            aria-label={`${track.name} channel`}
        >
            {/* Color bar */}
            <div className="h-1.5 w-full rounded-t-sm -mt-2 mb-1" style={{ backgroundColor: track.color }} />

            {/* Track name */}
            {isRenaming ? (
                <input
                    ref={renameRef}
                    defaultValue={track.name}
                    className="w-full rounded border border-border bg-surface-base px-1 text-center text-[9px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    onBlur={(e) => {
                        renameTrack(track.id, e.currentTarget.value);
                        setIsRenaming(false);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            renameTrack(track.id, e.currentTarget.value);
                            setIsRenaming(false);
                        }
                        if (e.key === 'Escape') {
                            setIsRenaming(false);
                        }
                    }}
                />
            ) : (
                <span
                    className="w-full truncate text-center text-[10px] font-medium text-foreground cursor-text"
                    onDoubleClick={() => setIsRenaming(true)}
                    title={track.name}
                >
                    {track.name}
                </span>
            )}

            <span className="text-[8px] text-muted-foreground capitalize">{track.kind}</span>
            {track.vcaGroupId && <span className="text-[7px] text-cyan-400/80 font-mono">VCA</span>}

            {/* Mute / Solo / Arm / Monitor */}
            <div className="flex flex-wrap justify-center gap-0.5">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-pressed={track.muted}
                            aria-label={track.muted ? 'Unmute' : 'Mute'}
                            className={cn('size-5', track.muted && 'text-amber-500 bg-amber-500/20')}
                            onClick={(e) => {
                                e.stopPropagation();
                                muteTrack(track.id, !track.muted);
                                engineSetTrackMute(track.id, !track.muted);
                            }}
                        >
                            {track.muted ? <VolumeX className="size-2.5" /> : <Volume2 className="size-2.5" />}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{track.muted ? 'Unmute' : 'Mute'}</TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-pressed={track.soloed}
                            aria-label={track.soloed ? 'Unsolo' : 'Solo'}
                            className={cn('size-5', track.soloed && 'text-blue-500 bg-blue-500/20')}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (e.metaKey || e.ctrlKey) {
                                    soloTrack(track.id, !track.soloed);
                                } else {
                                    soloTrackExclusive(track.id);
                                }
                            }}
                        >
                            <Headphones className="size-2.5" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{track.soloed ? 'Unsolo' : 'Solo (⌘ click for additive)'}</TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-pressed={track.armed}
                            aria-label={track.armed ? 'Disarm' : 'Arm'}
                            className={cn('size-5', track.armed && 'text-red-500 bg-red-500/20')}
                            onClick={(e) => {
                                e.stopPropagation();
                                armTrack(track.id, !track.armed);
                            }}
                        >
                            <Circle className={cn('size-2.5', track.armed && 'fill-red-500')} />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{track.armed ? 'Disarm' : 'Arm for recording'}</TooltipContent>
                </Tooltip>
                {track.kind === 'audio' && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-pressed={track.inputMonitoring === 'on'}
                                aria-label={track.inputMonitoring === 'on' ? 'Disable monitoring' : 'Enable monitoring'}
                                className={cn('size-5', track.inputMonitoring === 'on' && 'text-green-400')}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    toggleInputMonitoring(track.id);
                                }}
                            >
                                <Ear
                                    className={cn('size-2.5', track.inputMonitoring === 'on' && 'fill-green-400/30')}
                                />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Input monitoring</TooltipContent>
                    </Tooltip>
                )}
                {track.soloSafe && <ShieldCheck className="size-2.5 text-cyan-400" aria-label="Solo safe" />}
            </div>

            {/* Fader + meter */}
            <div className="flex gap-2 h-[160px] shrink-0 mt-2 mb-1 items-end justify-center w-[85%]">
                <Slider
                    orientation="vertical"
                    value={[track.gain * 100]}
                    onValueChange={([v]) => {
                        if (v !== undefined) {
                            setTrackGain(track.id, v / 100);
                            engineSetTrackGain(track.id, v / 100);
                        }
                    }}
                    max={100}
                    step={1}
                    className="h-full w-full"
                    aria-label={`${track.name} gain`}
                    title="Gain"
                />
                <LevelMeter peak={peak} rms={rms} peakHold={peakHold} width="w-2" />
                <VUMeterCanvas trackId={track.id} size={80} />
            </div>

            <span className="text-[8px] font-mono text-muted-foreground">
                {track.gain === 0 ? '-∞' : `${((track.gain - 0.8) * 40).toFixed(1)}`} dB
            </span>

            {/* Pan */}
            <div className="w-full px-1 flex flex-col items-center">
                <Knob
                    value={track.pan + 50}
                    onValueChange={(v) => {
                        if (v !== undefined) {
                            setTrackPan(track.id, v - 50);
                            engineSetTrackPan(track.id, v - 50);
                        }
                    }}
                    min={0}
                    max={100}
                    step={1}
                    size={28}
                    defaultValue={50}
                    aria-label={`${track.name} pan`}
                    label="Pan"
                    formatValue={(v) => {
                        const p = v - 50;
                        return p === 0 ? 'C' : p > 0 ? `R${p}` : `L${Math.abs(p)}`;
                    }}
                />
            </div>

            {/* Devices — contained with scroll */}
            <DeviceChainSection track={track} />

            {/* Sends */}
            <SendsSection track={track} />

            {/* I/O */}
            <IOSection track={track} />

            {/* Context menu */}
            {ctxMenu && (
                <div
                    ref={ctxRef}
                    className="fixed z-50 min-w-[160px] max-h-[70vh] overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg"
                    style={{ left: ctxMenu.x, top: ctxMenu.y }}
                    role="menu"
                >
                    <button
                        type="button"
                        className={menuBtnClass}
                        role="menuitem"
                        onClick={act(() => muteTrack(track.id, !track.muted))}
                    >
                        {track.muted ? 'Unmute' : 'Mute'}
                    </button>
                    <button
                        type="button"
                        className={menuBtnClass}
                        role="menuitem"
                        onClick={act(() => soloTrack(track.id, !track.soloed))}
                    >
                        {track.soloed ? 'Unsolo' : 'Solo'}
                    </button>
                    <button
                        type="button"
                        className={menuBtnClass}
                        role="menuitem"
                        onClick={act(() => toggleSoloSafe(track.id))}
                    >
                        {track.soloSafe ? 'Disable Solo Safe' : 'Solo Safe'}
                    </button>
                    <button
                        type="button"
                        className={menuBtnClass}
                        role="menuitem"
                        onClick={act(() => armTrack(track.id, !track.armed))}
                    >
                        {track.armed ? 'Disarm' : 'Arm for Recording'}
                    </button>
                    <div className="my-1 border-t border-border/50" />
                    <button
                        type="button"
                        className={menuBtnClass}
                        role="menuitem"
                        onClick={act(() => setIsRenaming(true))}
                    >
                        Rename…
                    </button>
                    <div className="my-1 border-t border-border/50" />
                    <div className="px-3 py-1 text-[10px] text-muted-foreground">Color</div>
                    <div className="flex gap-1 px-3 py-1">
                        {TRACK_COLORS.map((c) => (
                            <button
                                type="button"
                                key={c || 'default'}
                                className="size-3.5 rounded-full border border-border/50 hover:ring-1 hover:ring-foreground/30"
                                style={{ backgroundColor: c || 'var(--color-muted)' }}
                                onClick={act(() => setTrackColor(track.id, c))}
                                aria-label={c || 'Default color'}
                            />
                        ))}
                    </div>
                    <div className="my-1 border-t border-border/50" />
                    <div className="px-3 py-1 text-[10px] text-muted-foreground">VCA Group</div>
                    {getAllVCAGroups().map((g) => (
                        <button
                            type="button"
                            key={g.id}
                            className={`${menuBtnClass} ${track.vcaGroupId === g.id ? 'text-cyan-400' : ''}`}
                            role="menuitem"
                            onClick={act(() => {
                                if (track.vcaGroupId === g.id) {
                                    removeTrackFromVCA(track.id);
                                } else {
                                    assignTrackToVCA(track.id, g.id);
                                }
                            })}
                        >
                            {track.vcaGroupId === g.id ? `✓ ${g.name}` : g.name}
                        </button>
                    ))}
                    <button
                        type="button"
                        className={menuBtnClass}
                        role="menuitem"
                        onClick={act(() => {
                            const group = createVCAGroup(`VCA ${getAllVCAGroups().length + 1}`);
                            assignTrackToVCA(track.id, group.id);
                        })}
                    >
                        + New VCA Group
                    </button>
                    {track.vcaGroupId && (
                        <button
                            type="button"
                            className={`${menuBtnClass} text-muted-foreground`}
                            role="menuitem"
                            onClick={act(() => removeTrackFromVCA(track.id))}
                        >
                            Remove from VCA
                        </button>
                    )}
                    <div className="my-1 border-t border-border/50" />
                    <button
                        type="button"
                        className={`${menuBtnClass} text-destructive hover:bg-destructive/10`}
                        role="menuitem"
                        onClick={act(() => removeTrack(track.id))}
                    >
                        Remove Channel
                    </button>
                </div>
            )}
        </div>
    );
};
