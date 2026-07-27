type TimedSeed = {
    beat: number;
    duration: number;
};

type SectionBounds = {
    startBeat: number;
    endBeat: number;
};

const DENSE_CLIP_SEGMENT_BEATS = 8;
const MAX_UNSEGMENTED_NOTES = 16;

export function segmentMyceliumDenseSeeds<Seed extends TimedSeed>(seeds: readonly Seed[], section: SectionBounds) {
    const indexedSeeds = seeds.map((seed, index) => ({ index, seed }));
    if (seeds.length <= MAX_UNSEGMENTED_NOTES) {
        return [{ index: 0, startBeat: section.startBeat, endBeat: section.endBeat, seeds: indexedSeeds }];
    }

    const segments: Array<{
        index: number;
        startBeat: number;
        endBeat: number;
        seeds: Array<{ index: number; seed: Seed }>;
    }> = [];
    let segmentStartBeat = section.startBeat;
    while (segmentStartBeat < section.endBeat) {
        let segmentEndBeat = Math.min(segmentStartBeat + DENSE_CLIP_SEGMENT_BEATS, section.endBeat);
        let extendedEndBeat = segmentEndBeat;
        do {
            segmentEndBeat = extendedEndBeat;
            extendedEndBeat = Math.min(
                section.endBeat,
                indexedSeeds.reduce((latestEndBeat, { seed }) => {
                    if (seed.beat < segmentStartBeat || seed.beat >= segmentEndBeat) {
                        return latestEndBeat;
                    }
                    return Math.max(latestEndBeat, seed.beat + seed.duration);
                }, segmentEndBeat)
            );
        } while (extendedEndBeat > segmentEndBeat);

        const segmentSeeds = indexedSeeds.filter(
            ({ seed }) => seed.beat >= segmentStartBeat && seed.beat < segmentEndBeat
        );
        if (segmentSeeds.length > 0) {
            segments.push({
                index: segments.length,
                startBeat: segmentStartBeat,
                endBeat: segmentEndBeat,
                seeds: segmentSeeds,
            });
        }
        segmentStartBeat = segmentEndBeat;
    }
    return segments;
}
