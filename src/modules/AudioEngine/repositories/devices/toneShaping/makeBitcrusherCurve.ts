export function makeBitcrusherCurve(bits: number): Float32Array<ArrayBuffer> {
    const samples = 65536;
    const curve = new Float32Array(samples);
    const steps = 2 ** bits;
    for (let index = 0; index < samples; index++) {
        const x = (index * 2) / samples - 1;
        curve[index] = Math.round(x * steps) / steps;
    }
    return curve;
}
