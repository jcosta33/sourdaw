import { type ReactElement, type RefObject, useState } from 'react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { useStore } from '#/infra/store/useStore';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';

import { isMpeLaneAvailableForDeviceTypes } from '../../helpers/mpeAvailability';
import { CCLane } from '../AutomationLane/CCLane';
import { PitchBendLane } from '../AutomationLane/PitchBendLane';
import { PressureLane } from '../AutomationLane/PressureLane';
import { ProbabilityLane } from '../AutomationLane/ProbabilityLane';
import { SlideLane } from '../AutomationLane/SlideLane';
import { VelocityLane } from '../AutomationLane/VelocityLane';

type LaneMode =
    | { kind: 'velocity' }
    | { kind: 'probability' }
    | { kind: 'cc'; controller: number; label: string }
    | { kind: 'pitchBend' }
    | { kind: 'pressure' }
    | { kind: 'slide' };

const LANE_OPTIONS: { value: string; label: string; mode: LaneMode }[] = [
    { value: 'velocity', label: 'Velocity', mode: { kind: 'velocity' } },
    { value: 'probability', label: 'Probability', mode: { kind: 'probability' } },
    { value: 'pressure', label: 'Pressure', mode: { kind: 'pressure' } },
    { value: 'slide', label: 'Slide (CC74)', mode: { kind: 'slide' } },
    { value: 'cc1', label: 'CC 1 (Mod Wheel)', mode: { kind: 'cc', controller: 1, label: 'Mod Wheel' } },
    { value: 'cc7', label: 'CC 7 (Volume)', mode: { kind: 'cc', controller: 7, label: 'Volume' } },
    { value: 'cc10', label: 'CC 10 (Pan)', mode: { kind: 'cc', controller: 10, label: 'Pan' } },
    { value: 'cc11', label: 'CC 11 (Expression)', mode: { kind: 'cc', controller: 11, label: 'Expression' } },
    { value: 'cc64', label: 'CC 64 (Sustain)', mode: { kind: 'cc', controller: 64, label: 'Sustain' } },
    { value: 'pitchBend', label: 'Pitch Bend', mode: { kind: 'pitchBend' } },
];

/**
 * Lanes offered in the selector. Each MPE per-note expression lane (Pressure,
 * Slide/CC74, Pitch Bend) is offered only when the *track's own instrument*
 * sounds that dimension (audit MD-2); the availability list is derived from the
 * engine registry, so the editor never offers a lane the track's instrument
 * would silently swallow — a Grand Boule track gets Pitch Bend but not Pressure
 * or Slide. `LANE_OPTIONS`, the lane components and the MIDI use cases they
 * call stay intact for every track.
 */
function visibleLaneOptions(deviceTypes: readonly string[]): typeof LANE_OPTIONS {
    return LANE_OPTIONS.filter((option) => isMpeLaneAvailableForDeviceTypes(option.value, deviceTypes));
}

/** Width of the piano-key gutter in PianoRoll (w-10 = 2.5rem = 40px) */
const PIANO_KEY_GUTTER = 40;

type AutomationLaneProps = {
    clipId: string | null;
    trackId: string;
    selectedNoteIds: Set<string>;
    beatWidth: number;
    contentWidth: number;
    scrollRef: RefObject<HTMLDivElement | null>;
};

export const AutomationLane = ({
    clipId,
    trackId,
    selectedNoteIds,
    beatWidth,
    contentWidth,
    scrollRef,
}: AutomationLaneProps): ReactElement => {
    const [selectedLane, setSelectedLane] = useState('velocity');
    const trackState = useStore(trackStore, defaultTrackState);

    const track = trackState.tracks.find((candidate) => candidate.id === trackId);
    const laneOptions = visibleLaneOptions(track?.devices.map((device) => device.type) ?? []);

    const laneOption = LANE_OPTIONS.find((output) => output.value === selectedLane) ?? LANE_OPTIONS[0]!;
    const mode = laneOption.mode;

    const renderLane = (): ReactElement => {
        if (mode.kind === 'velocity') {
            return (
                <VelocityLane
                    clipId={clipId}
                    trackId={trackId}
                    selectedNoteIds={selectedNoteIds}
                    beatWidth={beatWidth}
                    scrollRef={scrollRef}
                />
            );
        }
        if (mode.kind === 'probability') {
            return (
                <ProbabilityLane
                    clipId={clipId}
                    trackId={trackId}
                    selectedNoteIds={selectedNoteIds}
                    beatWidth={beatWidth}
                    scrollRef={scrollRef}
                />
            );
        }
        if (mode.kind === 'pressure') {
            return (
                <PressureLane
                    clipId={clipId}
                    trackId={trackId}
                    selectedNoteIds={selectedNoteIds}
                    beatWidth={beatWidth}
                    scrollRef={scrollRef}
                />
            );
        }
        if (mode.kind === 'slide') {
            return (
                <SlideLane
                    clipId={clipId}
                    trackId={trackId}
                    selectedNoteIds={selectedNoteIds}
                    beatWidth={beatWidth}
                    scrollRef={scrollRef}
                />
            );
        }
        if (mode.kind === 'cc') {
            return (
                <CCLane
                    clipId={clipId}
                    controller={mode.controller}
                    beatWidth={beatWidth}
                    contentWidth={contentWidth}
                />
            );
        }
        return <PitchBendLane clipId={clipId} beatWidth={beatWidth} contentWidth={contentWidth} />;
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-2 py-0.5 border-b border-border/30 bg-surface-raised shrink-0">
                <label htmlFor="lane-selector" className="text-[9px] text-muted-foreground shrink-0">
                    Lane:
                </label>
                <DawCompactSelect
                    id="lane-selector"
                    value={selectedLane}
                    onChange={(event) => setSelectedLane(event.target.value)}
                    size="micro"
                    aria-label="Automation lane type"
                >
                    {laneOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </DawCompactSelect>
            </div>
            <div className="flex flex-1 min-h-0">
                {/* Piano-key gutter spacer — matches PianoRoll's w-10 column */}
                <div
                    className="shrink-0 border-r border-border/30 bg-surface-raised"
                    style={{ width: PIANO_KEY_GUTTER }}
                />
                {/* Scrollable lane area — synced to PianoRoll scroll */}
                <div
                    ref={scrollRef}
                    className="flex-1 overflow-x-auto overflow-y-hidden"
                    style={{ scrollbarWidth: 'none' }}
                >
                    <div style={{ width: contentWidth, height: '100%' }}>{renderLane()}</div>
                </div>
            </div>
        </div>
    );
};
