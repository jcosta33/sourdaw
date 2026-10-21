/**
 * A persistent native note store holds a circular window, not a whole loop.
 * Reserve half its entries for upcoming events, then keep as much spent trail
 * as fits. Dense loops therefore shorten the time window instead of losing
 * their tail. The clock must be sampled before that admitted horizon runs out;
 * this control-side writer cannot recover frames the engine already rendered.
 */
import { logger } from '#/infra/logger/appLogger';

import { type AudioGraphCommand, type AudioGraphMidiNoteEvent } from '../../models/AudioGraphBackend';

import {
    MIDI_NOTE_STORE_CAPACITY,
    MIDI_TRAIL_SECONDS,
    MIDI_WINDOW_SECONDS,
    type LiveMidiFrameGroup,
    type LiveMidiWriterPass,
    type LiveMidiWriterTarget,
    type MidiAdmission,
    type MidiWriterBatch,
} from './nativeLiveMidiWriterState';

/** Prepare once per arm; every later tick visits only indexed windows and residents. */
export function indexLoopMidiFrames(
    events: readonly AudioGraphMidiNoteEvent[],
    sampleRate: number
): readonly LiveMidiFrameGroup[] {
    const groups: { frame: number; firstEventIndex: number; endEventIndex: number }[] = [];
    for (const [index, event] of events.entries()) {
        const frame = Math.round(event.time * sampleRate);
        const previous = groups.at(-1);
        if (previous?.frame === frame) {
            previous.endEventIndex = index + 1;
        } else {
            groups.push({ frame, firstEventIndex: index, endEventIndex: index + 1 });
        }
    }
    return groups;
}

function firstGroupAtFrame(groups: readonly LiveMidiFrameGroup[], frame: number): number {
    let first = 0;
    let end = groups.length;
    while (first < end) {
        const middle = Math.floor((first + end) / 2);
        const group = groups[middle];
        if (!group) {
            throw new Error('a prepared MIDI frame index must have no gaps');
        }
        if (group.frame < frame) {
            first = middle + 1;
        } else {
            end = middle;
        }
    }
    return first;
}

type AheadWindow = Readonly<{
    position: number;
    start: number;
    end: number;
    firstAtPosition: number;
    horizonFrames: number;
}>;

function takeAhead(
    slot: LiveMidiWriterTarget,
    groups: readonly LiveMidiFrameGroup[],
    window: AheadWindow
): Set<number> {
    const selected = new Set<number>();
    const loopFirst = firstGroupAtFrame(groups, window.start);
    const loopEnd = firstGroupAtFrame(groups, window.end);
    const admit = (group: LiveMidiFrameGroup, distance: number): boolean => {
        if (distance >= window.horizonFrames || selected.size >= MIDI_NOTE_STORE_CAPACITY / 2) {
            return false;
        }
        const count = group.endEventIndex - group.firstEventIndex;
        if (count > MIDI_NOTE_STORE_CAPACITY) {
            if (!slot.saturationReported) {
                slot.saturationReported = true;
                logger.warn(
                    `[AudioEngine] plugin "${slot.deviceName}" on "${slot.trackName}" cannot schedule ` +
                        `${count} MIDI entries at the same frame; the engine store holds ${MIDI_NOTE_STORE_CAPACITY}`
                );
            }
            return false;
        }
        if (selected.size + count > MIDI_NOTE_STORE_CAPACITY) {
            return false;
        }
        for (let index = group.firstEventIndex; index < group.endEventIndex; index += 1) {
            selected.add(index);
        }
        return true;
    };
    for (let index = window.firstAtPosition; index < loopEnd; index += 1) {
        const group = groups[index];
        if (!group || !admit(group, group.frame - window.position)) {
            return selected;
        }
    }
    // The native store replays this second range after the seam. Before the
    // region's first entry, the first range already includes its whole head.
    for (let index = loopFirst; index < Math.min(window.firstAtPosition, loopEnd); index += 1) {
        const group = groups[index];
        if (!group || !admit(group, window.end - window.position + group.frame - window.start)) {
            break;
        }
    }
    return selected;
}

/** Visit only resident entries; all clears precede newly admitted frame groups. */
function clearExcluded(
    slot: LiveMidiWriterTarget,
    held: ReadonlySet<number>,
    retained: ReadonlySet<number>,
    sampleRate: number
): AudioGraphCommand[] {
    const commands: AudioGraphCommand[] = [];
    let fromFrame: number | null = null;
    let lastFrame = 0;
    const flush = () => {
        if (fromFrame !== null) {
            commands.push({
                kind: 'clear-midi',
                target: slot.target,
                fromTime: fromFrame / sampleRate,
                toTime: (lastFrame + 1) / sampleRate,
            });
            fromFrame = null;
        }
    };
    const residents = Array.from(held).sort((left, right) => left - right);
    for (const index of residents) {
        if (retained.has(index)) {
            flush();
            continue;
        }
        const event = slot.events[index];
        if (!event) {
            throw new Error('a resident MIDI entry must belong to its pass programme');
        }
        fromFrame ??= Math.round(event.time * sampleRate);
        lastFrame = Math.round(event.time * sampleRate);
    }
    flush();
    return commands;
}

export function loopMidiWindowBatch(
    pass: LiveMidiWriterPass,
    positionSeconds: number,
    loopWraps: number | null,
    opening = false
): MidiWriterBatch {
    const region = pass.loopRegion;
    if (!region) {
        return { commands: [], admissions: [] };
    }
    const position = Math.round(positionSeconds * pass.sampleRate);
    const start = Math.round(region.startSeconds * pass.sampleRate);
    const end = Math.round(region.endSeconds * pass.sampleRate);
    const wrapped = loopWraps !== pass.lastLoopWraps;
    // A wrap can be missed between polls even when the next position is larger.
    const floor = wrapped ? region.startSeconds : pass.lastClearedBeforeSeconds;
    const trailFloor = Math.max(floor, positionSeconds - MIDI_TRAIL_SECONDS);
    let clearedBefore = positionSeconds;
    const commands: AudioGraphCommand[] = [];
    const admissions: MidiAdmission[] = [];
    for (const slot of pass.targets) {
        const groups = slot.loopFrameGroups;
        if (!groups) {
            throw new Error('a looping MIDI target must be indexed by its arm');
        }
        const firstAtPosition = firstGroupAtFrame(groups, position);
        const ahead = takeAhead(slot, groups, {
            position,
            start,
            end,
            firstAtPosition,
            horizonFrames: MIDI_WINDOW_SECONDS * pass.sampleRate,
        });
        const retained = new Set(ahead);
        for (let groupIndex = firstAtPosition - 1; groupIndex >= 0; groupIndex -= 1) {
            const group = groups[groupIndex];
            if (!group || group.frame < Math.round(trailFloor * pass.sampleRate)) {
                break;
            }
            if (retained.has(group.firstEventIndex)) {
                continue;
            }
            const count = group.endEventIndex - group.firstEventIndex;
            if (retained.size + count > MIDI_NOTE_STORE_CAPACITY) {
                break;
            }
            for (let index = group.firstEventIndex; index < group.endEventIndex; index += 1) {
                retained.add(index);
            }
            clearedBefore = Math.min(clearedBefore, group.frame / pass.sampleRate);
        }
        const held = new Set(opening ? [] : slot.heldEventIndices);
        const heldAfter = new Set(Array.from(held).filter((index) => retained.has(index)));
        const added = Array.from(ahead)
            .filter((index) => !heldAfter.has(index))
            .sort((left, right) => left - right);
        if (opening) {
            commands.push({ kind: 'clear-midi', target: slot.target, fromTime: 0, toTime: null });
        } else {
            commands.push(...clearExcluded(slot, held, retained, pass.sampleRate));
        }
        if (added.length > 0) {
            commands.push({
                kind: 'schedule-midi',
                target: slot.target,
                probabilitySeed: pass.probabilitySeed,
                notes: added.map((index) => slot.events[index]).filter((event) => event !== undefined),
            });
        }
        for (const index of added) {
            heldAfter.add(index);
        }
        admissions.push({
            slot,
            admitted: added.length,
            heldAfter: heldAfter.size,
            heldEventIndicesAfter: [...heldAfter],
        });
    }
    return { commands, admissions, lastClearedBeforeSeconds: Math.max(region.startSeconds, clearedBefore), loopWraps };
}
