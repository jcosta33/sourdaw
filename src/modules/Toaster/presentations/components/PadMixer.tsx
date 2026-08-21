/**
 * Pad Mixer — channel strips for all pads.
 * Each strip: volume fader, pan, mute/solo, send indicators.
 */
import { type ReactElement } from 'react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

import { type PadState } from '../../models/ToasterKit';

type PadMixerProps = {
    pads: PadState[];
    onPadParam: (padIndex: number, key: string, value: number) => void;
};

export const PadMixer = ({ pads, onPadParam }: PadMixerProps): ReactElement => (
    <Row align="stretch" gap={0.5} className="overflow-x-auto pb-1">
        {pads.slice(0, 16).map((pad, index) => (
            <Stack align="center" shrink={false} className="w-9" key={pad.id}>
                {/* Volume fader track */}
                <div
                    className="w-3 rounded-full relative cursor-ns-resize mb-0.5"
                    style={{ height: 50, backgroundColor: 'rgba(255,255,255,0.04)' }}
                    role="slider"
                    tabIndex={0}
                    aria-label={`${pad.name} volume`}
                    aria-orientation="vertical"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(pad.volume * 100)}
                    aria-valuetext={`${Math.round(pad.volume * 100)}%`}
                    onKeyDown={(event) => {
                        const step = event.shiftKey ? 0.1 : 0.05;
                        let next: number | null = null;
                        if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
                            next = Math.min(1, pad.volume + step);
                        } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
                            next = Math.max(0, pad.volume - step);
                        } else if (event.key === 'Home') {
                            next = 0;
                        } else if (event.key === 'End') {
                            next = 1;
                        }
                        if (next !== null) {
                            event.preventDefault();
                            onPadParam(index, 'volume', next);
                        }
                    }}
                    onPointerDown={(event) => {
                        const track = event.currentTarget as HTMLElement;
                        const setVol = (clientY: number) => {
                            // Recompute the rect each move so a mid-drag panel
                            // resize/scroll doesn't make the math stale.
                            const rect = track.getBoundingClientRect();
                            const ratio = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
                            onPadParam(index, 'volume', ratio);
                        };
                        setVol(event.clientY);
                        const onMove = (ev: PointerEvent) => setVol(ev.clientY);
                        const release = () => {
                            document.removeEventListener('pointermove', onMove);
                            document.removeEventListener('pointerup', release);
                            document.removeEventListener('pointercancel', release);
                            window.removeEventListener('blur', release);
                        };
                        document.addEventListener('pointermove', onMove);
                        document.addEventListener('pointerup', release);
                        document.addEventListener('pointercancel', release);
                        window.addEventListener('blur', release);
                    }}
                >
                    {/* Fill level */}
                    <div
                        className="absolute bottom-0 w-full rounded-full transition-[height] duration-75"
                        style={{
                            height: `${pad.volume * 100}%`,
                            backgroundColor: pad.muted ? 'rgba(255,255,255,0.1)' : pad.color,
                            opacity: pad.muted ? 0.3 : 0.6,
                        }}
                    />
                    {/* Send indicators as dots */}
                    {pad.sendReverb > 0.05 ? (
                        <div
                            className="absolute -right-1.5 bottom-1/4 w-1 h-1 rounded-full bg-[var(--color-accent-mint)]"
                            style={{ opacity: pad.sendReverb }}
                        />
                    ) : null}
                    {pad.sendDelay > 0.05 ? (
                        <div
                            className="absolute -right-1.5 bottom-1/2 w-1 h-1 rounded-full bg-[var(--color-accent-cyan)]"
                            style={{ opacity: pad.sendDelay }}
                        />
                    ) : null}
                </div>

                {/* Pan knob (simplified: just a dot indicator) */}
                <div className="w-5 h-1 rounded-full bg-surface-inset relative mb-0.5">
                    <div
                        className="absolute top-0 w-1 h-1 rounded-full"
                        style={{
                            left: `${(pad.pan + 1) * 50}%`,
                            transform: 'translateX(-50%)',
                            backgroundColor: pad.color,
                            opacity: 0.6,
                        }}
                    />
                </div>

                {/* Mute / Solo */}
                <Row align="stretch" className="gap-px mb-0.5">
                    <Button
                        variant="bare"
                        size="bare"
                        type="button"
                        className={`w-3.5 h-3 rounded text-[5px] font-bold leading-none flex items-center justify-center ${pad.muted ? 'bg-red-500/80 text-white' : 'bg-surface-inset/50 text-muted-foreground/30'}`}
                        onClick={() => onPadParam(index, 'muted', pad.muted ? 0 : 1)}
                    >
                        M
                    </Button>
                    {/* Live again: `Pad::set_param` carries a "soloed" arm and
                        `ToasterEngine::note_on` silences every pad that is not
                        soloed while any pad is. It was disabled while that DSP
                        was missing rather than removed, per the standing rule
                        that dead controls get implemented. */}
                    <Button
                        variant="bare"
                        size="bare"
                        type="button"
                        title="Solo this pad"
                        className={`w-3.5 h-3 rounded text-[5px] font-bold leading-none flex items-center justify-center ${pad.soloed ? 'bg-yellow-400/80 text-black' : 'bg-surface-inset/50 text-muted-foreground/30'}`}
                        onClick={() => onPadParam(index, 'soloed', pad.soloed ? 0 : 1)}
                    >
                        S
                    </Button>
                </Row>

                {/* Name */}
                <span
                    className="text-[5px] leading-tight truncate w-full text-center"
                    style={{ color: `${pad.color}88` }}
                >
                    {pad.name.slice(0, 5)}
                </span>
            </Stack>
        ))}
    </Row>
);
