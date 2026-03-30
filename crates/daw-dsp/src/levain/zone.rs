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
const MAX_LUT_ENTRIES: usize =
    MAX_ARTICULATIONS * (MAX_MICS as usize) * 128 * VEL_BUCKETS;

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
        }
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    /// Add a sample and return its SampleId.
    pub fn add(&mut self, data: Vec<f32>, frame_count: u32, channels: u8, sample_rate: f32) -> SampleId {
        let id = self.entries.len() as SampleId;
        self.entries.push(SampleEntry {
            data,
            frame_count,
            channels,
            sample_rate,
        });
        id
    }

    /// Get sample data for reading. Returns None if id is out of range.
    #[inline]
    pub fn get(&self, id: SampleId) -> Option<&SampleEntry> {
        self.entries.get(id as usize)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
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
    pub fn build_lut(&mut self, num_articulations: usize, num_mics: usize) {
        self.num_articulations = num_articulations;
        self.num_mics = num_mics;

        let lut_size = num_articulations * num_mics * 128 * VEL_BUCKETS;
        self.lut = vec![ZoneListRef::default(); lut_size];
        self.rr_counters = vec![0u8; num_articulations * 128];

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
                let vel_hi_bucket = (zone.vel.hi / VEL_BUCKET_SIZE).min(VEL_BUCKETS as u8 - 1) as usize;

                for vb in vel_lo_bucket..=vel_hi_bucket {
                    let idx = self.lut_index(art, mic, note as usize, vb);
                    if idx < buckets.len() {
                        buckets[idx].push(zone.id);
                    }
                }
            }
        }

        // Flatten buckets into the arena.
        self.arena.clear();
        for (i, bucket) in buckets.iter().enumerate() {
            if bucket.is_empty() {
                self.lut[i] = ZoneListRef { offset: 0, count: 0 };
            } else {
                let offset = self.arena.len() as u32;
                self.arena.extend_from_slice(bucket);
                self.lut[i] = ZoneListRef {
                    offset,
                    count: bucket.len() as u16,
                };
            }
        }
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
    pub fn select_rr(&mut self, articulation: ArticulationId, note: u8, candidates: &[ZoneId]) -> Option<ZoneId> {
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
