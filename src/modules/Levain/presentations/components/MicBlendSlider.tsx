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

/** Full mic mixer: one Fader/toggle/pan strip per loaded mic position. */
const FullMicMixer = ({
    micPositions,
    onSendMicParam,
    onUpdateMicPosition,
}: Omit<MicBlendSliderProps, 'showFull'>): ReactElement => (
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
                    <span className="text-nano text-muted-foreground/60 uppercase tracking-wider leading-tight text-center">
                        {mic.name}
                    </span>
                </Stack>
            ))}
        </Row>
    </Stack>
);

export const MicBlendSlider = ({
    micPositions,
    showFull,
    onSendMicParam,
    onUpdateMicPosition,
}: MicBlendSliderProps): ReactElement => {
    if (showFull) {
        return (
            <FullMicMixer
                micPositions={micPositions}
                onSendMicParam={onSendMicParam}
                onUpdateMicPosition={onUpdateMicPosition}
            />
        );
    }

    // Compact: single Close/Room blend knob. Resolve both mics by their
    // `type` field — never by a fixed index — because the loaded bank decides
    // which array position (if any) carries `room`; the Space macro resolves
    // the same way, so the two controls agree instead of fighting over a
    // different room mic.
    const closeIndex = micPositions.findIndex((mic) => mic.type === 'close');
    const roomIndex = micPositions.findIndex((mic) => mic.type === 'room');
    if (roomIndex === -1) {
        // No loaded room mic: there is nothing to blend toward, so the
        // compact control has nothing meaningful to show.
        return <></>;
    }
    const closeVol = closeIndex === -1 ? 0.8 : (micPositions[closeIndex]?.volume ?? 0.8);
    const roomVol = micPositions[roomIndex]?.volume ?? 0.3;
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
                        if (closeIndex !== -1) {
                            onUpdateMicPosition(closeIndex, { volume: newCloseVol });
                            onSendMicParam(closeIndex, 'volume', newCloseVol);
                        }
                        onUpdateMicPosition(roomIndex, { volume: newRoomVol, enabled: newRoomVol > 0.05 });
                        onSendMicParam(roomIndex, 'volume', newRoomVol);
                        onSendMicParam(roomIndex, 'enabled', newRoomVol > 0.05 ? 1.0 : 0.0);
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
