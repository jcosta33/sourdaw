/**
 * Pad Mixer — channel strips for all pads.
 * Each strip: volume fader, pan, mute/solo, send indicators.
 */
import { type ReactElement } from 'react';

import { type PadState } from '../../models/ToasterKit';

type PadMixerProps = {
    pads: PadState[];
    onPadParam: (padIndex: number, key: string, value: number) => void;
};

export const PadMixer = ({ pads, onPadParam }: PadMixerProps): ReactElement => (
    <div className="flex gap-0.5 overflow-x-auto pb-1">
        {pads.slice(0, 16).map((pad, index) => (
            <div key={pad.id} className="flex flex-col items-center w-9 shrink-0">
                {/* Volume fader track */}
                <div
                    className="w-3 rounded-full relative cursor-ns-resize mb-0.5"
                    style={{ height: 50, backgroundColor: 'rgba(255,255,255,0.04)' }}
                    onPointerDown={(event) => {
                        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                        const setVol = (clientY: number) => {
                            const ratio = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
                            onPadParam(index, 'volume', ratio);
                        };
                        setVol(event.clientY);
                        const onMove = (ev: PointerEvent) => setVol(ev.clientY);
                        const onUp = () => {
                            document.removeEventListener('pointermove', onMove);
                            document.removeEventListener('pointerup', onUp);
                        };
                        document.addEventListener('pointermove', onMove);
                        document.addEventListener('pointerup', onUp);
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
                <div className="flex gap-px mb-0.5">
                    <button
                        type="button"
                        className={`w-3.5 h-3 rounded text-[5px] font-bold leading-none flex items-center justify-center ${pad.muted ? 'bg-red-500/80 text-white' : 'bg-surface-inset/50 text-muted-foreground/30'}`}
                        onClick={() => onPadParam(index, 'muted', pad.muted ? 0 : 1)}
                    >
                        M
                    </button>
                    <button
                        type="button"
                        className={`w-3.5 h-3 rounded text-[5px] font-bold leading-none flex items-center justify-center ${pad.soloed ? 'bg-[var(--color-accent-mint)]/80 text-white' : 'bg-surface-inset/50 text-muted-foreground/30'}`}
                        onClick={() => onPadParam(index, 'soloed', pad.soloed ? 0 : 1)}
                    >
                        S
                    </button>
                </div>

                {/* Name */}
                <span
                    className="text-[5px] leading-tight truncate w-full text-center"
                    style={{ color: `${pad.color}88` }}
                >
                    {pad.name.slice(0, 5)}
                </span>
            </div>
        ))}
    </div>
);
