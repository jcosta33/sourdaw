/// Hierarchical waveform mipmap generation.
///
/// Generates a multi-level pyramid of min/max sample pairs for efficient
/// waveform rendering at any zoom level. Each level reduces the previous
/// by a factor of 2 (power-of-2 pyramid).
///
/// Level 0: one min/max pair per `MIPMAP_BASE_BLOCK` samples (default 64).
/// Level 1: one min/max pair per 128 samples.
/// Level N: one min/max pair per (64 × 2^N) samples.
///
/// The UI selects the mipmap level that matches the current zoom, ensuring
/// O(pixels) data regardless of sample length.

use super::super::types::MIPMAP_BASE_BLOCK;

/// A single min/max pair representing the amplitude range of a block.
#[derive(Debug, Clone, Copy)]
pub struct PeakPair {
    pub min: f32,
    pub max: f32,
}

/// Complete mipmap pyramid for one channel of audio.
#[derive(Debug, Clone)]
pub struct WaveformMipmap {
    /// Each entry is one mipmap level, from finest (level 0) to coarsest.
    pub levels: Vec<Vec<PeakPair>>,
    /// Base block size used for level 0.
    pub base_block: usize,
    /// Total number of source frames this mipmap represents.
    pub source_frames: usize,
}

/// Generate a waveform mipmap from a single channel of PCM audio.
///
/// Returns a `WaveformMipmap` containing all levels from base resolution
/// down to a single peak pair representing the entire file.
pub fn generate_mipmap(samples: &[f32]) -> WaveformMipmap {
    if samples.is_empty() {
        return WaveformMipmap {
            levels: vec![],
            base_block: MIPMAP_BASE_BLOCK,
            source_frames: 0,
        };
    }

    // Level 0: reduce source samples to min/max pairs at base block size.
    let level0 = reduce_to_peaks(samples, MIPMAP_BASE_BLOCK);

    let mut levels = vec![level0];

    // Subsequent levels: halve the resolution by combining adjacent pairs.
    loop {
        let prev = levels.last().unwrap();
        if prev.len() <= 1 {
            break;
        }
        let next = reduce_peaks_by_2(prev);
        levels.push(next);
    }

    WaveformMipmap {
        levels,
        base_block: MIPMAP_BASE_BLOCK,
        source_frames: samples.len(),
    }
}

/// Generate mipmaps for stereo audio (returns left and right mipmaps).
pub fn generate_mipmap_stereo(left: &[f32], right: &[f32]) -> (WaveformMipmap, WaveformMipmap) {
    (generate_mipmap(left), generate_mipmap(right))
}

/// Serialize a mipmap level to a flat `Vec<f32>` for binary IPC transfer.
///
/// Format: `[min0, max0, min1, max1, ...]`
pub fn flatten_level(level: &[PeakPair]) -> Vec<f32> {
    let mut out = Vec::with_capacity(level.len() * 2);
    for pair in level {
        out.push(pair.min);
        out.push(pair.max);
    }
    out
}

/// Select the best mipmap level for a given display width and visible sample range.
///
/// Returns the level index (0 = finest, higher = coarser).
pub fn select_level(mipmap: &WaveformMipmap, visible_frames: usize, display_width_px: usize) -> usize {
    if mipmap.levels.is_empty() || display_width_px == 0 {
        return 0;
    }

    // We want approximately 1–2 peak pairs per pixel for smooth rendering.
    let desired_pairs = display_width_px * 2;
    let frames_per_pair_needed = visible_frames / desired_pairs.max(1);

    // Find the coarsest level whose resolution is still finer than needed.
    for (level_idx, level) in mipmap.levels.iter().enumerate() {
        if level.is_empty() {
            continue;
        }
        let frames_per_pair = mipmap.base_block << level_idx;
        if frames_per_pair >= frames_per_pair_needed {
            return level_idx;
        }
    }

    // Fallback: coarsest level.
    mipmap.levels.len().saturating_sub(1)
}

// ── Internal Helpers ───────────────────────────────────────────────────

/// Reduce raw samples to min/max peak pairs at the given block size.
fn reduce_to_peaks(samples: &[f32], block_size: usize) -> Vec<PeakPair> {
    let num_blocks = (samples.len() + block_size - 1) / block_size;
    let mut peaks = Vec::with_capacity(num_blocks);

    for chunk in samples.chunks(block_size) {
        let mut min = f32::MAX;
        let mut max = f32::MIN;
        for &sample in chunk {
            if sample < min {
                min = sample;
            }
            if sample > max {
                max = sample;
            }
        }
        peaks.push(PeakPair { min, max });
    }

    peaks
}

/// Reduce a peak level by combining adjacent pairs (2:1 decimation).
fn reduce_peaks_by_2(peaks: &[PeakPair]) -> Vec<PeakPair> {
    let num_out = (peaks.len() + 1) / 2;
    let mut out = Vec::with_capacity(num_out);

    for pair in peaks.chunks(2) {
        if pair.len() == 2 {
            out.push(PeakPair {
                min: pair[0].min.min(pair[1].min),
                max: pair[0].max.max(pair[1].max),
            });
        } else {
            out.push(pair[0]);
        }
    }

    out
}
