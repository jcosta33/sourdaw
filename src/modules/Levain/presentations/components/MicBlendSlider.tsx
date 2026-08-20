/**
 * MicBlendSlider — mic position mixing with Faders.
 *
 * Compact: single knob for Close vs Room blend.
 * Full: per-mic Fader strips with volume, pan, enable toggle.
 *
 * NOTE: `onSendMicParam` is passed from the parent view so this component
 * does NOT import from useCases/ directly (DDD: components/ is private).
 */
import { type ReactElement } from 'react';

import { DawPluginSectionHeader } from '#/components/daw/DawPluginSectionHeader';
import { DawPluginToggle } from '#/components/daw/DawPluginToggle';
import { Fader } from '#/components/daw/Fader';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Row, Stack } from '#/components/layout';

import { type MicPositionState } from '../../models/LevainPatch';

type MicBlendSliderProps = {
    micPositions: MicPositionState[];
    showFull?: boolean;
    /** Forward mic param changes to the audio engine. Provided by the parent view. */
    onSendMicParam: (micIndex: number, param: string, value: number) => void;
    /** Update mic position state. Provided by the parent view. */
    onUpdateMicPosition: (index: number, updates: Partial<MicPositionState>) => void;
};

export const MicBlendSlider = ({
    micPositions,
    showFull,
    onSendMicParam,
    onUpdateMicPosition,
}: MicBlendSliderProps): ReactElement => {
    if (showFull) {
        // Full mic mixer with faders
        return (
            <Stack gap={3} className="max-w-[400px]">
                <DawPluginSectionHeader title="Mic Positions" titleClassName="text-muted-foreground" />
                <Row align="end" gap={3}>
                    {micPositions.map((mic, i) => (
                        <Stack align="center" gap={1} key={i}>
                            <DawPluginToggle
                                pressed={mic.enabled}
                                tone="amber"
                                size="xs"
                                onClick={() => {
                                    const enabled = !mic.enabled;
                                    onUpdateMicPosition(i, { enabled });
                                    onSendMicParam(i, 'enabled', enabled ? 1.0 : 0.0);
                                }}
                            >
                                {mic.enabled ? 'ON' : 'OFF'}
                            </DawPluginToggle>
                            <Fader
                                value={mic.enabled ? mic.volume * 76 - 70 : -70}
                                onChange={(db) => {
                                    const volume = Math.max(0, Math.min(1, (db + 70) / 76));
                                    onUpdateMicPosition(i, { volume });
                                    onSendMicParam(i, 'volume', volume);
                                }}
                                min={-70}
                                max={6}
                                defaultValue={-6}
                                height={100}
                                unit="dB"
                                // audit M-083: the visible mic name sits below the whole
                                // column, so it names nothing to assistive tech — the
                                // slider has to carry its own name and unit.
                                aria-label={`${mic.name} level`}
                            />
                            <RotaryKnob
                                value={mic.pan}
                                onChange={(v) => {
                                    onUpdateMicPosition(i, { pan: v });
                                    onSendMicParam(i, 'pan', v);
                                }}
                                min={-1}
                                max={1}
                                step={0.01}
                                defaultValue={0}
                                bipolar
                                size="sm"
                                tone="amber"
                            />
                            <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider leading-tight text-center">
                                {mic.name}
                            </span>
                        </Stack>
                    ))}
                </Row>
            </Stack>
        );
    }

    // Compact: single Close/Room blend knob.
    // Close is mic index 0; Room is the 'room'-type position (index 2 in the
    // default patch) — the same mic the Space macro drives, so the two controls
    // agree instead of fighting over a different room mic.
    const closeVol = micPositions[0]?.volume ?? 0.8;
    const roomVol = micPositions.length > 2 ? (micPositions[2]?.volume ?? 0.3) : 0.3;
    const total = closeVol + roomVol;
    // Guard the zero case explicitly: when both mics are silent there is no
    // meaningful blend, so sit at the neutral midpoint rather than biasing to
    // Room (the old `+0.001` fudge collapsed to full-Room whenever closeVol was 0).
    const blend = total === 0 ? 0.5 : roomVol / total;

    return (
        <Stack gap={1}>
            <DawPluginSectionHeader title="Space" size="xs" titleClassName="text-muted-foreground/50" />
            <Stack align="center">
                <RotaryKnob
                    value={blend}
                    onChange={(v) => {
                        // Symmetric crossfade so the knob round-trips: with
                        // close = 1 - v and room = v, blend = v/((1-v)+v) = v.
                        // The old `1 - v*0.5` close coupling pulled Close down as
                        // Room rose, so reading `blend` back never matched `v`.
                        const newCloseVol = 1.0 - v;
                        const newRoomVol = v;
                        onUpdateMicPosition(0, { volume: newCloseVol });
                        onSendMicParam(0, 'volume', newCloseVol);
                        if (micPositions.length > 2) {
                            onUpdateMicPosition(2, { volume: newRoomVol, enabled: newRoomVol > 0.05 });
                            onSendMicParam(2, 'volume', newRoomVol);
                            onSendMicParam(2, 'enabled', newRoomVol > 0.05 ? 1.0 : 0.0);
                        }
                    }}
                    tone="amber"
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0.3}
                    size="md"
                />
                <Row align="stretch" justify="between" className="w-full px-1">
                    <span className="text-[6px] text-muted-foreground/40">Close</span>
                    <span className="text-[6px] text-muted-foreground/40">Room</span>
                </Row>
            </Stack>
        </Stack>
    );
};
