import { inject } from '#/infra/di/inject';

import { MPE_MASTER_CHANNEL } from '../../models/MidiControllerState';
import { channelPitchBendState } from '../../repositories/webMidi/channelPitchBendState';
import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { getTargetTrackId } from '../../repositories/webMidi/getTargetTrackId';
import { setMpeEnabled as setWebMidiMpeEnabled } from '../../repositories/webMidi/lifecycle/setMpeEnabled';

import { midiMessageHandlerDependencies } from './midiMessageHandlerDependencies';
import { recordChannelEvent, type RecordChannelEventDependencies } from './recordChannelEvent';

type ChannelBendRow = { channel: number; value: number; channelScoped: boolean };

function listOffCentreWheels(): [number, number][] {
    return [...channelPitchBendState].filter(([, value]) => value !== 0).toSorted(([l], [r]) => l - r);
}

/**
 * The rows a take needs where MPE is switched, so stored playback bends the notes the live input bends.
 *
 * Switched on, every note starts under the zone master's wheel: one unscoped master row overrides the
 * scoped rows recorded before it. Switched off, the master's reach ends and each channel is back under its
 * own wheel: a centred unscoped row ends the master's reach, then each off-centre wheel is scoped again.
 * With every wheel centred the rows already in force agree with the live input, so none is written.
 */
function listSwitchRows(enabled: boolean): ChannelBendRow[] {
    const offCentre = listOffCentreWheels();
    if (offCentre.length === 0) {
        return [];
    }
    if (enabled) {
        const masterValue = channelPitchBendState.get(MPE_MASTER_CHANNEL) ?? 0;
        return [{ channel: MPE_MASTER_CHANNEL, value: masterValue, channelScoped: false }];
    }
    return [
        { channel: MPE_MASTER_CHANNEL, value: 0, channelScoped: false },
        ...offCentre.map(([channel, value]) => ({ channel, value, channelScoped: true })),
    ];
}

function recordSwitchRows(deps: RecordChannelEventDependencies, enabled: boolean): void {
    const trackId = getTargetTrackId();
    for (const { channel, value, channelScoped } of listSwitchRows(enabled)) {
        recordChannelEvent(deps, {
            trackId,
            channel,
            event: { kind: 'pitchBend', value, channelScoped },
            timeStamp: undefined,
        });
    }
}

export const setMpeEnabled = inject(midiMessageHandlerDependencies)(
    (deps) =>
        function setMpeEnabled(enabled: boolean): void {
            const wasEnabled = getMpeEnabled();
            setWebMidiMpeEnabled(enabled);
            if (wasEnabled !== enabled) {
                recordSwitchRows(deps, enabled);
            }
        }
);
