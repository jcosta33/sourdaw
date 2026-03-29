//! Euclidean rhythm generator — distributes k hits across n steps as evenly as possible.
//! Implements the Bjorklund algorithm (Toussaint 2005).

/// Generate a Euclidean rhythm pattern.
/// Returns a Vec<bool> of length `steps` with `hits` trues distributed as evenly as possible.
/// `rotation` shifts the pattern cyclically.
pub fn euclidean(hits: usize, steps: usize, rotation: usize) -> Vec<bool> {
    if steps == 0 { return vec![]; }
    if hits == 0 { return vec![false; steps]; }
    if hits >= steps { return vec![true; steps]; }

    let mut pattern = Vec::with_capacity(steps);

    // Start with two groups: hits x [true] and (steps-hits) x [false]
    let mut groups: Vec<Vec<bool>> = Vec::new();
    for _ in 0..hits { groups.push(vec![true]); }
    for _ in 0..(steps - hits) { groups.push(vec![false]); }

    // Iteratively distribute remainder group onto the larger group
    loop {
        // Find where the two different patterns meet
        let first = &groups[0].clone();
        let split_pos = groups.iter().position(|g| g != first);

        match split_pos {
            None => break, // all groups are identical
            Some(pos) => {
                if pos == 0 || groups.len() - pos <= 1 { break; }

                let remainder_count = groups.len() - pos;
                let take_count = remainder_count.min(pos);

                // Append remainder groups onto the end of leading groups
                let mut new_groups = Vec::new();
                for i in 0..pos {
                    let mut combined = groups[i].clone();
                    if i < take_count {
                        combined.extend_from_slice(&groups[pos + i]);
                    }
                    new_groups.push(combined);
                }
                // Any leftover remainder groups
                for i in (pos + take_count)..groups.len() {
                    new_groups.push(groups[i].clone());
                }

                groups = new_groups;
                if groups.len() <= 1 { break; }
            }
        }
    }

    // Flatten groups into pattern
    for group in &groups {
        pattern.extend_from_slice(group);
    }
    pattern.truncate(steps);

    // Rotation
    if rotation > 0 && steps > 0 {
        let rot = rotation % steps;
        let mut rotated = Vec::with_capacity(steps);
        rotated.extend_from_slice(&pattern[rot..]);
        rotated.extend_from_slice(&pattern[..rot]);
        rotated
    } else {
        pattern
    }
}
