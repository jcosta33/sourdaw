import { SCALE_PATTERNS } from '#/utils/Music/MusicalScale';

type StepRecordPitchDirection = 'up' | 'down';

type GetNextStepRecordPitchInput = {
    currentPitch: number;
    direction: StepRecordPitchDirection;
    keyRoot: number;
    scaleName: string;
};

export function getNextStepRecordPitch({
    currentPitch,
    direction,
    keyRoot,
    scaleName,
}: GetNextStepRecordPitchInput): number {
    const chromaticPattern = SCALE_PATTERNS.chromatic;
    if (!chromaticPattern) {
        if (direction === 'up') {
            return currentPitch + 1;
        }

        return currentPitch - 1;
    }

    const pattern = SCALE_PATTERNS[scaleName] ?? chromaticPattern;
    const root = keyRoot;

    if (pattern.length > 0 && pattern.length < 12) {
        const currentPc = (((currentPitch - root) % 12) + 12) % 12;
        let degree = pattern.indexOf(currentPc);

        if (direction === 'up') {
            if (degree === -1) {
                degree = pattern.findIndex((param) => param > currentPc);
                if (degree === -1) {
                    degree = 0;
                }
            }

            const nextDegree = (degree + 1) % pattern.length;
            const nextPitchClass = pattern[nextDegree];
            if (nextPitchClass === undefined) {
                return currentPitch;
            }

            const octShift = nextDegree === 0 ? 12 : 0;
            return currentPitch - currentPc + nextPitchClass + octShift;
        }

        if (degree === -1) {
            degree = pattern.findIndex((param) => param > currentPc);
            if (degree === -1) {
                degree = pattern.length - 1;
            } else {
                degree = Math.max(0, degree - 1);
            }
        }

        const nextDegree = (degree - 1 + pattern.length) % pattern.length;
        const nextPitchClass = pattern[nextDegree];
        if (nextPitchClass === undefined) {
            return currentPitch;
        }

        const octShift = nextDegree === pattern.length - 1 ? -12 : 0;
        return currentPitch - currentPc + nextPitchClass + octShift;
    }

    if (direction === 'up') {
        return currentPitch + 1;
    }

    return currentPitch - 1;
}
