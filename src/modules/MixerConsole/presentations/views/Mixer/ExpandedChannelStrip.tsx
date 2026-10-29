import { type ReactElement, type MouseEvent, type KeyboardEvent, useState, useRef, useEffect } from 'react';

import { Circle, Ear, ShieldCheck } from 'lucide-react';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawContextMenuSurface } from '#/components/daw/DawContextMenuSurface';
import { DawMenuButton } from '#/components/daw/DawMenuParts';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { DawSwatchButton } from '#/components/daw/DawSwatchButton';
import { Fader } from '#/components/daw/Fader';
import { LatchButton } from '#/components/daw/LatchButton';
import { MixerStripValue } from '#/components/daw/MixerStripValue';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Row, Stack } from '#/components/layout';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { trackStore } from '#/modules/Arrangement/stores';
import { getVcaGroups } from '#/modules/Arrangement/useCases';
import { captureProjectTransitionAuthority } from '#/modules/Project/useCases';
import { FADER_MAX_GAIN, formatGainDb, TRACK_FADER_LAW } from '#/utils/audioLevelLaw';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { promptUser } from '#/utils/Notification/promptUser';
import { cn } from '#/utils/Styles/cn';
import { TRACK_COLOR_PRESETS } from '#/utils/UI/colorPresets';
import { useContextMenuDismiss } from '#/utils/UI/useContextMenuDismiss';

import { type Track } from '../../../models/TrackViewTypes';
import { useChannelStripActions } from '../../hooks/useChannelStripActions';

import { DeviceChainSection } from './DeviceChainSection';
import { IOSection } from './IOSection';
import { MidiFxSection } from './MidiFxSection';
import { MixerLevelReadout } from './MixerLevelReadout';
import { MixerPopupLabel, MixerPopupMenu, MixerPopupOption, MixerPopupSeparator } from './MixerPopupMenu';
import { parseMasterGainEntry } from './parseMasterGainEntry';
import { SendsSection } from './SendsSection';

type MixerMenu = { x: number; y: number } | null;
type GainMenu = { x: number; y: number; keyboardOpen: boolean } | null;
type PanMenu = { x: number; y: number; keyboardOpen: boolean } | null;

type ExpandedChannelStripProps = {
    track: Track;
    isSelected: boolean;
    widthClass: string;
};

export const ExpandedChannelStrip = ({ track, isSelected, widthClass }: ExpandedChannelStripProps): ReactElement => {
    const actions = useChannelStripActions(track);
    const [ctxMenu, setCtxMenu] = useState<MixerMenu>(null);
    const [gainMenu, setGainMenu] = useState<GainMenu>(null);
    const [panMenu, setPanMenu] = useState<PanMenu>(null);
    const [isRenaming, setIsRenaming] = useState(false);
    const ctxRef = useRef<HTMLDivElement>(null);
    const renameRef = useRef<HTMLInputElement>(null);
    const gainControlRef = useRef<HTMLDivElement>(null);
    const gainMenuRef = useRef<HTMLDivElement>(null);
    const panControlRef = useRef<HTMLDivElement>(null);
    const panMenuRef = useRef<HTMLDivElement>(null);
    const gainIntent = useRef(0);
    const panIntent = useRef(0);
    const mounted = useRef(false);
    const focusFrame = useRef<number | null>(null);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            gainIntent.current += 1;
            panIntent.current += 1;
            if (focusFrame.current !== null) {
                window.cancelAnimationFrame(focusFrame.current);
            }
        };
    }, []);

    const slider = (): HTMLElement | null =>
        gainControlRef.current?.querySelector<HTMLElement>('[role="slider"]') ?? null;
    const panKnob = (): HTMLElement | null =>
        panControlRef.current?.querySelector<HTMLElement>('[role="slider"]') ?? null;
    const closeGainMenu = (): void => setGainMenu(null);
    const closePanMenu = (): void => setPanMenu(null);
    useContextMenuDismiss(gainMenuRef, closeGainMenu);
    useContextMenuDismiss(panMenuRef, closePanMenu);

    useEffect(() => {
        if (gainMenu?.keyboardOpen) {
            gainMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
        }
    }, [gainMenu]);

    useEffect(() => {
        if (panMenu?.keyboardOpen) {
            panMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
        }
    }, [panMenu]);

    const openGainMenu = (x: number, y: number, keyboardOpen: boolean): void => {
        gainIntent.current += 1;
        setCtxMenu(null);
        setPanMenu(null);
        slider()?.focus();
        setGainMenu({ x, y, keyboardOpen });
    };

    const gainContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
        event.preventDefault();
        event.stopPropagation();
        openGainMenu(event.clientX, event.clientY, false);
    };

    const gainMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (
            !gainControlRef.current?.contains(event.target as Node) ||
            (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey))
        ) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const bounds = slider()?.getBoundingClientRect();
        openGainMenu(bounds?.left ?? 0, bounds?.bottom ?? 0, true);
    };

    const openPanMenu = (x: number, y: number, keyboardOpen: boolean): void => {
        panIntent.current += 1;
        setCtxMenu(null);
        setGainMenu(null);
        panKnob()?.focus();
        setPanMenu({ x, y, keyboardOpen });
    };

    const panContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
        event.preventDefault();
        event.stopPropagation();
        openPanMenu(event.clientX, event.clientY, false);
    };

    const panMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (
            !panControlRef.current?.contains(event.target as Node) ||
            (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey))
        ) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const bounds = panKnob()?.getBoundingClientRect();
        openPanMenu(bounds?.left ?? 0, bounds?.bottom ?? 0, true);
    };

    const restoreGainFocus = (receipt: NonNullable<ReturnType<typeof captureGainIntent>>): void => {
        if (focusFrame.current !== null) {
            window.cancelAnimationFrame(focusFrame.current);
        }
        focusFrame.current = window.requestAnimationFrame(() => {
            focusFrame.current = null;
            if (receipt.ownsFocus() && document.activeElement === document.body) {
                slider()?.focus();
            }
        });
    };

    const captureGainIntent = () => {
        const authority = captureProjectTransitionAuthority();
        const target = trackStore.value?.tracks.find((candidate) => candidate.id === track.id);
        const intent = ++gainIntent.current;
        closeGainMenu();
        if (!target) {
            return null;
        }
        const expectedGain = target.gain;
        let focusOwner = target;
        return {
            trackId: target.id,
            expectedGain,
            intent,
            shouldExecute: () =>
                mounted.current &&
                gainIntent.current === intent &&
                authority.isCurrent() &&
                trackStore.value?.tracks.find((candidate) => candidate.id === target.id) === target &&
                target.gain === expectedGain,
            ownsFocus: () =>
                mounted.current &&
                gainIntent.current === intent &&
                authority.isCurrent() &&
                trackStore.value?.tracks.find((candidate) => candidate.id === target.id) === focusOwner,
            onCommitted: () => {
                // The owning gain write replaces its track object. Keep only that committed successor.
                focusOwner = trackStore.value?.tracks.find((candidate) => candidate.id === target.id) ?? focusOwner;
            },
        };
    };

    const commitMenuGain = (receipt: NonNullable<ReturnType<typeof captureGainIntent>>, gain: number): void => {
        if (receipt.shouldExecute() && gain !== receipt.expectedGain) {
            actions.setGainFromMenu({ ...receipt, gain });
        }
        restoreGainFocus(receipt);
    };

    const restorePanFocus = (receipt: NonNullable<ReturnType<typeof capturePanIntent>>): void => {
        if (focusFrame.current !== null) {
            window.cancelAnimationFrame(focusFrame.current);
        }
        focusFrame.current = window.requestAnimationFrame(() => {
            focusFrame.current = null;
            if (receipt.ownsFocus() && document.activeElement === document.body) {
                panKnob()?.focus();
            }
        });
    };

    const capturePanIntent = () => {
        const authority = captureProjectTransitionAuthority();
        const target = trackStore.value?.tracks.find((candidate) => candidate.id === track.id);
        const intent = ++panIntent.current;
        closePanMenu();
        if (!target) {
            return null;
        }
        const expectedPan = target.pan;
        let focusOwner = target;
        return {
            trackId: target.id,
            expectedPan,
            shouldExecute: () =>
                mounted.current &&
                panIntent.current === intent &&
                authority.isCurrent() &&
                trackStore.value?.tracks.find((candidate) => candidate.id === target.id) === target &&
                target.pan === expectedPan,
            ownsFocus: () =>
                mounted.current &&
                panIntent.current === intent &&
                authority.isCurrent() &&
                trackStore.value?.tracks.find((candidate) => candidate.id === target.id) === focusOwner,
            onCommitted: () => {
                // The owning pan write replaces its track object. Keep only that committed successor.
                focusOwner = trackStore.value?.tracks.find((candidate) => candidate.id === target.id) ?? focusOwner;
            },
        };
    };

    const commitMenuPan = (receipt: NonNullable<ReturnType<typeof capturePanIntent>>, pan: number): void => {
        if (receipt.shouldExecute() && pan !== receipt.expectedPan) {
            actions.setPanFromMenu({ ...receipt, pan });
        }
        restorePanFocus(receipt);
    };

    const resetPan = (): void => {
        const receipt = capturePanIntent();
        if (receipt) {
            commitMenuPan(receipt, 0);
        }
    };

    const parsePanEntry = (input: string): number | null => {
        const value = input.trim();
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
            return null;
        }
        const pan = Number(value);
        return Number.isFinite(pan) && pan >= -50 && pan <= 50 ? pan : null;
    };

    const enterPan = async (): Promise<void> => {
        const receipt = capturePanIntent();
        if (!receipt) {
            return;
        }
        const initialValue = String(receipt.expectedPan);
        const input = await promptUser({
            title: 'Enter Track Pan',
            message: 'Enter track pan from -50 (hard left) to 50 (hard right), with 0 at center.',
            initialValue,
            confirmLabel: 'Set Pan',
        });
        if (!receipt.shouldExecute()) {
            return;
        }
        restorePanFocus(receipt);
        if (input === null || input === initialValue) {
            return;
        }
        const pan = parsePanEntry(input);
        if (pan === null) {
            notifyUser('Enter a finite track pan value from -50 to 50.', 'error');
            return;
        }
        commitMenuPan(receipt, pan);
    };

    const copyPan = async (): Promise<void> => {
        const receipt = capturePanIntent();
        if (!receipt) {
            return;
        }
        try {
            if (!navigator.clipboard?.writeText) {
                throw new Error('Clipboard unavailable');
            }
            await navigator.clipboard.writeText(`pan:${String(receipt.expectedPan)}`);
            if (receipt.shouldExecute()) {
                restorePanFocus(receipt);
            }
        } catch {
            if (receipt.shouldExecute()) {
                notifyUser('Could not copy track pan to the clipboard.', 'error');
                restorePanFocus(receipt);
            }
        }
    };

    const pastePan = async (): Promise<void> => {
        const receipt = capturePanIntent();
        if (!receipt) {
            return;
        }
        let text: string;
        try {
            if (!navigator.clipboard?.readText) {
                throw new Error('Clipboard unavailable');
            }
            text = await navigator.clipboard.readText();
        } catch {
            if (receipt.shouldExecute()) {
                notifyUser('Could not read track pan from the clipboard.', 'error');
                restorePanFocus(receipt);
            }
            return;
        }
        if (!receipt.shouldExecute()) {
            return;
        }
        const encoded = text.startsWith('pan:') ? text.slice(4) : '';
        const pan = Number(encoded);
        if (!encoded || String(pan) !== encoded || !Number.isFinite(pan) || pan < -50 || pan > 50) {
            notifyUser('Clipboard does not contain a valid track pan value.', 'error');
            restorePanFocus(receipt);
            return;
        }
        commitMenuPan(receipt, pan);
    };

    const resetGain = (): void => {
        const receipt = captureGainIntent();
        if (receipt) {
            commitMenuGain(receipt, 0.8);
        }
    };

    const enterGain = async (): Promise<void> => {
        const receipt = captureGainIntent();
        if (!receipt) {
            return;
        }
        const initialValue = `${formatGainDb(receipt.expectedGain)} dB`;
        const input = await promptUser({
            title: 'Enter Track Gain',
            message: `Enter track gain from ${TRACK_FADER_LAW.floorDb} to +${TRACK_FADER_LAW.ceilingDb} dB; -∞ for silence.`,
            initialValue,
            confirmLabel: 'Set Gain',
        });
        if (!receipt.shouldExecute()) {
            return;
        }
        restoreGainFocus(receipt);
        if (input === null || input === initialValue) {
            return;
        }
        const gain = parseMasterGainEntry(input);
        if (gain === null) {
            notifyUser('Enter a valid track gain in dB, or -∞ for silence.', 'error');
            return;
        }
        commitMenuGain(receipt, gain);
    };

    const copyGain = async (): Promise<void> => {
        const receipt = captureGainIntent();
        if (!receipt) {
            return;
        }
        try {
            if (!navigator.clipboard?.writeText) {
                throw new Error('Clipboard unavailable');
            }
            await navigator.clipboard.writeText(`gain:${String(receipt.expectedGain)}`);
            if (receipt.shouldExecute()) {
                restoreGainFocus(receipt);
            }
        } catch {
            if (receipt.shouldExecute()) {
                notifyUser('Could not copy track gain to the clipboard.', 'error');
                restoreGainFocus(receipt);
            }
        }
    };

    const pasteGain = async (): Promise<void> => {
        const receipt = captureGainIntent();
        if (!receipt) {
            return;
        }
        let text: string;
        try {
            if (!navigator.clipboard?.readText) {
                throw new Error('Clipboard unavailable');
            }
            text = await navigator.clipboard.readText();
        } catch {
            if (receipt.shouldExecute()) {
                notifyUser('Could not read track gain from the clipboard.', 'error');
                restoreGainFocus(receipt);
            }
            return;
        }
        if (!receipt.shouldExecute()) {
            return;
        }
        const encoded = text.startsWith('gain:') ? text.slice(5) : '';
        const gain = Number(encoded);
        if (!encoded || String(gain) !== encoded || !Number.isFinite(gain) || gain < 0 || gain > FADER_MAX_GAIN) {
            notifyUser('Clipboard does not contain a valid track gain value.', 'error');
            restoreGainFocus(receipt);
            return;
        }
        commitMenuGain(receipt, gain);
    };

    const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setGainMenu(null);
        setCtxMenu({ x: event.clientX, y: event.clientY });
    };

    useContextMenuDismiss(ctxRef, () => setCtxMenu(null));

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
    const panReadout = (): string => {
        if (actions.displayPan === 0) {
            return 'C';
        }
        if (actions.displayPan > 0) {
            return `R${Math.round(actions.displayPan)}`;
        }
        return `L${Math.abs(Math.round(actions.displayPan))}`;
    };
    const renderContextMenu = (): ReactElement | null => {
        if (!ctxMenu) {
            return null;
        }
        return (
            <MixerPopupMenu
                ref={ctxRef}
                position="fixed"
                className="max-h-[70vh] overflow-y-auto"
                style={{ left: ctxMenu.x, top: ctxMenu.y }}
                role="menu"
            >
                <MixerPopupOption role="menuitem" onClick={act(actions.toggleMute)}>
                    {track.muted ? 'Unmute' : 'Mute'}
                </MixerPopupOption>
                <MixerPopupOption role="menuitem" onClick={act(() => actions.toggleSolo(true))}>
                    {track.soloed ? 'Unsolo' : 'Solo'}
                </MixerPopupOption>
                <MixerPopupOption role="menuitem" onClick={act(actions.toggleSoloSafeFlag)}>
                    {track.soloSafe ? 'Disable Solo Safe' : 'Solo Safe'}
                </MixerPopupOption>
                <MixerPopupOption role="menuitem" onClick={act(actions.toggleArm)}>
                    {track.armed ? 'Disarm' : 'Arm for Recording'}
                </MixerPopupOption>
                <MixerPopupSeparator />
                <MixerPopupOption role="menuitem" onClick={act(() => setIsRenaming(true))}>
                    Rename…
                </MixerPopupOption>
                <MixerPopupSeparator />
                <MixerPopupLabel>Color</MixerPopupLabel>
                <Row align="stretch" gap={1} className="px-3 py-1">
                    {TRACK_COLOR_PRESETS.map((context) => (
                        <DawSwatchButton
                            key={context}
                            color={context}
                            active={context === track.color}
                            onClick={act(() => actions.setColor(context))}
                            aria-label={`Set color`}
                        />
                    ))}
                </Row>
                <MixerPopupSeparator />
                <MixerPopupLabel>VCA Group</MixerPopupLabel>
                {getVcaGroups().map((g) => (
                    <MixerPopupOption
                        key={g.id}
                        active={track.vcaGroupId === g.id}
                        role="menuitem"
                        onClick={act(() => actions.toggleVca(g.id))}
                    >
                        {track.vcaGroupId === g.id ? `✓ ${g.name}` : g.name}
                    </MixerPopupOption>
                ))}
                <MixerPopupOption role="menuitem" onClick={act(actions.createVcaAndAssign)}>
                    + New VCA Group
                </MixerPopupOption>
                {track.vcaGroupId ? (
                    <MixerPopupOption
                        role="menuitem"
                        className="text-muted-foreground"
                        onClick={act(actions.removeFromVca)}
                    >
                        Remove from VCA
                    </MixerPopupOption>
                ) : null}
                <MixerPopupSeparator />
                <MixerPopupOption role="menuitem" tone="danger" onClick={act(actions.removeWithConfirm)}>
                    Remove Channel
                </MixerPopupOption>
            </MixerPopupMenu>
        );
    };

    return (
        <div
            className={cn(
                'flex shrink-0 flex-col items-center gap-1.5 rounded-lg p-2',
                widthClass,
                'border border-border-soft border-t-[var(--color-light-edge)] shadow-[0_1px_2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.03)]',
                isSelected && 'ring-1 ring-ring border-transparent'
            )}
            style={{ background: 'linear-gradient(180deg, #0c0c0c 0%, #0a0a0a 100%)' }}
            onClick={actions.select}
            onContextMenu={handleContextMenu}
            role="group"
            aria-label={`${track.name} channel`}
            data-testid={`channel-${track.id}`}
        >
            {/* Color bar */}
            <div className="h-1.5 w-full rounded-t-sm -mt-2 mb-1" style={{ backgroundColor: track.color }} />
            {/* Track name */}
            {isRenaming ? (
                <DawCompactInput
                    ref={renameRef}
                    defaultValue={track.name}
                    size="micro"
                    align="center"
                    monospace
                    className="w-full px-1 text-[9px]"
                    onBlur={(event) => {
                        actions.rename(event.currentTarget.value);
                        setIsRenaming(false);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            actions.rename(event.currentTarget.value);
                            setIsRenaming(false);
                        }
                        if (event.key === 'Escape') {
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
            {track.vcaGroupId ? (
                <DawMicroBadge tone="cyan" rounded="full" className="font-mono">
                    VCA
                </DawMicroBadge>
            ) : null}
            {/* Mute / Solo / Arm / Monitor */}
            <Row wrap align="stretch" justify="center" gap={1}>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <LatchButton
                            active={track.muted}
                            variant="amber"
                            size="icon-sm"
                            aria-label={track.muted ? 'Unmute' : 'Mute'}
                            data-testid={`channel-mute-${track.id}`}
                            className="font-bold text-[10px]"
                            onClick={(event) => {
                                event.stopPropagation();
                                actions.toggleMute();
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
                            data-testid={`channel-solo-${track.id}`}
                            className="font-bold text-[10px]"
                            onClick={(event) => {
                                event.stopPropagation();
                                actions.toggleSolo(event.metaKey || event.ctrlKey);
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
                            onClick={(event) => {
                                event.stopPropagation();
                                actions.toggleArm();
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
                                onClick={(event) => {
                                    event.stopPropagation();
                                    actions.toggleMonitoring();
                                }}
                            >
                                <Ear className={cn('size-3', track.inputMonitoring === 'on' && 'fill-state-play/30')} />
                            </LatchButton>
                        </TooltipTrigger>
                        <TooltipContent>Input monitoring</TooltipContent>
                    </Tooltip>
                ) : null}
                {track.soloSafe ? <ShieldCheck className="size-3 text-state-active" aria-label="Solo safe" /> : null}
            </Row>
            <MixerLevelReadout
                trackId={track.id}
                control={
                    /*
                     * audit M-083: the fader is now keyboard-operable, and a keyboard
                     * write never produces a pointerup. Without the matching `onKeyUp`
                     * a touch-mode gain change made from the keyboard would leave the
                     * automation lane latched until transport stop. The wrapper is a
                     * delegation container for events bubbling out of the fader, so it
                     * is marked presentational — the slider inside carries the semantics.
                     */
                    <div
                        ref={gainControlRef}
                        role="presentation"
                        className="shrink-0"
                        data-testid={`channel-gain-${track.id}`}
                        onPointerUp={actions.releaseGainAutomation}
                        onKeyUp={actions.releaseGainAutomation}
                        onContextMenu={gainContextMenu}
                        onKeyDown={gainMenuKeyDown}
                    >
                        <Fader
                            // Mid-drag the strip draws the gesture, not project
                            // truth: the transient half of the gesture only
                            // reaches the audio engine, so reading `track.gain`
                            // here would leave the cap pinned while the level
                            // moved.
                            value={actions.displayGain}
                            onChange={(value, isTransient) => {
                                gainIntent.current += 1;
                                actions.setGain(value, isTransient);
                            }}
                            min={0}
                            // The fader law's own ceiling — the same bound the
                            // writer clamps to, so this control can never ask
                            // for a value `setTrackGain` would refuse and
                            // strand the undo entry's `expectedGain`.
                            max={FADER_MAX_GAIN}
                            valueScale="gain"
                            unityValue={1}
                            step={0.01}
                            fineStep={0.001}
                            defaultValue={0.8}
                            height={100}
                            aria-label={`${track.name} gain`}
                        />
                    </div>
                }
                value={<>{formatGainDb(actions.displayGain)} dB</>}
            />
            {/* Pan */}
            <Stack align="center" className="mt-2 mb-2 w-full px-1">
                <div
                    ref={panControlRef}
                    role="presentation"
                    className="shrink-0"
                    data-testid={`channel-pan-${track.id}`}
                    onPointerUp={actions.releasePanAutomation}
                    onKeyUp={actions.releasePanAutomation}
                    onContextMenu={panContextMenu}
                    onKeyDown={panMenuKeyDown}
                >
                    <RotaryKnob
                        value={actions.displayPan}
                        onChange={(value, isTransient) => {
                            panIntent.current += 1;
                            actions.setPan(value, isTransient);
                        }}
                        min={-50}
                        max={50}
                        size="sm"
                        aria-label={`${track.name} pan`}
                        bipolar
                    />
                </div>
                <MixerStripValue size="sm">{panReadout()}</MixerStripValue>
            </Stack>
            {/* MIDI FX */}
            <MidiFxSection track={track} />
            {/* Devices — contained with scroll */}
            <DeviceChainSection track={track} />
            {/* Sends */}
            <SendsSection track={track} />
            {/* I/O */}
            <IOSection track={track} />
            {/* Context menu */}
            {renderContextMenu()}
            {gainMenu ? (
                <DawContextMenuSurface
                    ref={gainMenuRef}
                    role="menu"
                    aria-label={`${track.name} gain actions`}
                    x={gainMenu.x}
                    y={gainMenu.y}
                    onClose={closeGainMenu}
                    onClick={(event) => event.stopPropagation()}
                    onContextMenu={(event) => event.stopPropagation()}
                    onBlurCapture={(event) => {
                        const destination = event.relatedTarget;
                        if (!(destination instanceof HTMLElement) || event.currentTarget.contains(destination)) {
                            return;
                        }
                        const intent = gainIntent.current;
                        window.requestAnimationFrame(() => {
                            if (
                                mounted.current &&
                                gainIntent.current === intent &&
                                destination.isConnected &&
                                (document.activeElement === slider() || document.activeElement === document.body)
                            ) {
                                destination.focus();
                            }
                        });
                    }}
                    onKeyDown={(event) => {
                        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                            return;
                        }
                        const items = Array.from(
                            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
                        );
                        const current = items.findIndex((item) => item === document.activeElement);
                        let next: number;
                        if (event.key === 'Home' || (current < 0 && event.key === 'ArrowDown')) {
                            next = 0;
                        } else if (event.key === 'End' || current < 0) {
                            next = items.length - 1;
                        } else {
                            const direction = event.key === 'ArrowDown' ? 1 : -1;
                            next = (current + direction + items.length) % items.length;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        items[next]?.focus();
                    }}
                >
                    <DawMenuButton role="menuitem" onClick={resetGain}>
                        Reset to Default
                    </DawMenuButton>
                    <DawMenuButton role="menuitem" onClick={() => void enterGain()}>
                        Enter Value
                    </DawMenuButton>
                    <DawMenuButton role="menuitem" onClick={() => void copyGain()}>
                        Copy Value
                    </DawMenuButton>
                    <DawMenuButton role="menuitem" onClick={() => void pasteGain()}>
                        Paste Value
                    </DawMenuButton>
                </DawContextMenuSurface>
            ) : null}
            {panMenu ? (
                <DawContextMenuSurface
                    ref={panMenuRef}
                    role="menu"
                    aria-label={`${track.name} pan actions`}
                    x={panMenu.x}
                    y={panMenu.y}
                    onClose={closePanMenu}
                    onClick={(event) => event.stopPropagation()}
                    onContextMenu={(event) => event.stopPropagation()}
                    onBlurCapture={(event) => {
                        const destination = event.relatedTarget;
                        if (!(destination instanceof HTMLElement) || event.currentTarget.contains(destination)) {
                            return;
                        }
                        const intent = panIntent.current;
                        window.requestAnimationFrame(() => {
                            if (
                                mounted.current &&
                                panIntent.current === intent &&
                                destination.isConnected &&
                                (document.activeElement === panKnob() || document.activeElement === document.body)
                            ) {
                                destination.focus();
                            }
                        });
                    }}
                    onKeyDown={(event) => {
                        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                            return;
                        }
                        const items = Array.from(
                            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
                        );
                        const current = items.findIndex((item) => item === document.activeElement);
                        let next: number;
                        if (event.key === 'Home' || (current < 0 && event.key === 'ArrowDown')) {
                            next = 0;
                        } else if (event.key === 'End' || current < 0) {
                            next = items.length - 1;
                        } else {
                            const direction = event.key === 'ArrowDown' ? 1 : -1;
                            next = (current + direction + items.length) % items.length;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        items[next]?.focus();
                    }}
                >
                    <DawMenuButton role="menuitem" onClick={resetPan}>
                        Reset to Default
                    </DawMenuButton>
                    <DawMenuButton role="menuitem" onClick={() => void enterPan()}>
                        Enter Value
                    </DawMenuButton>
                    <DawMenuButton role="menuitem" onClick={() => void copyPan()}>
                        Copy Value
                    </DawMenuButton>
                    <DawMenuButton role="menuitem" onClick={() => void pastePan()}>
                        Paste Value
                    </DawMenuButton>
                </DawContextMenuSurface>
            ) : null}
        </div>
    );
};
