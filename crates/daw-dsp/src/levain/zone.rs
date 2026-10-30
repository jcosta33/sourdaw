//! Zone lookup and sample management.
//!
//! Provides O(1) zone selection at note-on time using a precomputed LUT
//! keyed by (articulation, mic, note, velocity_bucket). Round-robin
//! counters are maintained per (articulation, note) to prevent machine-gun
//! repetition.

use super::types::*;
use super::LEVAIN_ZONE_TABLE_CHUNK_ENTRIES;

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
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ZoneListRef {
    pub offset: u32,
    pub count: u16,
}

// ---------------------------------------------------------------------------
// Zone tables — the LUT and the arena it indexes, computed from the zones
// ---------------------------------------------------------------------------

/// The part of a zone the lookup tables index: which zone it is and the
/// (articulation, mic, key, velocity) region it covers.
#[derive(Debug, Clone, Copy)]
pub struct ZoneSpan {
    pub id: ZoneId,
    pub articulation: ArticulationId,
    pub mic: MicId,
    pub key: KeyRange,
    pub vel: VelRange,
}

impl From<&Zone> for ZoneSpan {
    fn from(zone: &Zone) -> Self {
        Self {
            id: zone.id,
            articulation: zone.articulation,
            mic: zone.mic,
            key: zone.key,
            vel: zone.vel,
        }
    }
}

/// The lookup tables for one set of zones and dimensions: one `ZoneListRef`
/// per (articulation, mic, note, velocity bucket) slot, and the arena of zone
/// ids those refs point into.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZoneTables {
    pub lut: Vec<ZoneListRef>,
    pub arena: Vec<ZoneId>,
}

/// LUT slots and round-robin counters the dimensions call for, or the error
/// `build_lut` gives for dimensions past the DSP limits.
pub fn zone_table_sizes(
    num_articulations: usize,
    num_mics: usize,
) -> Result<(usize, usize), ZoneMapBuildError> {
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
    Ok((lut_size, rr_counter_count))
}

/// Compute the lookup tables for `zones`. The one table algorithm: the
/// engine's own `ZoneMap::build_lut` and the off-thread builder the browser
/// host runs both call it. Allocates freely, so it never runs on a render
/// thread in the browser.
pub fn build_zone_tables(
    zones: impl IntoIterator<Item = ZoneSpan>,
    num_articulations: usize,
    num_mics: usize,
) -> Result<ZoneTables, ZoneMapBuildError> {
    let (lut_size, _) = zone_table_sizes(num_articulations, num_mics)?;
    let mut lut = vec![ZoneListRef::default(); lut_size];

    // Collect zone IDs per LUT slot.
    let mut buckets: Vec<Vec<ZoneId>> = vec![Vec::new(); lut_size];

    for zone in zones {
        let art = zone.articulation as usize;
        let mic = zone.mic as usize;
        if art >= num_articulations || mic >= num_mics {
            continue;
        }

        for note in zone.key.lo..=zone.key.hi {
            let vel_lo_bucket = (zone.vel.lo / VEL_BUCKET_SIZE) as usize;
            let vel_hi_bucket = (zone.vel.hi / VEL_BUCKET_SIZE).min(VEL_BUCKETS as u8 - 1) as usize;

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
            let offset =
                u32::try_from(arena.len()).map_err(|_| ZoneMapBuildError::ArenaCapacityExceeded)?;
            arena.extend_from_slice(bucket);
            lut[i] = ZoneListRef { offset, count };
        }
    }

    Ok(ZoneTables { lut, arena })
}

/// Zone tables arriving in bounded chunks for a staged bank, into storage
/// reserved once.
///
/// `reserve` is the only allocation: the LUT, the arena and the round-robin
/// counters, at the sizes the host declares and the dimensions imply. Each
/// chunk then appends at most `LEVAIN_ZONE_TABLE_CHUNK_ENTRIES` entries,
/// contiguous and in order, after checking every one of them, and allocates
/// nothing; `install_into` swaps the complete tables into a zone map in O(1).
/// So the render thread copies tables an off-thread builder computed, a bounded
/// chunk per host message, and never computes them itself.
///
/// What a chunk checks is what keeps `ZoneMap::lookup` sound with tables it
/// did not build: a LUT ref never reaches past the declared arena, and an arena
/// entry never names a zone the bank does not hold. A refused chunk appends
/// nothing.
pub struct ZoneTableStaging {
    num_articulations: usize,
    num_mics: usize,
    lut: Vec<ZoneListRef>,
    lut_entries: usize,
    arena: Vec<ZoneId>,
    arena_entries: usize,
    rr_counters: Vec<u8>,
    /// Set once the tables went into a zone map. The vectors left here are
    /// that map's previous ones, which take no further chunk.
    installed: bool,
}

impl ZoneTableStaging {
    /// Reserve storage for tables of `lut_entries` LUT slots and
    /// `arena_entries` arena entries. `None`, with nothing reserved, when the
    /// dimensions pass the limits `build_lut` enforces, `lut_entries` is not
    /// the size they imply, the arena would pass its capacity, or the storage
    /// cannot be had.
    pub fn reserve(
        num_articulations: usize,
        num_mics: usize,
        lut_entries: usize,
        arena_entries: usize,
    ) -> Option<Self> {
        let (lut_size, rr_counter_count) = zone_table_sizes(num_articulations, num_mics).ok()?;
        if lut_entries != lut_size || arena_entries > MAX_ZONE_ARENA {
            return None;
        }
        let mut lut = Vec::new();
        lut.try_reserve_exact(lut_entries).ok()?;
        let mut arena = Vec::new();
        arena.try_reserve_exact(arena_entries).ok()?;
        let mut rr_counters = Vec::new();
        rr_counters.try_reserve_exact(rr_counter_count).ok()?;
        rr_counters.resize(rr_counter_count, 0);
        Some(Self {
            num_articulations,
            num_mics,
            lut,
            lut_entries,
            arena,
            arena_entries,
            rr_counters,
            installed: false,
        })
    }

    /// Append LUT entries starting at slot `start`, given as interleaved
    /// `(offset, count)` words. Refuses (false), appending nothing, once the
    /// tables are installed, when `start` is not the next slot, the chunk is
    /// empty, odd, longer than one chunk or past the declared LUT, or any
    /// entry's count does not fit a `u16` or its run reaches past the declared
    /// arena.
    pub fn write_lut_chunk(&mut self, start: usize, words: &[u32]) -> bool {
        if self.installed || start != self.lut.len() || words.is_empty() || words.len() % 2 != 0 {
            return false;
        }
        let entries = words.len() / 2;
        if entries > LEVAIN_ZONE_TABLE_CHUNK_ENTRIES || entries > self.lut_entries - self.lut.len()
        {
            return false;
        }
        let arena_entries = self.arena_entries;
        let fits = |pair: &[u32]| {
            let (offset, count) = (pair[0] as usize, pair[1] as usize);
            count <= usize::from(u16::MAX) && offset.saturating_add(count) <= arena_entries
        };
        if !words.chunks_exact(2).all(fits) {
            return false;
        }
        self.lut
            .extend(words.chunks_exact(2).map(|pair| ZoneListRef {
                offset: pair[0],
                count: pair[1] as u16,
            }));
        true
    }

    /// Append arena entries starting at `start`. Refuses (false), appending
    /// nothing, once the tables are installed, when `start` is not the next
    /// entry, the chunk is empty, longer than one chunk or past the declared
    /// arena, or any id is not below `zone_count`.
    pub fn write_arena_chunk(&mut self, start: usize, ids: &[ZoneId], zone_count: usize) -> bool {
        if self.installed || start != self.arena.len() || ids.is_empty() {
            return false;
        }
        if ids.len() > LEVAIN_ZONE_TABLE_CHUNK_ENTRIES
            || ids.len() > self.arena_entries - self.arena.len()
        {
            return false;
        }
        if !ids.iter().all(|&id| (id as usize) < zone_count) {
            return false;
        }
        self.arena.extend_from_slice(ids);
        true
    }

    /// Whether every declared LUT and arena entry has been written and the
    /// tables are not yet installed.
    pub fn is_complete(&self) -> bool {
        !self.installed
            && self.lut.len() == self.lut_entries
            && self.arena.len() == self.arena_entries
    }

    pub fn num_articulations(&self) -> usize {
        self.num_articulations
    }

    pub fn num_mics(&self) -> usize {
        self.num_mics
    }

    /// Swap the complete tables into `zone_map`, keeping the map's previous
    /// ones here so their storage is freed wherever this staging is. O(1);
    /// allocates and frees nothing. Refuses (false), changing nothing, until
    /// every entry is written, and once installed.
    pub fn install_into(&mut self, zone_map: &mut ZoneMap) -> bool {
        if !self.is_complete() {
            return false;
        }
        zone_map.swap_tables(
            self.num_articulations,
            self.num_mics,
            &mut self.lut,
            &mut self.arena,
            &mut self.rr_counters,
        );
        self.installed = true;
        true
    }
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

    /// Free up to `max_entries` entries, newest first, and return how many remain.
    /// Bounds the work one retired-bank release step does.
    pub fn release_entries(&mut self, max_entries: usize) -> usize {
        for _ in 0..max_entries.max(1) {
            if self.entries.pop().is_none() {
                break;
            }
        }
        self.entries.len()
    }

    /// Check that a sample of `float_count` floats would be accepted and make
    /// room for its table slot now, so the `add` that publishes it later grows
    /// nothing. Returns the id that `add` will assign, or `None` once the id or
    /// byte count would exceed the ABI or the table cannot grow.
    pub fn admit(&mut self, float_count: usize) -> Option<SampleId> {
        let id = SampleId::try_from(self.entries.len()).ok()?;
        let sample_bytes = float_count.checked_mul(std::mem::size_of::<f32>())?;
        self.decoded_bytes.checked_add(sample_bytes)?;
        self.entries.try_reserve(1).ok()?;
        Some(id)
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
    /// Allocates: the browser host computes the tables off the render thread
    /// with `build_zone_tables` and stages them through `ZoneTableStaging`
    /// instead.
    pub fn build_lut(
        &mut self,
        num_articulations: usize,
        num_mics: usize,
    ) -> Result<(), ZoneMapBuildError> {
        let (_, rr_counter_count) = zone_table_sizes(num_articulations, num_mics)?;
        let tables = build_zone_tables(
            self.zones.iter().map(ZoneSpan::from),
            num_articulations,
            num_mics,
        )?;

        self.num_articulations = num_articulations;
        self.num_mics = num_mics;
        self.lut = tables.lut;
        self.rr_counters = vec![0u8; rr_counter_count];
        self.arena = tables.arena;
        Ok(())
    }

    /// Exchange this map's tables and dimensions with the given ones. Moves
    /// vectors only, so it allocates and frees nothing.
    fn swap_tables(
        &mut self,
        num_articulations: usize,
        num_mics: usize,
        lut: &mut Vec<ZoneListRef>,
        arena: &mut Vec<ZoneId>,
        rr_counters: &mut Vec<u8>,
    ) {
        std::mem::swap(&mut self.lut, lut);
        std::mem::swap(&mut self.arena, arena);
        std::mem::swap(&mut self.rr_counters, rr_counters);
        self.num_articulations = num_articulations;
        self.num_mics = num_mics;
    }

    /// The LUT and arena as they stand, for comparing tables built two ways.
    pub fn tables(&self) -> (&[ZoneListRef], &[ZoneId]) {
        (&self.lut, &self.arena)
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

    /// The round-robin ordinal the next note on (articulation, note) plays,
    /// or `None` when the pair is outside the map. Read once per note and
    /// shared by every mic position, so all positions of one note play the
    /// same take.
    #[inline]
    pub fn round_robin_position(&self, articulation: ArticulationId, note: u8) -> Option<u8> {
        self.rr_counters
            .get(Self::rr_index(articulation, note))
            .copied()
    }

    /// Choose among `candidates` for round-robin ordinal `position`: the zone
    /// authored at that ordinal, else the candidate the ordinal indexes. A
    /// single candidate, or a pair outside the map, plays the first.
    pub fn pick_round_robin(&self, candidates: &[ZoneId], position: Option<u8>) -> Option<ZoneId> {
        let first = *candidates.first()?;
        let Some(rr_pos) = position.filter(|_| candidates.len() > 1) else {
            return Some(first);
        };

        let authored = candidates.iter().copied().find(|&zone_id| {
            self.zones
                .get(zone_id as usize)
                .is_some_and(|zone| zone.rr_pos == rr_pos % zone.rr_len.max(1))
        });
        Some(authored.unwrap_or(candidates[rr_pos as usize % candidates.len()]))
    }

    /// Move (articulation, note) on to its next round-robin ordinal.
    pub fn advance_round_robin(&mut self, articulation: ArticulationId, note: u8) {
        if let Some(counter) = self.rr_counters.get_mut(Self::rr_index(articulation, note)) {
            *counter = counter.wrapping_add(1);
        }
    }

    #[inline]
    fn rr_index(articulation: ArticulationId, note: u8) -> usize {
        (articulation as usize) * 128 + note as usize
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
