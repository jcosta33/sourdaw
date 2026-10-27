// Literal input PCM and clock equations. These do not import an edit or playback projector.
const RATE = 48_000;

function pcm16Wav(frames: number, at: (frame: number) => number): Buffer {
    const wav = Buffer.alloc(44 + frames * 2);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(RATE, 24);
    wav.writeUInt32LE(RATE * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(frames * 2, 40);
    for (let frame = 0; frame < frames; frame += 1) {
        wav.writeInt16LE(at(frame), 44 + frame * 2);
    }
    return wav;
}

function slipSample(frame: number): number {
    if (frame < 16_800) {
        return 4_096;
    }
    if (frame < 26_400) {
        return 8_192;
    }
    if (frame < 43_200) {
        return 16_384;
    }
    if (frame < 57_600) {
        return 24_576;
    }
    if (frame < 120_000) {
        return 12_288;
    }
    if (frame < 124_800) {
        return 24_576;
    }
    return 4_096;
}

function stretchedTrimSample(frame: number): number {
    if (frame < 24_000) {
        return 4_096;
    }
    if (frame < 60_000) {
        return 8_192;
    }
    if (frame < 72_000) {
        return 12_288;
    }
    if (frame < 96_000) {
        return 16_384;
    }
    if (frame < 168_000) {
        return 24_576;
    }
    return -24_576;
}

export const physicalSourceFixture = {
    slip: () => pcm16Wav(4 * RATE, slipSample),
    slipSample,
    // The finder returns the LEFT sample of each sign pair, not the sample after it.
    crossings: () =>
        pcm16Wav(4 * RATE, (frame) => {
            if (frame <= 42_002) {
                return 12_288;
            }
            if (frame <= 108_002) {
                return -12_288;
            }
            return 12_288;
        }),
    islands: () =>
        pcm16Wav(4 * RATE, (frame) => {
            if (frame >= 36_000 && frame < 40_800) {
                return 8_192;
            }
            if (frame >= 72_000 && frame < 76_800) {
                return 16_384;
            }
            if (frame >= 108_000 && frame < 112_800) {
                return 24_576;
            }
            return 0;
        }),
    stretchedTrim: () => pcm16Wav(4 * RATE, stretchedTrimSample),
    stretchedTrimSample,
};

/** 120 until beat1,240 until beat2,120 thereafter. */
export function interiorTempoSeconds(beat: number): number {
    if (beat <= 1) {
        return beat / 2;
    }
    if (beat <= 2) {
        return 0.5 + (beat - 1) / 4;
    }
    return 0.75 + (beat - 2) / 2;
}
