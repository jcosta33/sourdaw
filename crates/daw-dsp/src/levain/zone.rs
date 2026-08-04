//! Zone lookup and sample management.
//!
//! Provides O(1) zone selection at note-on time using a precomputed LUT
//! keyed by (articulation, mic, note, velocity_bucket). Round-robin
//! counters are maintained per (articulation, note) to prevent machine-gun
//! repetition.

use super::types::*;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// Number of velocity buckets for the LUT (128 / 8 = 16 buckets).
const VEL_BUCKETS: usize = 16;
const VEL_BUCKET_SIZE: u8 = 8;

/// Maximum zones in the arena.
const MAX_ZONE_ARENA: usize = 65536;

/// Maximum LUT entries.
const MAX_LUT_ENTRIES: usize = MAX_ARTICULATIONS * (MAX_MICS as usize) * 128 * VEL_BUCKETS;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZoneMapBuildError {
    InvalidDimensions,
    LutSizeOverflow,
    ArenaCapacityExceeded,
    ZoneListCapacityExceeded,
}

// ---------------------------------------------------------------------------
// Zone list arena — flat storage for zone ID lists
// ---------------------------------------------------------------------------

/// A reference into the zone list arena: (start_offset, count).
#[derive(Debug, Clone, Copy, Default)]
pub struct ZoneListRef {
    pub offset: u32,
    pub count: u16,
}

/// Pre-loaded sample data (in-memory for WASM, preload buffer for native).
pub struct SamplePool {
    /// Interleaved f32 PCM data indexed by SampleId.
    /// Each entry: (data_ptr, frame_count, channel_count, sample_rate).
    entries: Vec<SampleEntry>,
    decoded_bytes: usize,
}

pub struct SampleEntry {
    pub data: Vec<f32>,
    pub frame_count: u32,
    pub channels: u8,
    pub sample_rate: f32,
}

impl SamplePool {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            decoded_bytes: 0,
        }
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.decoded_bytes = 0;
    }

    /// Add a sample and return its SampleId.
    pub fn add(
        &mut self,
        data: Vec<f32>,
        frame_count: u32,
        channels: u8,
        sample_rate: f32,
    ) -> Option<SampleId> {
        let id = SampleId::try_from(self.entries.len()).ok()?;
        let sample_bytes = data.capacity().checked_mul(std::mem::size_of::<f32>())?;
        let decoded_bytes = self.decoded_bytes.checked_add(sample_bytes)?;
        self.entries.push(SampleEntry {
            data,
            frame_count,
            channels,
            sample_rate,
        });
        self.decoded_bytes = decoded_bytes;
        Some(id)
    }

    /// Get sample data for reading. Returns None if id is out of range.
    #[inline]
    pub fn get(&self, id: SampleId) -> Option<&SampleEntry> {
        self.entries.get(id as usize)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn decoded_bytes(&self) -> usize {
        self.decoded_bytes
    }
}

// ---------------------------------------------------------------------------
// Zone map — the O(1) lookup structure
// ---------------------------------------------------------------------------

/// The zone map holds all zones and provides O(1) lookup.
pub struct ZoneMap {
    /// All zones in the instrument.
    zones: Vec<Zone>,
    /// Flat arena holding zone IDs referenced by the LUT.
    arena: Vec<ZoneId>,
    /// LUT: flattened [art][mic][note][vel_bucket] -> ZoneListRef
    lut: Vec<ZoneListRef>,
    /// Dimensions for indexing.
    num_articulations: usize,
    num_mics: usize,
    /// Round-robin counters: [articulation * 128 + note] -> current RR index.
    rr_counters: Vec<u8>,
}

impl ZoneMap {
    pub fn new() -> Self {
        Self {
            zones: Vec::new(),
            arena: Vec::new(),
            lut: Vec::new(),
            num_articulations: 0,
            num_mics: 0,
            rr_counters: Vec::new(),
        }
    }

    pub fn clear(&mut self) {
        self.zones.clear();
        self.arena.clear();
        self.lut.clear();
        self.rr_counters.clear();
        self.num_articulations = 0;
        self.num_mics = 0;
    }

    /// Add a zone to the map. Call `build_lut()` after all zones are added.
    pub fn add_zone(&mut self, zone: Zone) {
        self.zones.push(zone);
    }

    /// Build the LUT from all added zones. Must be called before lookups.
    pub fn build_lut(
        &mut self,
        num_articulations: usize,
        num_mics: usize,
    ) -> Result<(), ZoneMapBuildError> {
        if num_articulations > MAX_ARTICULATIONS || num_mics > MAX_MICS {
            return Err(ZoneMapBuildError::InvalidDimensions);
        }

        let lut_size = num_articulations
            .checked_mul(num_mics)
            .and_then(|size| size.checked_mul(128))
            .and_then(|size| size.checked_mul(VEL_BUCKETS))
            .ok_or(ZoneMapBuildError::LutSizeOverflow)?;
        if lut_size > MAX_LUT_ENTRIES {
            return Err(ZoneMapBuildError::InvalidDimensions);
        }
        let rr_counter_count = num_articulations
            .checked_mul(128)
            .ok_or(ZoneMapBuildError::LutSizeOverflow)?;

        let mut lut = vec![ZoneListRef::default(); lut_size];
        let rr_counters = vec![0u8; rr_counter_count];

        // Collect zone IDs per LUT slot.
        let mut buckets: Vec<Vec<ZoneId>> = vec![Vec::new(); lut_size];

        for zone in &self.zones {
            let art = zone.articulation as usize;
            let mic = zone.mic as usize;
            if art >= num_articulations || mic >= num_mics {
                continue;
            }

            for note in zone.key.lo..=zone.key.hi {
                let vel_lo_bucket = (zone.vel.lo / VEL_BUCKET_SIZE) as usize;
                let vel_hi_bucket =
                    (zone.vel.hi / VEL_BUCKET_SIZE).min(VEL_BUCKETS as u8 - 1) as usize;

                for vb in vel_lo_bucket..=vel_hi_bucket {
                    let idx = ((art * num_mics + mic) * 128 + note as usize) * VEL_BUCKETS + vb;
                    if idx < buckets.len() {
                        buckets[idx].push(zone.id);
                    }
                }
            }
        }

        // Flatten buckets into the arena.
        let mut arena = Vec::new();
        for (i, bucket) in buckets.iter().enumerate() {
            if bucket.is_empty() {
                lut[i] = ZoneListRef {
                    offset: 0,
                    count: 0,
                };
            } else {
                let count = u16::try_from(bucket.len())
                    .map_err(|_| ZoneMapBuildError::ZoneListCapacityExceeded)?;
                let next_arena_len = arena
                    .len()
                    .checked_add(bucket.len())
                    .ok_or(ZoneMapBuildError::ArenaCapacityExceeded)?;
                if next_arena_len > MAX_ZONE_ARENA {
                    return Err(ZoneMapBuildError::ArenaCapacityExceeded);
                }
                let offset = u32::try_from(arena.len())
                    .map_err(|_| ZoneMapBuildError::ArenaCapacityExceeded)?;
                arena.extend_from_slice(bucket);
                lut[i] = ZoneListRef { offset, count };
            }
        }

        self.num_articulations = num_articulations;
        self.num_mics = num_mics;
        self.lut = lut;
        self.rr_counters = rr_counters;
        self.arena = arena;
        Ok(())
    }

    /// Look up candidate zones for a note-on event.
    /// Returns the zone IDs that match (articulation, mic, note, velocity).
    #[inline]
    pub fn lookup(
        &self,
        articulation: ArticulationId,
        mic: MicId,
        note: u8,
        velocity: u8,
    ) -> &[ZoneId] {
        let art = articulation as usize;
        let mic_idx = mic as usize;
        let vb = (velocity / VEL_BUCKET_SIZE) as usize;

        if art >= self.num_articulations || mic_idx >= self.num_mics {
            return &[];
        }

        let idx = self.lut_index(art, mic_idx, note as usize, vb);
        if idx >= self.lut.len() {
            return &[];
        }

        let list_ref = self.lut[idx];
        if list_ref.count == 0 {
            return &[];
        }

        let start = list_ref.offset as usize;
        let end = start + list_ref.count as usize;
        if end <= self.arena.len() {
            &self.arena[start..end]
        } else {
            &[]
        }
    }

    /// Select a zone using round-robin for the given articulation and note.
    pub fn select_rr(
        &mut self,
        articulation: ArticulationId,
        note: u8,
        candidates: &[ZoneId],
    ) -> Option<ZoneId> {
        if candidates.is_empty() {
            return None;
        }
        if candidates.len() == 1 {
            return Some(candidates[0]);
        }

        let rr_idx = (articulation as usize) * 128 + note as usize;
        if rr_idx >= self.rr_counters.len() {
            return Some(candidates[0]);
        }

        let rr_pos = self.rr_counters[rr_idx];
        let mut selected = candidates[rr_pos as usize % candidates.len()];

        // Try to find exact rr_pos match among zones.
        for &zone_id in candidates {
            if let Some(zone) = self.zones.get(zone_id as usize) {
                if zone.rr_pos == rr_pos % zone.rr_len.max(1) {
                    selected = zone_id;
                    break;
                }
            }
        }

        self.rr_counters[rr_idx] = rr_pos.wrapping_add(1);
        Some(selected)
    }

    /// Get a zone by ID.
    #[inline]
    pub fn get_zone(&self, id: ZoneId) -> Option<&Zone> {
        self.zones.get(id as usize)
    }

    /// Get total number of zones.
    pub fn zone_count(&self) -> usize {
        self.zones.len()
    }

    #[inline]
    fn lut_index(&self, art: usize, mic: usize, note: usize, vel_bucket: usize) -> usize {
        ((art * self.num_mics + mic) * 128 + note) * VEL_BUCKETS + vel_bucket
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wide_zone(id: ZoneId) -> Zone {
        Zone {
            id,
            key: KeyRange { lo: 0, hi: 127 },
            vel: VelRange { lo: 0, hi: 127 },
            articulation: 0,
            rr_pos: 0,
            rr_len: 1,
            mic: 0,
            is_release: false,
            sample: SampleRef {
                sample_id: id,
                root_key: 60,
                tune_cents: 0,
                start: 0,
                end: 0,
                loop_mode: LoopMode::NoLoop,
                loop_start: 0,
                loop_end: 0,
                loop_crossfade: 0,
            },
            amp_env: AdsrParams::default(),
            gain_db: 0.0,
        }
    }

    #[test]
    fn build_lut_rejects_dimensions_beyond_dsp_limits_without_replacing_the_current_map() {
        let mut map = ZoneMap::new();
        map.add_zone(wide_zone(0));
        map.build_lut(1, 1).expect("valid dimensions should build");
        let expected = map.lookup(0, 0, 60, 100).to_vec();

        assert!(map.build_lut(MAX_ARTICULATIONS + 1, 1).is_err());
        assert_eq!(map.lookup(0, 0, 60, 100), expected);
    }

    #[test]
    fn build_lut_rejects_a_flattened_arena_beyond_its_fixed_capacity() {
        let mut map = ZoneMap::new();
        for id in 0..33 {
            map.add_zone(wide_zone(id));
        }

        assert!(map.build_lut(1, 1).is_err());
        assert!(map.lut.is_empty());
        assert!(map.arena.is_empty());
    }
}
