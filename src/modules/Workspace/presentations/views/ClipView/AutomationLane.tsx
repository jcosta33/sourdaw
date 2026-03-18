import { type ReactElement, useState } from 'react';
import { VelocityLane } from '../../components/automationLane/VelocityLane';
import { PressureLane } from '../../components/automationLane/PressureLane';
import { SlideLane } from '../../components/automationLane/SlideLane';
import { CCLane } from '../../components/automationLane/CCLane';
import { PitchBendLane } from '../../components/automationLane/PitchBendLane';

type LaneMode =
    | { kind: 'velocity' }
    | { kind: 'cc'; controller: number; label: string }
    | { kind: 'pitchBend' }
    | { kind: 'pressure' }
    | { kind: 'slide' };

const LANE_OPTIONS: { value: string; label: string; mode: LaneMode }[] = [
    { value: 'velocity', label: 'Velocity', mode: { kind: 'velocity' } },
    { value: 'pressure', label: 'Pressure', mode: { kind: 'pressure' } },
    { value: 'slide', label: 'Slide (CC74)', mode: { kind: 'slide' } },
    { value: 'cc1', label: 'CC 1 (Mod Wheel)', mode: { kind: 'cc', controller: 1, label: 'Mod Wheel' } },
    { value: 'cc7', label: 'CC 7 (Volume)', mode: { kind: 'cc', controller: 7, label: 'Volume' } },
    { value: 'cc10', label: 'CC 10 (Pan)', mode: { kind: 'cc', controller: 10, label: 'Pan' } },
    { value: 'cc11', label: 'CC 11 (Expression)', mode: { kind: 'cc', controller: 11, label: 'Expression' } },
    { value: 'cc64', label: 'CC 64 (Sustain)', mode: { kind: 'cc', controller: 64, label: 'Sustain' } },
    { value: 'pitchBend', label: 'Pitch Bend', mode: { kind: 'pitchBend' } },
];

type AutomationLaneProps = {
    clipId: string | null;
    selectedNoteIds: Set<string>;
};

export const AutomationLane = ({ clipId, selectedNoteIds }: AutomationLaneProps): ReactElement => {
    const [selectedLane, setSelectedLane] = useState('velocity');

    const laneOption = LANE_OPTIONS.find((o) => o.value === selectedLane) ?? LANE_OPTIONS[0]!;
    const mode = laneOption.mode;

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-2 py-0.5 border-b border-border/30 bg-surface-raised shrink-0">
                <label htmlFor="lane-selector" className="text-[9px] text-muted-foreground shrink-0">
                    Lane:
                </label>
                <select
                    id="lane-selector"
                    value={selectedLane}
                    onChange={(e) => setSelectedLane(e.target.value)}
                    className="h-5 rounded border border-border/50 bg-surface-overlay px-1 text-[9px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label="Automation lane type"
                >
                    {LANE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
            </div>

            <div className="flex-1 min-h-0">
                {mode.kind === 'velocity' ? (
                    <VelocityLane clipId={clipId} selectedNoteIds={selectedNoteIds} />
                ) : mode.kind === 'pressure' ? (
                    <PressureLane clipId={clipId} selectedNoteIds={selectedNoteIds} />
                ) : mode.kind === 'slide' ? (
                    <SlideLane clipId={clipId} selectedNoteIds={selectedNoteIds} />
                ) : mode.kind === 'cc' ? (
                    <CCLane clipId={clipId} controller={mode.controller} />
                ) : (
                    <PitchBendLane clipId={clipId} />
                )}
            </div>
        </div>
    );
};
