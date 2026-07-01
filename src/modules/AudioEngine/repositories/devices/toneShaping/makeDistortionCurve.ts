export function makeDistortionCurve(drive: number): Float32Array<ArrayBuffer> {
    const samples = 44100;
    const curve = new Float32Array(samples);
    const kIndex = Math.max(0.1, drive);
    for (let index = 0; index < samples; index++) {
        const x = (index * 2) / samples - 1;
        curve[index] = Math.tanh(kIndex * x);
    }
    return curve;
}
