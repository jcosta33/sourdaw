//! Control-side timeline PCM ownership. Tokens are process-local and never project data.
//! Reservations count before bytes arrive; weak retirement records keep the same
//! budget charged until the scheduler/reclaimer and offline readers actually let go.

use crate::state::{AppState, TimelineSample, TimelineSamplePool};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Weak};

const MAX_OWNERS: usize = 64;
const MAX_LEASES: usize = 256;
const MAX_MATERIALS: usize = 8192;
const MAX_ID_BYTES: usize = 256;
const MAX_FRAMES: usize = 48_000 * 600;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MaterialDescriptor {
    source_id: String,
    version: String,
    frames: usize,
    channels: usize,
    sample_rate: f64,
}

impl MaterialDescriptor {
    fn bytes(&self) -> Result<usize, String> {
        if self.source_id.is_empty()
            || self.source_id.len() > MAX_ID_BYTES
            || self.version.is_empty()
            || self.version.len() > MAX_ID_BYTES
            || self.frames == 0
            || self.frames > MAX_FRAMES
            || !matches!(self.channels, 1 | 2)
            || !self.sample_rate.is_finite()
            || self.sample_rate <= 0.0
            || self.sample_rate > f64::from(f32::MAX)
        {
            return Err("Invalid timeline material descriptor".into());
        }
        self.frames
            .checked_mul(self.channels)
            .and_then(|n| n.checked_mul(4))
            .ok_or_else(|| "Timeline material byte count overflow".into())
    }

    fn wire(&self) -> Value {
        json!({"sourceId": self.source_id, "version": self.version,
            "frames": self.frames, "channels": self.channels, "sampleRate": self.sample_rate})
    }
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct MaterialKey {
    owner: String,
    source_id: String,
    version: String,
}

#[derive(Clone, Debug)]
struct MaterialEntry {
    descriptor: MaterialDescriptor,
    sample: Option<TimelineSample>,
    pins: usize,
    touched: u64,
}

#[derive(Clone, Debug)]
struct MaterialLease {
    owner: String,
    keys: Vec<MaterialKey>,
}

#[derive(Clone, Debug)]
struct RetiredMaterial {
    owner: Option<String>,
    left: Weak<[f32]>,
    right: Weak<[f32]>,
    bytes: usize,
}

impl RetiredMaterial {
    fn reading(&self) -> bool {
        self.left.strong_count() > 0 || self.right.strong_count() > 0
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct TimelineMaterialResidency {
    fenced: bool,
    next_token: u64,
    owners: HashSet<String>,
    leases: HashMap<String, MaterialLease>,
    materials: HashMap<MaterialKey, MaterialEntry>,
    retired: Vec<RetiredMaterial>,
    retirement_fences: HashMap<String, (u64, u64)>,
}

impl TimelineMaterialResidency {
    pub(crate) fn resident_len(&self) -> usize {
        self.materials
            .values()
            .filter(|row| row.sample.is_some())
            .count()
    }

    pub(crate) fn has_legacy_readers(&self) -> bool {
        self.retired
            .iter()
            .any(|row| row.owner.is_none() && row.reading())
    }

    pub(crate) fn accounted_bytes(&self) -> usize {
        self.materials
            .values()
            .map(|row| row.descriptor.frames * row.descriptor.channels * 4)
            .sum::<usize>()
            + self
                .retired
                .iter()
                .filter(|row| row.reading())
                .map(|row| row.bytes)
                .sum::<usize>()
    }

    pub(crate) fn can_track_material(&self, additional: usize) -> bool {
        self.materials.len() + self.retired.iter().filter(|row| row.reading()).count() + additional
            <= MAX_MATERIALS
    }

    pub(crate) fn fenced(&self) -> bool {
        self.fenced
    }

    pub(crate) fn remember_retired(&mut self, owner: Option<String>, sample: &TimelineSample) {
        self.retired.retain(RetiredMaterial::reading);
        self.retired.push(RetiredMaterial {
            owner,
            left: Arc::downgrade(&sample.left),
            right: Arc::downgrade(&sample.right),
            bytes: sample.byte_len(),
        });
    }

    pub(crate) fn record_graph_replacement(
        &mut self,
        previous: Option<&str>,
        incoming: Option<&str>,
        epoch: u64,
        fence: u64,
    ) {
        if previous != incoming {
            if let Some(previous) = previous {
                self.retirement_fences
                    .insert(previous.into(), (epoch, fence));
            }
        }
    }

    fn token(&mut self, prefix: &str) -> Result<String, String> {
        self.next_token = self
            .next_token
            .checked_add(1)
            .ok_or("Timeline token space exhausted")?;
        Ok(format!("{prefix}-{}", self.next_token))
    }

    fn release(&mut self, lease: &str) {
        if let Some(lease) = self.leases.remove(lease) {
            for key in lease.keys {
                if let Some(row) = self.materials.get_mut(&key) {
                    row.pins -= 1;
                }
            }
        }
        // Failed reservations have no cached PCM worth keeping.
        self.materials
            .retain(|_, row| row.pins > 0 || row.sample.is_some());
    }

    fn close(&mut self, owner: &str) {
        self.owners.remove(owner);
        let leases: Vec<_> = self
            .leases
            .iter()
            .filter(|(_, row)| row.owner == owner)
            .map(|(token, _)| token.clone())
            .collect();
        for lease in leases {
            self.release(&lease);
        }
        let keys: Vec<_> = self
            .materials
            .keys()
            .filter(|key| key.owner == owner)
            .cloned()
            .collect();
        for key in keys {
            if let Some(row) = self.materials.remove(&key) {
                if let Some(sample) = row.sample {
                    self.remember_retired(Some(owner.into()), &sample);
                }
            }
        }
        self.retired.retain(RetiredMaterial::reading);
    }
}

impl TimelineSamplePool {
    pub(crate) fn timeline_lease_owner(&self, lease: &str) -> Result<&str, String> {
        let row = self
            .residency
            .leases
            .get(lease)
            .ok_or("Timeline material lease is closed")?;
        if !self.residency.owners.contains(&row.owner) {
            return Err("Timeline material owner is closed".into());
        }
        if row.keys.iter().any(|key| {
            self.residency
                .materials
                .get(key)
                .and_then(|entry| entry.sample.as_ref())
                .is_none()
        }) {
            return Err("Timeline material lease has pending uploads".into());
        }
        Ok(&row.owner)
    }

    pub(crate) fn resolve_timeline_sample(
        &self,
        lease: Option<&str>,
        source: &str,
        version: Option<&str>,
    ) -> Result<&TimelineSample, String> {
        let Some(lease) = lease else {
            if self.residency.fenced {
                return Err("schedule-clip requires a timeline material lease".into());
            }
            return self.get(source).ok_or_else(|| format!("schedule-clip: unknown sample '{source}' — register it with register_timeline_sample first"));
        };
        let owner = self.timeline_lease_owner(lease)?;
        let version = version.ok_or("schedule-clip requires an exact materialVersion")?;
        let key = MaterialKey {
            owner: owner.into(),
            source_id: source.into(),
            version: version.into(),
        };
        let held = self
            .residency
            .leases
            .get(lease)
            .ok_or("Timeline material lease is closed")?;
        if !held.keys.contains(&key) {
            return Err("schedule-clip material is outside its lease".into());
        }
        self.residency
            .materials
            .get(&key)
            .and_then(|row| row.sample.as_ref())
            .ok_or_else(|| "schedule-clip material is not resident".into())
    }

    fn prepare_timeline_materials(
        &mut self,
        owner: String,
        materials: Vec<MaterialDescriptor>,
    ) -> Result<Value, String> {
        if !self.residency.owners.contains(&owner) {
            return Err("Timeline material owner is closed".into());
        }
        if self.residency.leases.len() >= MAX_LEASES || materials.len() > MAX_MATERIALS {
            return Err("Timeline material lease capacity exceeded".into());
        }
        self.residency.retired.retain(RetiredMaterial::reading);
        let mut keys = Vec::new();
        let mut unique = HashSet::new();
        let mut additional = 0usize;
        let mut additional_rows = 0usize;
        for descriptor in &materials {
            let bytes = descriptor.bytes()?;
            let key = MaterialKey {
                owner: owner.clone(),
                source_id: descriptor.source_id.clone(),
                version: descriptor.version.clone(),
            };
            if !unique.insert(key.clone()) {
                return Err("Duplicate timeline material descriptor".into());
            }
            if let Some(row) = self.residency.materials.get(&key) {
                if row.descriptor != *descriptor {
                    return Err("Timeline material version changed shape".into());
                }
            } else {
                additional = additional
                    .checked_add(bytes)
                    .ok_or("Timeline byte count overflow")?;
                additional_rows += 1;
            }
            keys.push(key);
        }
        // Admission plans reclaimable *allocations*, not map entries. A cached
        // row with an Arc reader still costs its bytes even after removal.
        let mut evictable: Vec<_> = self
            .residency
            .materials
            .iter()
            .filter(|(key, row)| {
                row.pins == 0
                    && !unique.contains(*key)
                    && row.sample.as_ref().is_some_and(|sample| {
                        Arc::strong_count(&sample.left) == 1
                            && (sample.right.is_empty() || Arc::strong_count(&sample.right) == 1)
                    })
            })
            .map(|(key, row)| {
                (
                    key.clone(),
                    row.touched,
                    row.descriptor.frames * row.descriptor.channels * 4,
                )
            })
            .collect();
        evictable.sort_by_key(|(_, touched, _)| *touched);
        let mut accounted = self
            .total_bytes()
            .checked_add(additional)
            .ok_or("Timeline byte count overflow")?;
        let mut evictions = Vec::new();
        let row_count =
            self.residency.materials.len() + self.residency.retired.len() + additional_rows;
        for (key, _, bytes) in evictable {
            if accounted <= self.max_bytes() && row_count - evictions.len() <= MAX_MATERIALS {
                break;
            }
            accounted -= bytes;
            evictions.push(key);
        }
        if accounted > self.max_bytes() || row_count - evictions.len() > MAX_MATERIALS {
            return Err(
                "Timeline material working set exceeds the native pool budget or material capacity"
                    .into(),
            );
        }
        let lease = self.residency.token("lease")?;
        for key in evictions {
            self.residency.materials.remove(&key);
        }
        let mut missing = Vec::new();
        for (key, descriptor) in keys.iter().zip(materials) {
            let touched = self.residency.next_token;
            let row = self
                .residency
                .materials
                .entry(key.clone())
                .or_insert(MaterialEntry {
                    descriptor,
                    sample: None,
                    pins: 0,
                    touched,
                });
            row.pins += 1;
            row.touched = touched;
            if row.sample.is_none() {
                missing.push(row.descriptor.wire());
            }
        }
        self.residency
            .leases
            .insert(lease.clone(), MaterialLease { owner, keys });
        Ok(json!({"lease": lease, "missing": missing}))
    }
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
enum LifecycleRequest {
    Open,
    Prepare {
        owner: String,
        materials: Vec<MaterialDescriptor>,
    },
    Release {
        lease: String,
    },
    Retire {
        owner: String,
    },
}

pub async fn timeline_sample_lifecycle(request: Value, state: &AppState) -> Result<Value, String> {
    let request: LifecycleRequest = serde_json::from_value(request)
        .map_err(|error| format!("Invalid timeline lifecycle request: {error}"))?;
    match request {
        LifecycleRequest::Open => {
            let mut pool = state.timeline_samples.lock().map_err(|e| e.to_string())?;
            pool.residency.retired.retain(RetiredMaterial::reading);
            if pool.residency.owners.len()
                + pool.residency.retirement_fences.len()
                + pool
                    .residency
                    .retired
                    .iter()
                    .filter_map(|row| row.owner.as_deref())
                    .collect::<HashSet<_>>()
                    .len()
                >= MAX_OWNERS
            {
                return Err("Timeline owner retirement capacity exceeded".into());
            }
            if !pool.residency.fenced {
                if pool.has_legacy_material_readers() {
                    return Err("Legacy timeline readers must finish before opening fenced material ownership".into());
                }
                pool.clear();
                pool.residency.fenced = true;
            }
            let owner = pool.residency.token("owner")?;
            pool.residency.owners.insert(owner.clone());
            Ok(json!({"owner": owner}))
        }
        LifecycleRequest::Prepare { owner, materials } => state
            .timeline_samples
            .lock()
            .map_err(|e| e.to_string())?
            .prepare_timeline_materials(owner, materials),
        LifecycleRequest::Release { lease } => {
            state
                .timeline_samples
                .lock()
                .map_err(|e| e.to_string())?
                .residency
                .release(&lease);
            Ok(json!({"released": true}))
        }
        LifecycleRequest::Retire { owner } => retire_owner(&owner, state),
    }
}

fn retire_owner(owner: &str, state: &AppState) -> Result<Value, String> {
    if owner.is_empty() || owner.len() > MAX_ID_BYTES {
        return Err("Invalid timeline owner".into());
    }
    // Same order as graph apply: registry -> engine -> samples. Nothing here
    // boots or stops the process-wide engine, capture, or hosted instances.
    let mut registry = state.graph.lock().map_err(|e| e.to_string())?;
    let mut engine = state.engine.lock().map_err(|e| e.to_string())?;
    let mut pool = state.timeline_samples.lock().map_err(|e| e.to_string())?;
    pool.residency.close(owner);
    if registry.timeline_owner.as_deref() == Some(owner) {
        let mut working = registry.clone();
        let ops = working.take_topology_down();
        if let Some(engine) = engine.as_mut() {
            if !engine.is_rendering() {
                return Err(
                    "engine-not-rendering: timeline retirement requires engine recovery".into(),
                );
            }
            engine
                .send_graph_batch(ops)
                .map_err(|error| format!("Timeline graph retirement refused: {error:?}"))?;
            let fence = working.record_fenced_batch();
            pool.residency
                .retirement_fences
                .insert(owner.into(), (working.engine_epoch, fence));
        }
        working.timeline_owner = None;
        working.runtime_revision += 1;
        *registry = working;
    }
    if let Some((epoch, fence)) = pool.residency.retirement_fences.get(owner).copied() {
        let landed = epoch != registry.engine_epoch
            || engine
                .as_mut()
                .is_none_or(|engine| engine.graph_progress_snapshot().batches_applied >= fence);
        if landed {
            pool.residency.retirement_fences.remove(owner);
        }
    }
    let remaining_readers = pool
        .residency
        .retired
        .iter()
        .filter(|row| row.owner.as_deref() == Some(owner) && row.reading())
        .count();
    let pending_fence = pool.residency.retirement_fences.contains_key(owner);
    Ok(json!({"complete": remaining_readers == 0 && !pending_fence,
        "remainingReaders": remaining_readers, "pendingFence": pending_fence, "residentBytes": pool.total_bytes(), "residentEntries": pool.len()}))
}

/// Tagged raw bytes: a reservation is revalidated under its pool lock before
/// decoding and publication. Closing an owner and publishing a sample cannot race.
pub async fn register_timeline_material(
    lease: String,
    source_id: String,
    version: String,
    sample_rate: f64,
    channels: u32,
    pcm: Vec<u8>,
    state: &AppState,
) -> Result<Value, String> {
    let mut pool = state.timeline_samples.lock().map_err(|e| e.to_string())?;
    let held = pool
        .residency
        .leases
        .get(&lease)
        .ok_or("Timeline material lease is closed")?;
    if !pool.residency.owners.contains(&held.owner) {
        return Err("Timeline material owner is closed".into());
    }
    let key = MaterialKey {
        owner: held.owner.clone(),
        source_id,
        version,
    };
    if !held.keys.contains(&key) {
        return Err("Upload is outside its timeline lease".into());
    }
    let row = pool
        .residency
        .materials
        .get_mut(&key)
        .ok_or("Timeline reservation disappeared")?;
    if row.descriptor.sample_rate != sample_rate
        || row.descriptor.channels != channels as usize
        || row.descriptor.bytes()? != pcm.len()
    {
        return Err("Timeline upload does not match its reservation".into());
    }
    let stride = channels as usize * 4;
    if let Some(sample) = &row.sample {
        let equal = pcm.chunks_exact(stride).enumerate().all(|(i, frame)| {
            sample.left[i].to_bits() == u32::from_le_bytes([frame[0], frame[1], frame[2], frame[3]])
                && (channels == 1
                    || sample.right[i].to_bits()
                        == u32::from_le_bytes([frame[4], frame[5], frame[6], frame[7]]))
        });
        if !equal {
            return Err("Timeline material version is immutable".into());
        }
    } else {
        let left: Arc<[f32]> = pcm
            .chunks_exact(stride)
            .map(|frame| f32::from_le_bytes([frame[0], frame[1], frame[2], frame[3]]))
            .collect();
        let right: Arc<[f32]> = if channels == 2 {
            pcm.chunks_exact(stride)
                .map(|frame| f32::from_le_bytes([frame[4], frame[5], frame[6], frame[7]]))
                .collect()
        } else {
            Arc::from([])
        };
        row.sample = Some(TimelineSample {
            left,
            right,
            sample_rate: sample_rate as f32,
        });
    }
    Ok(json!({"frames": row.descriptor.frames}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn descriptor(id: &str, version: &str) -> Value {
        json!({"sourceId": id, "version": version, "frames": 4, "channels": 1, "sampleRate": 48000})
    }

    async fn open(state: &AppState) -> String {
        timeline_sample_lifecycle(json!({"action": "open"}), state)
            .await
            .unwrap()["owner"]
            .as_str()
            .unwrap()
            .to_string()
    }

    async fn prepare(state: &AppState, owner: &str, materials: Value) -> Result<Value, String> {
        timeline_sample_lifecycle(
            json!({"action": "prepare", "owner": owner, "materials": materials}),
            state,
        )
        .await
    }

    #[tokio::test]
    async fn timeline_sample_lifecycle_pending_reservations_refuse_whole_over_budget_batches() {
        let state = AppState::default();
        state.timeline_samples.lock().unwrap().set_max_bytes(32);
        let owner = open(&state).await;
        let first = prepare(&state, &owner, json!([descriptor("a", "1")]))
            .await
            .unwrap();
        let refused = prepare(
            &state,
            &owner,
            json!([descriptor("b", "1"), descriptor("c", "1")]),
        )
        .await;
        assert!(refused.unwrap_err().contains("budget"));
        let lease = first["lease"].as_str().unwrap();
        register_timeline_material(
            lease.into(),
            "a".into(),
            "1".into(),
            48000.0,
            1,
            vec![0; 16],
            &state,
        )
        .await
        .unwrap();
        let pool = state.timeline_samples.lock().unwrap();
        assert_eq!(pool.total_bytes(), 16);
        assert!(pool
            .resolve_timeline_sample(Some(lease), "a", Some("1"))
            .is_ok());
    }

    #[tokio::test]
    async fn timeline_sample_lifecycle_retired_upload_cannot_replace_a_same_id_successor() {
        let state = AppState::default();
        let outgoing = open(&state).await;
        let old = prepare(&state, &outgoing, json!([descriptor("take", "v1")]))
            .await
            .unwrap();
        let receipt =
            timeline_sample_lifecycle(json!({"action": "retire", "owner": outgoing}), &state)
                .await
                .unwrap();
        assert_eq!(receipt["complete"], true);
        let incoming = open(&state).await;
        let new = prepare(&state, &incoming, json!([descriptor("take", "v2")]))
            .await
            .unwrap();
        let lease = new["lease"].as_str().unwrap();
        let pcm: Vec<u8> = [0.5f32; 4].iter().flat_map(|v| v.to_le_bytes()).collect();
        register_timeline_material(
            lease.into(),
            "take".into(),
            "v2".into(),
            48000.0,
            1,
            pcm,
            &state,
        )
        .await
        .unwrap();
        let late = register_timeline_material(
            old["lease"].as_str().unwrap().into(),
            "take".into(),
            "v1".into(),
            48000.0,
            1,
            vec![0; 16],
            &state,
        )
        .await;
        assert!(late.unwrap_err().contains("closed"));
        let pool = state.timeline_samples.lock().unwrap();
        assert_eq!(
            &*pool
                .resolve_timeline_sample(Some(lease), "take", Some("v2"))
                .unwrap()
                .left,
            &[0.5; 4]
        );
    }

    #[tokio::test]
    async fn timeline_sample_lifecycle_legacy_registration_cannot_bypass_an_opened_fence() {
        let state = AppState::default();
        let _owner = open(&state).await;
        let refused = crate::commands::graph::register_timeline_sample(
            "take".into(),
            48000.0,
            1,
            vec![0; 16],
            &state,
        )
        .await;
        assert!(refused.unwrap_err().contains("lease"));
        assert!(state.timeline_samples.lock().unwrap().is_empty());
    }
}
