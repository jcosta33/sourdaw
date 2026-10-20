/**
 * A persistent native note store holds a circular window, not a whole loop.
 * Reserve half its entries for upcoming events, then keep as much spent trail
 * as fits. Dense loops therefore shorten the time window instead of losing
 * their tail. The clock must be sampled before that admitted horizon runs out;
 * this control-side writer cannot recover frames the engine already rendered.
 */
import { logger } from '#/infra/logger/appLogger';

import { type AudioGraphCommand } from '../../models/AudioGraphBackend';

import {
    MIDI_NOTE_STORE_CAPACITY,
    MIDI_TRAIL_SECONDS,
    MIDI_WINDOW_SECONDS,
    type LiveMidiWriterPass,
    type LiveMidiWriterTarget,
    type MidiAdmission,
    type MidiWriterBatch,
} from './nativeLiveMidiWriterState';

type EventGroup = Readonly<{ frame: number; indices: readonly number[]; distance: number }>;

/** Never split a native frame: clear and admission both address whole frames. */
function frameGroups(slot: LiveMidiWriterTarget, sampleRate: number): EventGroup[] {
    const groups: { frame: number; indices: number[]; distance: number }[] = [];
    for (const [index, event] of slot.events.entries()) {
        const frame = Math.round(event.time * sampleRate);
        const previous = groups.at(-1);
        if (previous?.frame === frame) {
            previous.indices.push(index);
        } else {
            groups.push({ frame, indices: [index], distance: 0 });
        }
    }
    return groups;
}

function upcomingGroups(groups: readonly EventGroup[], position: number, start: number, end: number): EventGroup[] {
    const inRegion = groups.filter((group) => group.frame < end && (group.frame >= position || group.frame >= start));
    const timed = inRegion.map((group) => ({
        ...group,
        distance: group.frame >= position ? group.frame - position : end - position + group.frame - start,
    }));
    return timed.sort((left, right) => left.distance - right.distance);
}

function takeAhead(slot: LiveMidiWriterTarget, groups: readonly EventGroup[], horizonFrames: number): Set<number> {
    const selected = new Set<number>();
    for (const group of groups) {
        if (group.distance >= horizonFrames || selected.size >= MIDI_NOTE_STORE_CAPACITY / 2) {
            break;
        }
        if (group.indices.length > MIDI_NOTE_STORE_CAPACITY) {
            if (!slot.saturationReported) {
                slot.saturationReported = true;
                logger.warn(
                    `[AudioEngine] plugin "${slot.deviceName}" on "${slot.trackName}" cannot schedule ` +
                        `${group.indices.length} MIDI entries at the same frame; the engine store holds ${MIDI_NOTE_STORE_CAPACITY}`
                );
            }
            break;
        }
        if (selected.size + group.indices.length > MIDI_NOTE_STORE_CAPACITY) {
            break;
        }
        for (const index of group.indices) {
            selected.add(index);
        }
    }
    return selected;
}

/** Clear contiguous excluded frame groups, preserving every retained event. */
function clearExcluded(
    slot: LiveMidiWriterTarget,
    groups: readonly EventGroup[],
    retained: ReadonlySet<number>,
    sampleRate: number
): AudioGraphCommand[] {
    const held = new Set(slot.heldEventIndices ?? []);
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
    for (const group of groups) {
        if (group.indices.some((index) => retained.has(index))) {
            flush();
        } else if (group.indices.some((index) => held.has(index))) {
            fromFrame ??= group.frame;
            lastFrame = group.frame;
        }
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
        const groups = frameGroups(slot, pass.sampleRate);
        const ahead = takeAhead(
            slot,
            upcomingGroups(groups, position, start, end),
            MIDI_WINDOW_SECONDS * pass.sampleRate
        );
        const retained = new Set(ahead);
        for (const group of groups.toReversed()) {
            if (group.frame >= position || group.frame < Math.round(trailFloor * pass.sampleRate)) {
                continue;
            }
            if (group.indices.every((index) => retained.has(index))) {
                continue;
            }
            if (retained.size + group.indices.length > MIDI_NOTE_STORE_CAPACITY) {
                break;
            }
            for (const index of group.indices) {
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
            commands.push(...clearExcluded(slot, groups, retained, pass.sampleRate));
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
