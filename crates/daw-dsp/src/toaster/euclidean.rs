//! Euclidean rhythm generator — distributes k hits across n steps as evenly as possible.
//! Implements the Bjorklund algorithm (Toussaint 2005).

/// Generate a Euclidean rhythm pattern.
/// Returns a Vec<bool> of length `steps` with `hits` trues distributed as evenly as possible.
/// `rotation` shifts the pattern cyclically.
pub fn euclidean(hits: usize, steps: usize, rotation: usize, out: &mut [bool]) {
    let steps = steps.min(out.len());
    if steps == 0 { return; }
    out[..steps].fill(false);
    if hits == 0 { return; }

    for i in 0..steps {
        // Shift phase to match the standard Bjorklund starting alignment
        let phase = (i + steps - (rotation % steps)) % steps;
        // The Bresenham algorithm generates exact Euclidean rhythms without allocations
        out[phase] = (i * hits) % steps < hits;
    }
}
