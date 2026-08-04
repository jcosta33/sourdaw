import { type TrackStoreState } from '#/modules/Arrangement/stores';

type ScheduledTrackClip = TrackStoreState['tracks'][number]['clips'][number];

type MidiClipIntervalNode = {
    clip: ScheduledTrackClip;
    left: MidiClipIntervalNode | null;
    maxEndBeat: number;
    right: MidiClipIntervalNode | null;
};

type ScheduledMidiClipIndex = {
    orderByClip: ReadonlyMap<ScheduledTrackClip, number>;
    root: MidiClipIntervalNode | null;
};

type SelectMidiClipsForSchedulerWindowInput = {
    clips: readonly ScheduledTrackClip[];
    fromBeat: number;
    toBeat: number;
};

const scheduledMidiClipIndexes = new WeakMap<readonly ScheduledTrackClip[], ScheduledMidiClipIndex>();

function buildMidiClipIntervalTree(
    sortedClips: readonly ScheduledTrackClip[],
    startIndex: number,
    endIndex: number
): MidiClipIntervalNode | null {
    if (startIndex >= endIndex) {
        return null;
    }
    const middleIndex = startIndex + Math.floor((endIndex - startIndex) / 2);
    const clip = sortedClips[middleIndex]!;
    const left = buildMidiClipIntervalTree(sortedClips, startIndex, middleIndex);
    const right = buildMidiClipIntervalTree(sortedClips, middleIndex + 1, endIndex);
    return {
        clip,
        left,
        maxEndBeat: Math.max(
            clip.endBeat,
            left?.maxEndBeat ?? Number.NEGATIVE_INFINITY,
            right?.maxEndBeat ?? Number.NEGATIVE_INFINITY
        ),
        right,
    };
}

function getScheduledMidiClipIndex(clips: readonly ScheduledTrackClip[]): ScheduledMidiClipIndex {
    const cached = scheduledMidiClipIndexes.get(clips);
    if (cached) {
        return cached;
    }

    const orderByClip = new Map(clips.map((clip, index) => [clip, index]));
    const sortedMidiClips = clips
        .filter((clip) => !clip.muted && clip.type === 'midi')
        .sort((left, right) => left.startBeat - right.startBeat || orderByClip.get(left)! - orderByClip.get(right)!);
    const created = {
        orderByClip,
        root: buildMidiClipIntervalTree(sortedMidiClips, 0, sortedMidiClips.length),
    };
    scheduledMidiClipIndexes.set(clips, created);
    return created;
}

function collectActiveMidiClips(
    node: MidiClipIntervalNode | null,
    fromBeat: number,
    toBeat: number,
    activeClips: ScheduledTrackClip[]
): void {
    if (!node || node.maxEndBeat <= fromBeat) {
        return;
    }
    collectActiveMidiClips(node.left, fromBeat, toBeat, activeClips);
    if (node.clip.startBeat < toBeat && node.clip.endBeat > fromBeat) {
        activeClips.push(node.clip);
    }
    if (node.clip.startBeat < toBeat) {
        collectActiveMidiClips(node.right, fromBeat, toBeat, activeClips);
    }
}

export function selectMidiClipsForSchedulerWindow({
    clips,
    fromBeat,
    toBeat,
}: SelectMidiClipsForSchedulerWindowInput): ScheduledTrackClip[] {
    const { orderByClip, root } = getScheduledMidiClipIndex(clips);
    const activeClips: ScheduledTrackClip[] = [];
    collectActiveMidiClips(root, fromBeat, toBeat, activeClips);
    activeClips.sort((left, right) => orderByClip.get(left)! - orderByClip.get(right)!);
    return activeClips;
}
