import { type ReactElement, type MouseEvent, useState, useRef, useEffect } from 'react';
import { Fader } from '#/components/daw/Fader';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { LatchButton } from '#/components/daw/LatchButton';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { Circle, Ear, ShieldCheck } from 'lucide-react';
import { cn } from '#/helpers/Styles/cn';
import {
    muteTrack,
    soloTrack,
    soloTrackExclusive,
    selectTrack,
    toggleInputMonitoring,
    toggleSoloSafe,
} from '#/modules/Arrangement/useCases/toggleTrackState';
import { setTrackGain, setTrackPan, setTrackColor } from '#/modules/Arrangement/useCases/setTrackGainPan';
import { armTrack } from '#/modules/Arrangement/useCases/recording';
import { removeTrack } from '#/modules/Arrangement/useCases/removeTrack';
import { renameTrack } from '#/modules/Arrangement/useCases/renameTrack';
import { TRACK_COLOR_PRESETS } from '#/helpers/UI/colorPresets';
import { menuBtnClass } from '#/helpers/UI/contextMenuStyles';

import { LevelMeter } from '../metering/LevelMeter';
import { VUMeterCanvas } from '../metering/VUMeterCanvas';
import { DeviceChainSection } from './DeviceChainSection';
import { SendsSection } from './SendsSection';
import { IOSection } from './IOSection';
import { type Track } from '#/modules/Arrangement/useCases/trackQueries';
import {
    getAllVCAGroups,
    assignTrackToVCA,
    removeTrackFromVCA,
    createVCAGroup,
} from '#/modules/Arrangement/useCases/vcaFader';
import { releaseTouchAutomation } from '#/modules/Automation/useCases/automationRecording';

type MixerMenu = { x: number; y: number } | null;



type ExpandedChannelStripProps = {
    track: Track;
    isSelected: boolean;
    widthClass: string;
};

export const ExpandedChannelStrip = ({ track, isSelected, widthClass }: ExpandedChannelStripProps): ReactElement => {
    const [ctxMenu, setCtxMenu] = useState<MixerMenu>(null);
    const [isRenaming, setIsRenaming] = useState(false);
    const ctxRef = useRef<HTMLDivElement>(null);
    const renameRef = useRef<HTMLInputElement>(null);

    const handleContextMenu = (e: MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setCtxMenu({ x: e.clientX, y: e.clientY });
    };

    useEffect(() => {
        if (!ctxMenu) {
            return;
        }
        const dismiss = (e: globalThis.MouseEvent) => {
            if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) {
                setCtxMenu(null);
            }
        };
        const esc = (e: globalThis.KeyboardEvent) => {
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
                'bg-surface-well border border-border-soft border-t-[var(--color-light-edge)] shadow-[0_1px_2px_rgba(0,0,0,0.4)]',
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
                    className="w-full rounded border border-border-soft bg-surface-inset shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)] px-1 text-center text-[9px] text-foreground font-mono outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
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

            <span className="text-[10px] text-muted-foreground capitalize">{track.kind}</span>
            {track.vcaGroupId ? <span className="text-[9px] text-[var(--color-accent-cyan)]/80 font-mono">VCA</span> : null}

            {/* Mute / Solo / Arm / Monitor */}
            <div className="flex flex-wrap justify-center gap-1">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <LatchButton
                            active={track.muted}
                            variant="amber"
                            size="icon-sm"
                            aria-label={track.muted ? 'Unmute' : 'Mute'}
                            className="font-bold text-[10px]"
                            onClick={(e) => {
                                e.stopPropagation();
                                muteTrack(track.id, !track.muted);
                            }}
                        >
                            M
                        </LatchButton>
                    </TooltipTrigger>
                    <TooltipContent>{track.muted ? 'Unmute' : 'Mute'}</TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <LatchButton
                            active={track.soloed}
                            variant="cyan"
                            size="icon-sm"
                            aria-label={track.soloed ? 'Unsolo' : 'Solo'}
                            className="font-bold text-[10px]"
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
                    <TooltipContent>{track.soloed ? 'Unsolo' : 'Solo (⌘ click for additive)'}</TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <LatchButton
                            active={track.armed}
                            variant="red"
                            size="icon-sm"
                            aria-label={track.armed ? 'Disarm' : 'Arm'}
                            className=""
                            onClick={(e) => {
                                e.stopPropagation();
                                armTrack(track.id, !track.armed);
                            }}
                        >
                            <Circle className={cn('size-3', track.armed && 'fill-state-record')} />
                        </LatchButton>
                    </TooltipTrigger>
                    <TooltipContent>{track.armed ? 'Disarm' : 'Arm for recording'}</TooltipContent>
                </Tooltip>
                {track.kind === 'audio' ? (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <LatchButton
                                active={track.inputMonitoring === 'on'}
                                variant="mint"
                                size="icon-sm"
                                aria-label={track.inputMonitoring === 'on' ? 'Disable monitoring' : 'Enable monitoring'}
                                className=""
                                onClick={(e) => {
                                    e.stopPropagation();
                                    toggleInputMonitoring(track.id);
                                }}
                            >
                                <Ear className={cn('size-3', track.inputMonitoring === 'on' && 'fill-state-play/30')} />
                            </LatchButton>
                        </TooltipTrigger>
                        <TooltipContent>Input monitoring</TooltipContent>
                    </Tooltip>
                ) : null}
                {track.soloSafe ? <ShieldCheck className="size-3 text-state-active" aria-label="Solo safe" /> : null}
            </div>

            {/* Fader + meter */}
            <div className="flex gap-2 h-40 shrink-0 mt-3 mb-1 items-end justify-center w-[85%]">
                <div
                    onPointerUp={() => {
                        if (track.automationMode === 'touch') {
                            releaseTouchAutomation(track.id, 'gain');
                        }
                    }}
                >
                    <Fader
                        value={track.gain}
                        onChange={(v) => {
                            setTrackGain(track.id, v);
                        }}
                        min={0}
                        max={1.5}
                        step={0.01}
                        fineStep={0.001}
                        defaultValue={0.8}
                        aria-label={`${track.name} gain`}
                    />
                </div>
                <LevelMeter trackId={track.id} width="w-2.5" />
                <VUMeterCanvas trackId={track.id} size={80} />
            </div>

            <span className="text-[10px] font-mono text-text-secondary mt-1">
                {track.gain === 0 ? '-∞' : `${((track.gain - 0.8) * 40).toFixed(1)}`} dB
            </span>

            {/* Pan */}
            <div className="w-full px-1 flex flex-col items-center mt-2 mb-2">
                <div
                    onPointerUp={() => {
                        if (track.automationMode === 'touch') {
                            releaseTouchAutomation(track.id, 'pan');
                        }
                    }}
                >
                    <RotaryKnob
                        value={track.pan}
                        onChange={(v) => {
                            setTrackPan(track.id, v);
                        }}
                        min={-50}
                        max={50}
                        size="sm"
                        aria-label={`${track.name} pan`}
                        bipolar
                    />
                </div>
                <span className="text-[9px] font-mono text-text-secondary mt-1">
                    {track.pan === 0
                        ? 'C'
                        : track.pan > 0
                          ? `R${Math.round(track.pan)}`
                          : `L${Math.abs(Math.round(track.pan))}`}
                </span>
            </div>

            {/* Devices — contained with scroll */}
            <DeviceChainSection track={track} />

            {/* Sends */}
            <SendsSection track={track} />

            {/* I/O */}
            <IOSection track={track} />

            {/* Context menu */}
            {ctxMenu ? (
                <div
                    ref={ctxRef}
                    className="fixed z-50 min-w-[160px] max-h-[70vh] overflow-y-auto rounded-md border border-border-soft border-t-[var(--color-light-edge)] bg-surface-overlay py-1 shadow-[0_4px_16px_rgba(0,0,0,0.5)]"
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
                        {TRACK_COLOR_PRESETS.map((c) => (
                            <button
                                type="button"
                                key={c}
                                className="size-3.5 rounded-full border border-border/50 hover:ring-1 hover:ring-foreground/30"
                                style={{ backgroundColor: c, outline: c === track.color ? '2px solid white' : 'none', outlineOffset: '1px' }}
                                onClick={act(() => setTrackColor(track.id, c))}
                                aria-label={`Set color`}
                            />
                        ))}
                    </div>
                    <div className="my-1 border-t border-border/50" />
                    <div className="px-3 py-1 text-[10px] text-muted-foreground">VCA Group</div>
                    {getAllVCAGroups().map((g) => (
                        <button
                            type="button"
                            key={g.id}
                            className={`${menuBtnClass} ${track.vcaGroupId === g.id ? 'text-[var(--color-accent-cyan)]' : ''}`}
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
            ) : null}
        </div>
    );
};
