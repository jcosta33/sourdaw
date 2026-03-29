/**
 * MicBlendSlider — mic position mixing with Faders.
 *
 * Compact: single knob for Close vs Room blend.
 * Full: per-mic Fader strips with volume, pan, enable toggle.
 */
import { type ReactElement } from 'react';
import { Fader } from '#/components/daw/Fader';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { type MicPositionState } from '../../models/LevainPatch';
import { updateMicPosition } from '../../stores/levainStore';

type MicBlendSliderProps = {
    micPositions: MicPositionState[];
    showFull: boolean;
};

export const MicBlendSlider = ({
    micPositions,
    showFull,
}: MicBlendSliderProps): ReactElement => {
    if (showFull) {
        // Full mic mixer with faders
        return (
            <div className="space-y-3 max-w-[400px]">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Mic Positions
                </span>
                <div className="flex gap-3 items-end">
                    {micPositions.map((mic, i) => (
                        <div key={i} className="flex flex-col items-center gap-1">
                            <button
                                type="button"
                                className={`text-[7px] font-medium px-1 rounded transition-colors ${
                                    mic.enabled
                                        ? 'text-amber-300 bg-amber-500/15'
                                        : 'text-muted-foreground/40'
                                }`}
                                onClick={() => updateMicPosition(i, { enabled: !mic.enabled })}
                            >
                                {mic.enabled ? 'ON' : 'OFF'}
                            </button>
                            <Fader
                                value={mic.enabled ? mic.volume * 76 - 70 : -70}
                                onChange={(db) =>
                                    updateMicPosition(i, { volume: Math.max(0, Math.min(1, (db + 70) / 76)) })
                                }
                                min={-70}
                                max={6}
                                defaultValue={-6}
                                height={100}
                            />
                            <RotaryKnob
                                value={mic.pan}
                                onChange={(v) => updateMicPosition(i, { pan: v })}
                                min={-1}
                                max={1}
                                step={0.01}
                                defaultValue={0}
                                bipolar
                                size="sm"
                            />
                            <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider leading-tight text-center">
                                {mic.name}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // Compact: single Close/Room blend knob
    const closeVol = micPositions[0]?.volume ?? 0.8;
    const roomVol = micPositions.length > 2 ? (micPositions[2]?.volume ?? 0.3) : 0.3;
    const blend = roomVol / (closeVol + roomVol + 0.001);

    return (
        <div className="space-y-1">
            <span className="text-[8px] text-muted-foreground/50 uppercase tracking-wider">
                Space
            </span>
            <div className="flex flex-col items-center gap-0">
                <RotaryKnob
                    value={blend}
                    onChange={(v) => {
                        updateMicPosition(0, { volume: 1.0 - v * 0.5 });
                        if (micPositions.length > 2) {
                            updateMicPosition(2, { volume: v, enabled: v > 0.05 });
                        }
                    }}
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0.3}
                    size="md"
                />
                <div className="flex justify-between w-full px-1">
                    <span className="text-[6px] text-muted-foreground/40">Close</span>
                    <span className="text-[6px] text-muted-foreground/40">Room</span>
                </div>
            </div>
        </div>
    );
};
