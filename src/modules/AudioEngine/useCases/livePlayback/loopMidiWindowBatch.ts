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

/** Projection resolves same-key overlaps before emitting this ordered programme. */
export function indexLoopMidiNotePartners(events: readonly AudioGraphMidiNoteEvent[]): readonly (number | undefined)[] {
    const partners: (number | undefined)[] = Array.from({ length: events.length }, () => undefined);
    const open = new Map<number, number>();
    for (const [index, event] of events.entries()) {
        const key = event.channel * 128 + event.note;
        if (event.isNoteOn) {
            open.set(key, index);
            continue;
        }
        const onset = open.get(key);
        if (onset !== undefined) {
            partners[onset] = index;
            partners[index] = onset;
            open.delete(key);
        }
    }
    return partners;
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
    window: AheadWindow,
    releases: ReadonlySet<number>
): Set<number> {
    const selected = new Set(releases);
    const loopFirst = firstGroupAtFrame(groups, window.start);
    const loopEnd = firstGroupAtFrame(groups, window.end);
    function admit(group: LiveMidiFrameGroup, distance: number): boolean {
        if (distance >= window.horizonFrames || selected.size - releases.size >= MIDI_NOTE_STORE_CAPACITY / 2) {
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
        const additions = groupWithReleases(slot, group, selected);
        if (selected.size + additions.length > MIDI_NOTE_STORE_CAPACITY) {
            return false;
        }
        for (const index of additions) {
            selected.add(index);
        }
        return true;
    }
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

/** Distant real offs reserve entries without admitting their future-frame neighbours. */
function groupWithReleases(
    slot: LiveMidiWriterTarget,
    group: LiveMidiFrameGroup,
    retained: ReadonlySet<number>
): number[] {
    const additions = new Set<number>();
    for (let index = group.firstEventIndex; index < group.endEventIndex; index += 1) {
        if (!retained.has(index)) {
            additions.add(index);
        }
        const event = slot.events[index];
        const partner = slot.loopNotePartners?.[index];
        if (event?.isNoteOn && partner !== undefined && !retained.has(partner)) {
            additions.add(partner);
        }
    }
    return [...additions];
}

/** Visit only resident entries; all clears precede newly admitted frame groups. */
function clearExcluded(
    slot: LiveMidiWriterTarget,
    held: ReadonlySet<number>,
    retained: ReadonlySet<number>,
    sampleRate: number
): { commands: AudioGraphCommand[]; removed: Set<number> } {
    const commands: AudioGraphCommand[] = [];
    const removed = new Set<number>();
    let fromFrame: number | null = null;
    let lastFrame = 0;
    function flush(): void {
        if (fromFrame !== null) {
            commands.push({
                kind: 'clear-midi',
                target: slot.target,
                fromTime: fromFrame / sampleRate,
                toTime: (lastFrame + 1) / sampleRate,
            });
            fromFrame = null;
        }
    }
    const residents = Array.from(held).sort((left, right) => left - right);
    function frameOf(index: number | undefined): number {
        const event = index === undefined ? undefined : slot.events[index];
        if (!event) {
            throw new Error('a resident MIDI entry must belong to its pass programme');
        }
        return Math.round(event.time * sampleRate);
    }
    for (let first = 0; first < residents.length;) {
        const frame = frameOf(residents[first]);
        let end = first + 1;
        while (end < residents.length && frameOf(residents[end]) === frame) {
            end += 1;
        }
        const members = residents.slice(first, end);
        if (members.every((member) => retained.has(member))) {
            flush();
        } else {
            // Clear addresses frames, so a reserved off sharing one with an
            // excluded resident must be rewritten in this same batch too.
            fromFrame ??= frame;
            lastFrame = frame;
            for (const member of members) {
                removed.add(member);
            }
        }
        first = end;
    }
    flush();
    return { commands, removed };
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
        const held = new Set(opening ? [] : slot.heldEventIndices);
        const releases = new Set(opening ? slot.loopOpeningNoteOffIndices : []);
        for (const index of held) {
            const event = slot.events[index];
            const partner = slot.loopNotePartners?.[index];
            const onset = partner === undefined ? undefined : slot.events[partner];
            if (
                event &&
                !event.isNoteOn &&
                onset &&
                Math.round(onset.time * pass.sampleRate) < position &&
                Math.round(event.time * pass.sampleRate) >= position
            ) {
                releases.add(index);
            }
        }
        const ahead = takeAhead(
            slot,
            groups,
            { position, start, end, firstAtPosition, horizonFrames: MIDI_WINDOW_SECONDS * pass.sampleRate },
            releases
        );
        const retained = new Set(ahead);
        for (let groupIndex = firstAtPosition - 1; groupIndex >= 0; groupIndex -= 1) {
            const group = groups[groupIndex];
            if (!group || group.frame < Math.round(trailFloor * pass.sampleRate)) {
                break;
            }
            if (retained.has(group.firstEventIndex)) {
                continue;
            }
            const additions = groupWithReleases(slot, group, retained);
            if (retained.size + additions.length > MIDI_NOTE_STORE_CAPACITY) {
                break;
            }
            for (const index of additions) {
                retained.add(index);
            }
            clearedBefore = Math.min(clearedBefore, group.frame / pass.sampleRate);
        }
        const cleared = clearExcluded(slot, held, retained, pass.sampleRate);
        const heldAfter = new Set(
            Array.from(held).filter((index) => retained.has(index) && !cleared.removed.has(index))
        );
        const wanted = new Set(ahead);
        for (const index of cleared.removed) {
            if (retained.has(index)) {
                wanted.add(index);
            }
        }
        const added = Array.from(wanted)
            .filter((index) => !heldAfter.has(index))
            .sort((left, right) => left - right);
        if (opening) {
            commands.push({ kind: 'clear-midi', target: slot.target, fromTime: 0, toTime: null });
        } else {
            commands.push(...cleared.commands);
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
