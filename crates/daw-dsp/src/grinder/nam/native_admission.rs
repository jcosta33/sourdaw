//! Native-only, finite admission for the existing NAM runtime. The generic IPC
//! Value already exists on entry: these charges bound subsequent NAM work, not
//! that ingress or process RSS. No ledger operation runs on the audio thread.
//! The bounded scan, the structural plan and its memory envelope live in
//! `admission_plan`, shared with the WASM parser; this file adds the rate
//! check, the per-sample work policy and the instance ledger.
pub use super::admission_plan::NativeNamPlan;
use super::admission_plan::{add, mul, refuse, Scan, ScannedModel, MIB};
use super::{parse_nam_model, NamModel};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, Weak};

static PREPARING: AtomicBool = AtomicBool::new(false);
static NEXT_REQUEST: AtomicU64 = AtomicU64::new(1);
static LEDGER: Mutex<Vec<Weak<NativeNamLease>>> = Mutex::new(Vec::new());

impl NativeNamPlan {
    pub fn sample_rate(&self) -> u64 {
        self.rate
    }
    pub fn capture_rate(text: &str) -> Result<f32, String> {
        if text.len() > MIB as usize {
            return Err(refuse("model byte limit"));
        }
        let mut scan = Scan::new(text);
        scan.object(0)?;
        match scan.rate {
            None => Ok(48_000.0),
            Some(span) => {
                serde_json::from_str(scan.field(Some(span))?).map_err(|_| refuse("sample_rate"))
            }
        }
    }

    pub fn inspect(text: &str, sample_rate: f32) -> Result<Self, String> {
        if text.len() > MIB as usize
            || !sample_rate.is_finite()
            || sample_rate < 1.0
            || sample_rate.fract() != 0.0
        {
            return Err(refuse("model byte/sample-rate limit"));
        }
        let model = ScannedModel::read(text)?;
        let declared_rate = match model.scan.rate {
            Some(span) => serde_json::from_str::<f64>(model.scan.field(Some(span))?)
                .map_err(|_| refuse("sample_rate"))?,
            None => 48_000.0,
        };
        if declared_rate != f64::from(sample_rate)
            || (model.architecture == "Linear" && sample_rate != 48_000.0)
        {
            return Err(refuse(
                "capture/engine rate mismatch; native resampling is unsupported",
            ));
        }
        let plan = Self::shared(&model, sample_rate as u64)?;
        // The desktop ledger multiplies these per-sample figures by the engine
        // rate across every live instance; the browser has no such ledger.
        if plan.mac > 4096 || plan.nonlinear > 512 || plan.touches > 2048 {
            return Err(refuse("state/resident/prewarm/work policy"));
        }
        plan.transient(&model, text)?;
        Ok(plan)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NativeNamTarget {
    pub engine: u64,
    pub effect: usize,
}
pub struct NativeNamReservation {
    pub plan: NativeNamPlan,
    pub target: NativeNamTarget,
    pub authority: Arc<AtomicU64>,
    pub request: u64,
}
#[derive(Debug)]
pub struct NativeNamLease {
    plan: NativeNamPlan,
    target: NativeNamTarget,
    phase: AtomicU8,
    authority: Arc<AtomicU64>,
    request: u64,
}
impl NativeNamLease {
    pub fn is_current(&self) -> bool {
        self.authority.load(Ordering::Acquire) == self.request
    }
    pub fn is_live(&self) -> bool {
        self.phase.load(Ordering::Acquire) == 1 && self.is_current()
    }
    pub fn activate(&self) {
        self.phase.store(1, Ordering::Release);
    }
    pub fn retire(&self) {
        self.phase.store(2, Ordering::Release);
    }
    pub fn invalidate(&self) {
        self.authority.store(0, Ordering::Release);
        self.retire();
    }
}
pub fn next_native_nam_request() -> Result<u64, String> {
    NEXT_REQUEST
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |v| v.checked_add(1))
        .map_err(|_| refuse("request identity exhausted"))
}
pub struct NativeNamTransaction;
impl NativeNamTransaction {
    pub fn begin(bytes: usize, count: usize) -> Result<Self, String> {
        if bytes > 8 * MIB as usize || count > 16 || count == 0 {
            return Err(refuse("transaction payload limit"));
        }
        PREPARING
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .map_err(|_| refuse("preparation already active"))?;
        Ok(Self)
    }
    pub fn reserve(
        &self,
        requests: &[NativeNamReservation],
    ) -> Result<Vec<Arc<NativeNamLease>>, String> {
        if requests.len() > 16 {
            return Err(refuse("pending instance limit"));
        }
        let mut ledger = LEDGER.lock().map_err(|_| refuse("ledger poisoned"))?;
        ledger.retain(|row| row.strong_count() > 0);
        let mut held: Vec<_> = ledger.iter().filter_map(Weak::upgrade).collect();
        let new: Vec<_> = requests
            .iter()
            .map(|r| {
                Arc::new(NativeNamLease {
                    plan: r.plan.clone(),
                    target: r.target,
                    phase: AtomicU8::new(0),
                    authority: Arc::clone(&r.authority),
                    request: r.request,
                })
            })
            .collect();
        held.extend(new.iter().cloned());
        if held.len() > 32 || ledger.len() + new.len() > 64 {
            return Err(refuse("lifetime instance/metadata limit"));
        }
        let mut lifetime = 0;
        let mut pending = 0;
        let mut pending_count = 0;
        let mut live_bytes = 0;
        let mut targets: Vec<(NativeNamTarget, u64, u64, u64)> = Vec::with_capacity(16);
        for lease in &held {
            lifetime = add(lifetime, lease.plan.resident)?;
            let phase = lease.phase.load(Ordering::Acquire);
            if phase == 0 {
                pending = add(pending, lease.plan.resident)?;
                pending_count += 1;
            }
            if phase == 2 {
                continue;
            }
            if phase == 1 {
                live_bytes = add(live_bytes, lease.plan.resident)?;
            }
            let mac = mul(lease.plan.mac, lease.plan.rate)?;
            let nonlinear = mul(lease.plan.nonlinear, lease.plan.rate)?;
            let touches = mul(lease.plan.touches, lease.plan.rate)?;
            if let Some(row) = targets.iter_mut().find(|row| row.0 == lease.target) {
                // Replacement reserves max(old,new), never both as concurrent
                // audio work. Both still consume lifetime resident bytes.
                row.1 = row.1.max(mac);
                row.2 = row.2.max(nonlinear);
                row.3 = row.3.max(touches);
            } else {
                targets.push((lease.target, mac, nonlinear, touches));
            }
        }
        let mut mac = 0;
        let mut nonlinear = 0;
        let mut touches = 0;
        for row in &targets {
            mac = add(mac, row.1)?;
            nonlinear = add(nonlinear, row.2)?;
            touches = add(touches, row.3)?;
        }
        if pending_count > 16
            || targets.len() > 16
            || lifetime > 128 * MIB
            || pending > 64 * MIB
            || live_bytes > 64 * MIB
            || mac > 16_384 * 48_000
            || nonlinear > 2048 * 48_000
            || touches > 8192 * 48_000
        {
            return Err(refuse("aggregate lifetime/pending/live/work policy"));
        }
        ledger.extend(new.iter().map(Arc::downgrade));
        Ok(new)
    }
}
impl Drop for NativeNamTransaction {
    fn drop(&mut self) {
        PREPARING.store(false, Ordering::Release);
    }
}

/// Declaration order matters: destroy the actual network before returning its
/// lifetime charge. Registry receipts hold only Weak leases.
pub struct NativePreparedNam {
    model: Box<NamModel>,
    pub lease: Arc<NativeNamLease>,
    pub content_hash: [u8; 32],
}
impl NativePreparedNam {
    pub fn build(
        text: &str,
        plan: &NativeNamPlan,
        lease: Arc<NativeNamLease>,
        content_hash: [u8; 32],
    ) -> Result<Self, String> {
        if !lease.is_current() {
            return Err(refuse("superseded preparation"));
        }
        let mut model = Box::new(parse_nam_model(text).map_err(|e| refuse(&e.to_string()))?);
        model.reset_state();
        if model.prewarm_samples().div_ceil(64) as u64 * 64 != plan.prewarm {
            return Err(refuse("preflight/runtime prewarm disagreement"));
        }
        for _ in 0..plan.prewarm / 64 {
            if !lease.is_current() {
                return Err(refuse("superseded preparation"));
            }
            for _ in 0..64 {
                if !model.process(0.0).is_finite() {
                    return Err(refuse("non-finite prewarm output"));
                }
            }
        }
        Ok(Self {
            model,
            lease,
            content_hash,
        })
    }
    pub fn process(&mut self, input: f32) -> f32 {
        self.model.process(input)
    }
}
pub struct NativeGrinderModelRequest {
    pub model: Option<NativePreparedNam>,
    pub authority: Arc<AtomicU64>,
    pub request: u64,
    pub applied: Arc<AtomicBool>,
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    static NATIVE_ADMISSION_TEST: Mutex<()> = Mutex::new(());

    #[test]
    fn native_grinder_model_preflight_matches_actual_namcore_networks() {
        let _serial = NATIVE_ADMISSION_TEST.lock().unwrap();
        for (fixture, golden) in [
            ("wavenet.nam", "golden_wavenet_bs64.txt"),
            ("lstm.nam", "golden_lstm_bs64.txt"),
            (
                "gated_wavenet_synthetic.nam",
                "golden_gated_wavenet_synthetic_bs64.txt",
            ),
            ("convnet_synthetic.nam", "golden_convnet_synthetic_bs64.txt"),
        ] {
            let text = super::super::read_fixture(fixture);
            let plan = NativeNamPlan::inspect(&text, 48_000.0).unwrap();
            let transaction = NativeNamTransaction::begin(text.len(), 1).unwrap();
            let mut leases = transaction
                .reserve(&[NativeNamReservation {
                    plan: plan.clone(),
                    target: NativeNamTarget {
                        engine: 1,
                        effect: 1,
                    },
                    authority: Arc::new(AtomicU64::new(1)),
                    request: 1,
                }])
                .unwrap();
            let mut model =
                NativePreparedNam::build(&text, &plan, leases.remove(0), [0; 32]).unwrap();
            let actual: Vec<_> = super::super::parity_input(384)
                .into_iter()
                .map(|x| model.process(x))
                .collect();
            assert!(
                super::super::relative_rms(&actual, &super::super::read_golden(golden)) <= 1e-5
            );
            assert_eq!(
                plan.weights,
                serde_json::from_str::<serde_json::Value>(&text).unwrap()["weights"]
                    .as_array()
                    .unwrap()
                    .len() as u64
            );
        }
    }

    #[test]
    fn native_grinder_limits_refuse_before_any_constructor_or_prewarm() {
        let linear = |taps: u64, weights: usize| {
            serde_json::json!({"architecture":"Linear", "config":{"receptive_field":taps,"bias":false}, "weights":vec![0.0; weights]}).to_string()
        };
        assert!(NativeNamPlan::inspect(&linear(4096, 4096), 48_000.0).is_ok());
        assert!(NativeNamPlan::inspect(&linear(4097, 4097), 48_000.0).is_err());
        assert!(NativeNamPlan::inspect(&linear(u64::MAX, 1), 48_000.0).is_err());
        assert!(NativeNamPlan::inspect(&linear(1, 65_537), 48_000.0)
            .unwrap_err()
            .contains("weight limit"));
        assert!(NativeNamPlan::inspect(&linear(1, 1), 44_100.0).is_err());
        let mut metadata: Value = serde_json::from_str(&linear(1, 1)).unwrap();
        for index in 0..17 {
            metadata[format!("metadata{index}")] = Value::String("x".repeat(4096));
        }
        assert!(NativeNamPlan::inspect(&metadata.to_string(), 48_000.0)
            .unwrap_err()
            .contains("metadata"));
        let mut poisoned: Value =
            serde_json::from_str(&super::super::read_fixture("convnet_synthetic.nam")).unwrap();
        // First block: eight convolution weights, then mean/variance/gamma/beta
        // vectors of width four and eps. A finite gamma can overflow the fold.
        poisoned["weights"][16] = serde_json::json!(3.0e38);
        poisoned["weights"][12] = serde_json::json!(1.0e-38);
        poisoned["weights"][24] = serde_json::json!(1.0e-38);
        assert!(NativeNamPlan::inspect(&poisoned.to_string(), 48_000.0)
            .unwrap_err()
            .contains("batchnorm"));
    }

    #[test]
    fn native_grinder_atomic_reservation_is_bounded_and_releases_only_actual_last_owners() {
        let _serial = NATIVE_ADMISSION_TEST.lock().unwrap();
        let text = r#"{"architecture":"Linear","config":{"receptive_field":1,"bias":false},"weights":[0.5]}"#;
        let plan = NativeNamPlan::inspect(text, 48_000.0).unwrap();
        let transaction = NativeNamTransaction::begin(text.len(), 16).unwrap();
        assert!(
            NativeNamTransaction::begin(1, 1).is_err(),
            "no preparation wait queue"
        );
        let reservations: Vec<_> = (1..=16)
            .map(|effect| NativeNamReservation {
                plan: plan.clone(),
                target: NativeNamTarget { engine: 1, effect },
                authority: Arc::new(AtomicU64::new(1)),
                request: 1,
            })
            .collect();
        let mut leases = transaction.reserve(&reservations).unwrap();
        let next = NativeNamReservation {
            plan,
            target: NativeNamTarget {
                engine: 1,
                effect: 17,
            },
            authority: Arc::new(AtomicU64::new(1)),
            request: 1,
        };
        assert!(transaction.reserve(std::slice::from_ref(&next)).is_err());
        let retained = Arc::clone(&leases[0]);
        drop(leases.remove(0));
        assert!(
            transaction.reserve(std::slice::from_ref(&next)).is_err(),
            "a removed registry row cannot return a retained owner's credit"
        );
        drop(retained);
        assert_eq!(
            transaction
                .reserve(std::slice::from_ref(&next))
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn native_grinder_model_refuses_overflow_hidden_state_and_duplicate_semantics() {
        for text in [
            r#"{"architecture":"LSTM","config":{"hidden_size":18446744073709551615,"num_layers":2},"weights":[]}"#,
            r#"{"architecture":"LSTM","config":{"input_size":1,"hidden_size":2,"num_layers":2},"weights":[]}"#,
            r#"{"architecture":"Linear","architecture":"LSTM","config":{},"weights":[]}"#,
        ] {
            assert!(NativeNamPlan::inspect(text, 48_000.0).is_err());
        }
        assert!(NativeNamPlan::inspect(&" ".repeat(1_048_577), 48_000.0).is_err());
    }
}
