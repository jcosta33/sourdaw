/**
 * The WebGPU features a model needs, named by the MLC quantization code in its id: every `q<N>f16_*` quantization (q4f16, q3f16) keeps
 * activations in float16 and compiles to shaders that need `shader-f16`, `q4f32_*` does not. The id
 * carries it because the release manifest's artifact set is digested and records no such field.
 */
export function getWebLlmRequiredFeatures(modelId: string): readonly string[] {
    return /-q\d+f16_\d+(?:-|$)/.test(modelId) ? ['shader-f16'] : [];
}
