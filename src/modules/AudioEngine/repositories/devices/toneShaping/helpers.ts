export // ── Distortion ───────────────────────────────────────────────────────────

function makeDistortionCurve(drive: number): Float32Array<ArrayBuffer> {
    const samples = 44100;
    const curve = new Float32Array(samples);
    const k = Math.max(0.1, drive);
    for (let i = 0; i < samples; i++) {
        const x = (i * 2) / samples - 1;
        curve[i] = Math.tanh(k * x);
    }
    return curve;
}

export // ── Bitcrusher ───────────────────────────────────────────────────────────

function makeBitcrusherCurve(bits: number): Float32Array<ArrayBuffer> {
    const samples = 65536;
    const curve = new Float32Array(samples);
    const steps = 2 ** bits;
    for (let i = 0; i < samples; i++) {
        const x = (i * 2) / samples - 1;
        curve[i] = Math.round(x * steps) / steps;
    }
    return curve;
}