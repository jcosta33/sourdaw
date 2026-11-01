//! Target-independent NAM admission: one bounded scan of the model text, the
//! per-architecture structural and cost plan, and its memory envelope. Native
//! admission adds the capture-rate check, the per-sample work policy and the
//! instance ledger; the WaveNet parse runs the shared part alone, so a shape
//! that would overrun memory is refused before any buffer is built on either
//! target.
use serde_json::Value;

pub(super) const MIB: u64 = 1024 * 1024;
const MAX_WEIGHTS: usize = 65_536;
/// The parser envelope charges serde_json's 64-bit `Value` slot on every
/// target, so the browser and native admit the same documents.
const VALUE_SLOT: u64 = 32;
#[cfg(not(target_arch = "wasm32"))]
const _: () = assert!(std::mem::size_of::<serde_json::Value>() == 32);

pub(super) fn refuse(reason: &str) -> String {
    format!("Native NAM refused: {reason}")
}
pub(super) fn add(a: u64, b: u64) -> Result<u64, String> {
    a.checked_add(b).ok_or_else(|| refuse("charge overflow"))
}
pub(super) fn mul(a: u64, b: u64) -> Result<u64, String> {
    a.checked_mul(b).ok_or_else(|| refuse("charge overflow"))
}
fn bounded(value: u64, ceiling: u64, name: &str) -> Result<u64, String> {
    if value == 0 || value > ceiling {
        return Err(refuse(name));
    }
    Ok(value)
}
fn dimension(config: &Value, key: &str, max: u64) -> Result<u64, String> {
    bounded(
        config
            .get(key)
            .and_then(Value::as_u64)
            .ok_or_else(|| refuse(key))?,
        max,
        key,
    )
}
fn optional_dimension(config: &Value, key: &str, default: u64, max: u64) -> Result<u64, String> {
    match config.get(key) {
        None => Ok(default),
        Some(_) => dimension(config, key, max),
    }
}
fn boolean(config: &Value, key: &str, default: Option<bool>) -> Result<bool, String> {
    match config.get(key) {
        Some(value) => value.as_bool().ok_or_else(|| refuse(key)),
        None => default.ok_or_else(|| refuse(key)),
    }
}
fn list<'a>(config: &'a Value, key: &str, max: usize) -> Result<&'a [Value], String> {
    let values = config
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| refuse(key))?;
    if values.is_empty() || values.len() > max {
        return Err(refuse(key));
    }
    Ok(values)
}
fn list_dimension(value: &Value, ceiling: u64) -> Result<u64, String> {
    bounded(
        value.as_u64().ok_or_else(|| refuse("integer dimension"))?,
        ceiling,
        "integer dimension",
    )
}

/// A no-allocation first pass. Keys are literal ASCII (escaped keys are an
/// explicitly unsupported native subset); duplicate semantic keys cannot hide
/// behind serde's last-key-wins map. Root weights never become a Value here.
pub(super) struct Scan<'a> {
    text: &'a str,
    at: usize,
    nodes: usize,
    keys: [(usize, usize); 4096],
    key_count: usize,
    weights: usize,
    weight_span: Option<(usize, usize)>,
    config: Option<(usize, usize)>,
    architecture: Option<(usize, usize)>,
    /// Read only by native admission's capture-rate check.
    #[cfg_attr(target_arch = "wasm32", allow(dead_code))]
    pub(super) rate: Option<(usize, usize)>,
    version: Option<(usize, usize)>,
    metadata: usize,
}
impl<'a> Scan<'a> {
    pub(super) fn new(text: &'a str) -> Self {
        Self {
            text,
            at: 0,
            nodes: 1,
            keys: [(0, 0); 4096],
            key_count: 0,
            weights: 0,
            weight_span: None,
            config: None,
            architecture: None,
            rate: None,
            version: None,
            metadata: 0,
        }
    }
    fn whitespace(&mut self) {
        while self
            .text
            .as_bytes()
            .get(self.at)
            .is_some_and(u8::is_ascii_whitespace)
        {
            self.at += 1;
        }
    }
    fn eat(&mut self, byte: u8) -> Result<(), String> {
        self.whitespace();
        if self.text.as_bytes().get(self.at) != Some(&byte) {
            return Err(refuse("JSON syntax"));
        }
        self.at += 1;
        Ok(())
    }
    fn string(&mut self, key: bool) -> Result<(usize, usize), String> {
        self.eat(b'"')?;
        let start = self.at;
        let mut escaped = false;
        loop {
            let byte = *self
                .text
                .as_bytes()
                .get(self.at)
                .ok_or_else(|| refuse("unterminated string"))?;
            if byte < 0x20 || self.at - start > 4096 {
                return Err(refuse("string limit"));
            }
            if !escaped && byte == b'"' {
                let end = self.at;
                self.at += 1;
                return Ok((start, end));
            }
            if !escaped && byte == b'\\' {
                if key {
                    return Err(refuse("escaped JSON keys are unsupported"));
                }
                escaped = true;
            } else {
                escaped = false;
            }
            self.at += 1;
        }
    }
    fn number(&mut self) -> Result<(), String> {
        self.whitespace();
        let start = self.at;
        while self
            .text
            .as_bytes()
            .get(self.at)
            .is_some_and(|c| matches!(c, b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E'))
        {
            self.at += 1;
        }
        if self.at == start || self.at - start > 64 {
            return Err(refuse("numeric token limit"));
        }
        let value: f32 = self.text[start..self.at]
            .parse()
            .map_err(|_| refuse("numeric token"))?;
        if !value.is_finite() {
            return Err(refuse("non-finite number"));
        }
        Ok(())
    }
    fn value(&mut self, depth: usize) -> Result<(), String> {
        if depth > 32 || self.nodes >= 4096 {
            return Err(refuse("JSON depth/node limit"));
        }
        self.nodes += 1;
        self.whitespace();
        match self.text.as_bytes().get(self.at).copied() {
            Some(b'{') => self.object(depth),
            Some(b'[') => {
                self.at += 1;
                self.whitespace();
                if self.text.as_bytes().get(self.at) == Some(&b']') {
                    self.at += 1;
                    return Ok(());
                }
                loop {
                    self.value(depth + 1)?;
                    self.whitespace();
                    if self.text.as_bytes().get(self.at) == Some(&b']') {
                        self.at += 1;
                        break;
                    }
                    self.eat(b',')?;
                }
                Ok(())
            }
            Some(b'"') => {
                self.string(false)?;
                Ok(())
            }
            Some(b't') if self.text[self.at..].starts_with("true") => {
                self.at += 4;
                Ok(())
            }
            Some(b'f') if self.text[self.at..].starts_with("false") => {
                self.at += 5;
                Ok(())
            }
            Some(b'n') if self.text[self.at..].starts_with("null") => {
                self.at += 4;
                Ok(())
            }
            _ => self.number(),
        }
    }
    pub(super) fn object(&mut self, depth: usize) -> Result<(), String> {
        self.eat(b'{')?;
        let base = self.key_count;
        self.whitespace();
        if self.text.as_bytes().get(self.at) == Some(&b'}') {
            self.at += 1;
            return Ok(());
        }
        loop {
            let key = self.string(true)?;
            if self.key_count == self.keys.len()
                || self.keys[base..self.key_count]
                    .iter()
                    .any(|span| self.text[span.0..span.1] == self.text[key.0..key.1])
            {
                return Err(refuse("duplicate key/key limit"));
            }
            self.keys[self.key_count] = key;
            self.key_count += 1;
            self.eat(b':')?;
            self.whitespace();
            let start = self.at;
            let text = self.text;
            let name = &text[key.0..key.1];
            if depth == 0 && name == "weights" {
                self.nodes += 1;
                if self.nodes > 4096 {
                    return Err(refuse("JSON node limit"));
                }
                self.eat(b'[')?;
                self.whitespace();
                if self.text.as_bytes().get(self.at) != Some(&b']') {
                    loop {
                        self.number()?;
                        self.weights += 1;
                        if self.weights > MAX_WEIGHTS {
                            return Err(refuse("weight limit"));
                        }
                        self.whitespace();
                        if self.text.as_bytes().get(self.at) == Some(&b']') {
                            break;
                        }
                        self.eat(b',')?;
                    }
                }
                self.eat(b']')?;
                self.weight_span = Some((start, self.at));
            } else {
                self.value(depth + 1)?;
            }
            if depth == 0 {
                let span = Some((start, self.at));
                match name {
                    "config" => self.config = span,
                    "architecture" => self.architecture = span,
                    "sample_rate" => self.rate = span,
                    "version" => self.version = span,
                    "weights" => (),
                    _ => self.metadata += self.at - key.0 + 2,
                }
            }
            self.whitespace();
            if self.text.as_bytes().get(self.at) == Some(&b'}') {
                self.at += 1;
                break;
            }
            self.eat(b',')?;
        }
        self.key_count = base;
        Ok(())
    }
    pub(super) fn field(&self, span: Option<(usize, usize)>) -> Result<&'a str, String> {
        let (start, end) = span.ok_or_else(|| refuse("required NAM field"))?;
        Ok(&self.text[start..end])
    }
}

#[derive(Clone, Debug)]
pub struct NativeNamPlan {
    pub(super) weights: u64,
    pub(super) resident: u64,
    pub(super) prewarm: u64,
    pub(super) mac: u64,
    pub(super) nonlinear: u64,
    pub(super) touches: u64,
    floats: u64,
    state: u64,
    allocations: u64,
    structures: u64,
    /// Read only by the native instance ledger.
    #[cfg_attr(target_arch = "wasm32", allow(dead_code))]
    pub(super) rate: u64,
}

/// The scanned document both doors plan from: the bounded pass over the whole
/// text, the config text, the architecture and a verified version.
pub(super) struct ScannedModel<'a> {
    pub(super) scan: Scan<'a>,
    config_text: &'a str,
    pub(super) architecture: String,
}
impl<'a> ScannedModel<'a> {
    pub(super) fn read(text: &'a str) -> Result<Self, String> {
        let mut scan = Scan::new(text);
        scan.object(0)?;
        scan.whitespace();
        if scan.at != text.len() || scan.metadata > 65_536 {
            return Err(refuse("JSON/metadata limit"));
        }
        let config_text = scan.field(scan.config)?;
        if config_text.len() > 16_384 {
            return Err(refuse("config byte limit"));
        }
        let architecture: String = serde_json::from_str(scan.field(scan.architecture)?)
            .map_err(|_| refuse("architecture"))?;
        if let Some(span) = scan.version {
            let version: String =
                serde_json::from_str(scan.field(Some(span))?).map_err(|_| refuse("version"))?;
            super::verify_version(&version).map_err(|e| refuse(&e.to_string()))?;
        }
        Ok(Self {
            scan,
            config_text,
            architecture,
        })
    }
}

/// Run the shared admission over a WaveNet document before the parser builds
/// any of it: the structural plan, the exact weight count, and the state,
/// resident, prewarm and transient memory envelope. The per-sample work
/// ceilings stay native-only.
pub(super) fn admit_wavenet(text: &str) -> Result<(), String> {
    if text.len() > MIB as usize {
        return Err(refuse("model byte limit"));
    }
    let model = ScannedModel::read(text)?;
    if model.architecture != "WaveNet" {
        return Err(refuse("architecture"));
    }
    NativeNamPlan::shared(&model, 0)?.transient(&model, text)
}

impl NativeNamPlan {
    /// The architecture plan, the exact weight count and the memory policy
    /// every target enforces. Native admission follows it with its
    /// per-sample work policy, then the transient envelope.
    pub(super) fn shared(model: &ScannedModel<'_>, rate: u64) -> Result<Self, String> {
        let config: Value =
            serde_json::from_str(model.config_text).map_err(|e| refuse(&e.to_string()))?;
        if !config.is_object() {
            return Err(refuse("config object"));
        }
        let mut plan = Self {
            weights: 0,
            resident: 0,
            prewarm: 1,
            mac: 0,
            nonlinear: 0,
            touches: 0,
            floats: 0,
            state: 0,
            allocations: 1,
            structures: 1,
            rate,
        };
        match model.architecture.as_str() {
            "Linear" => plan.linear(&config)?,
            "LSTM" => plan.lstm(&config)?,
            "ConvNet" => plan.convnet(&config)?,
            "WaveNet" => plan.wavenet(&config)?,
            _ => return Err(refuse("unsupported architecture")),
        }
        if plan.weights != model.scan.weights as u64 {
            return Err(refuse("exact weight count"));
        }
        if model.architecture == "ConvNet"
            && config.get("batchnorm").and_then(Value::as_bool) == Some(true)
        {
            validate_batchnorm(&config, model.scan.field(model.scan.weight_span)?)?;
        }
        plan.prewarm = mul(add(plan.prewarm, 63)? / 64, 64)?;
        // Every owned vector is charged at twice its logical element count,
        // plus 128 bytes per allocation and 2 KiB per runtime node. This covers
        // the current constructors' Vec capacities, structs, Box and Arc rows.
        plan.resident = add(
            mul(plan.floats, 8)?,
            add(mul(plan.allocations, 128)?, mul(plan.structures, 2048)?)?,
        )?;
        let work = add(
            plan.mac,
            add(mul(64, plan.nonlinear)?, mul(16, plan.touches)?)?,
        )?;
        if plan.state > 1_048_576
            || plan.resident > 8 * MIB
            || plan.prewarm > 65_536
            || mul(plan.prewarm, work)? > 268_435_456
        {
            return Err(refuse("state/resident/prewarm/work policy"));
        }
        Ok(plan)
    }

    /// serde's weight Value vector, f32 copy, bounded non-weight maps and
    /// strings coexist with the model during construction. Charge capacity
    /// growth (old + new) too; never infer a bound from source byte size alone.
    pub(super) fn transient(&self, model: &ScannedModel<'_>, text: &str) -> Result<(), String> {
        let parsed_weights = mul(model.scan.weights as u64, add(mul(VALUE_SLOT, 3)?, 8)?)?;
        let parsed_metadata = add(
            mul(model.scan.nodes as u64, 1024)?,
            mul(model.config_text.len() as u64, 8)?,
        )?;
        let parser = add(
            mul(text.len() as u64, 2)?,
            add(parsed_weights, parsed_metadata)?,
        )?;
        let transient = add(131_072, add(self.resident, parser)?)?;
        if transient > 32 * MIB {
            return Err(refuse("transient preparation envelope"));
        }
        Ok(())
    }
}

impl NativeNamPlan {
    fn buffer(&mut self, floats: u64) -> Result<(), String> {
        self.floats = add(self.floats, floats)?;
        if floats > 0 {
            self.allocations = add(self.allocations, 1)?;
        }
        Ok(())
    }
    fn convolution(
        &mut self,
        i: u64,
        o: u64,
        k: u64,
        d: u64,
        bias: bool,
        history: bool,
    ) -> Result<(), String> {
        let taps = mul(mul(i, o)?, k)?;
        self.weights = add(self.weights, add(taps, if bias { o } else { 0 })?)?;
        self.mac = add(self.mac, taps)?;
        self.touches = add(self.touches, add(i, o)?)?;
        self.buffer(taps)?;
        if bias {
            self.buffer(o)?;
        }
        if history {
            let lookback = mul(k - 1, d)?;
            let state = mul(i, add(lookback, 1)?)?;
            self.state = add(self.state, state)?;
            self.buffer(state)?;
            self.prewarm = add(self.prewarm, lookback)?;
        }
        self.structures = add(self.structures, 1)?;
        Ok(())
    }
    fn activation(&mut self, value: &Value, channels: u64, copies: u64) -> Result<(), String> {
        // Reuse the actual activation grammar after the bounded config pass.
        super::activations::Activation::from_json(value).map_err(|e| refuse(&e.to_string()))?;
        let name = value
            .as_str()
            .or_else(|| value.get("type").and_then(Value::as_str))
            .ok_or_else(|| refuse("activation"))?;
        let transcendentals = match name {
            "Tanh" | "Sigmoid" | "SiLU" => channels,
            _ => 0,
        };
        self.nonlinear = add(self.nonlinear, mul(transcendentals, copies)?)?;
        self.touches = add(self.touches, mul(channels, copies)?)?;
        if name == "PReLU" {
            let count = if value.get("negative_slope").is_some() {
                1
            } else {
                list(value, "negative_slopes", 64)?.len() as u64
            };
            self.buffer(mul(count, copies)?)?;
            self.allocations = add(self.allocations, copies)?;
        }
        Ok(())
    }
    fn mono(config: &Value) -> Result<(), String> {
        if optional_dimension(config, "in_channels", 1, 1)? != 1
            || optional_dimension(config, "out_channels", 1, 1)? != 1
        {
            return Err(refuse("mono capture required"));
        }
        Ok(())
    }
    fn linear(&mut self, config: &Value) -> Result<(), String> {
        Self::mono(config)?;
        let taps = dimension(config, "receptive_field", 4096)?;
        self.weights = add(taps, u64::from(boolean(config, "bias", None)?))?;
        self.mac = taps;
        self.touches = 2;
        self.state = taps;
        self.buffer(mul(taps, 2)?)?;
        self.allocations += 2;
        self.prewarm = taps;
        Ok(())
    }
    fn lstm(&mut self, config: &Value) -> Result<(), String> {
        let hidden = dimension(config, "hidden_size", 32)?;
        let layers = dimension(config, "num_layers", 4)?;
        dimension(config, "input_size", 1)?;
        optional_dimension(config, "out_channels", 1, 1)?;
        if hidden > 1 && layers > 1 {
            return Err(refuse(
                "stacked wide LSTM unsupported by current runtime (5454)",
            ));
        }
        for index in 0..layers {
            let input = if index == 0 { 1 } else { hidden };
            let matrix = mul(mul(4, hidden)?, add(input, hidden)?)?;
            self.weights = add(self.weights, add(matrix, mul(6, hidden)?)?)?;
            self.mac = add(self.mac, matrix)?;
            self.nonlinear = add(self.nonlinear, mul(5, hidden)?)?;
            self.touches = add(self.touches, add(mul(12, hidden)?, input)?)?;
            self.state = add(self.state, add(mul(8, hidden)?, input)?)?;
            self.buffer(add(matrix, add(mul(12, hidden)?, input)?)?)?;
            self.allocations += 7;
            self.structures += 1;
        }
        self.weights = add(self.weights, add(hidden, 1)?)?;
        self.mac = add(self.mac, hidden)?;
        self.buffer(add(hidden, 3)?)?;
        self.allocations += 5;
        self.prewarm = 24_000;
        Ok(())
    }
    fn convnet(&mut self, config: &Value) -> Result<(), String> {
        Self::mono(config)?;
        optional_dimension(config, "groups", 1, 1)?;
        let channels = dimension(config, "channels", 64)?;
        let dilations = list(config, "dilations", 32)?;
        let batchnorm = boolean(config, "batchnorm", None)?;
        let activation = config
            .get("activation")
            .ok_or_else(|| refuse("activation"))?;
        self.activation(activation, channels, dilations.len() as u64)?;
        let mut input = 1;
        for dilation in dilations {
            self.convolution(
                input,
                channels,
                2,
                list_dimension(dilation, 32_768)?,
                !batchnorm,
                true,
            )?;
            if batchnorm {
                self.weights = add(self.weights, add(mul(4, channels)?, 1)?)?;
                // Include the six simultaneous BN constructor buffers; retaining
                // their charge after construction is deliberately conservative.
                self.buffer(mul(6, channels)?)?;
                self.allocations += 6;
                self.mac = add(self.mac, channels)?;
            }
            input = channels;
        }
        self.weights = add(self.weights, add(channels, 1)?)?;
        self.mac = add(self.mac, channels)?;
        self.buffer(mul(3, channels)?)?;
        self.allocations += 3;
        Ok(())
    }
    fn wavenet(&mut self, config: &Value) -> Result<(), String> {
        Self::mono(config)?;
        if config.get("condition_dsp").is_some_and(|v| !v.is_null()) {
            return Err(refuse("condition DSP unsupported"));
        }
        if super::config_layers_are_slimmable(config) {
            return Err(refuse("slimmable unsupported"));
        }
        let arrays = list(config, "layers", 4)?;
        let first_channels = dimension(&arrays[0], "channels", 64)?;
        let mut previous_channels = 1;
        let mut previous_legacy_head = 0;
        let mut previous_head = 0;
        let mut max_head = 0;
        let mut total_layers = 0;
        // Compute the actual fixed scratch span before validating array copies.
        for array in arrays {
            let head = match array.get("head").filter(|h| !h.is_null()) {
                Some(head) => dimension(head, "out_channels", 64)?,
                None => dimension(array, "head_size", 64)?,
            };
            max_head = max_head.max(head);
        }
        for (index, array) in arrays.iter().enumerate() {
            for key in ["groups_input", "groups_input_mixin"] {
                optional_dimension(array, key, 1, 1)?;
            }
            optional_dimension(&array["layer1x1"], "groups", 1, 1)?;
            optional_dimension(&array["head1x1"], "groups", 1, 1)?;
            for (key, value) in array
                .as_object()
                .ok_or_else(|| refuse("layer array object"))?
            {
                if key.contains("film")
                    && (value.as_bool() == Some(true)
                        || (!value.is_boolean()
                            && value.get("active").and_then(Value::as_bool).unwrap_or(true)))
                {
                    return Err(refuse("FiLM unsupported"));
                }
            }
            let input = dimension(array, "input_size", 64)?;
            dimension(array, "condition_size", 1)?;
            let channels = dimension(array, "channels", 64)?;
            let bottleneck = optional_dimension(array, "bottleneck", channels, 64)?;
            let dilations = list(array, "dilations", 32)?;
            total_layers += dilations.len();
            if total_layers > 32 {
                return Err(refuse("WaveNet layer count"));
            }
            let gated = match array.get("gating_mode").and_then(Value::as_str) {
                Some("gated" | "blended") => true,
                Some("none") => false,
                Some(_) => return Err(refuse("gating mode")),
                None => boolean(array, "gated", Some(false))?,
            };
            let output = mul(bottleneck, if gated { 2 } else { 1 })?;
            // The expanded gated width is itself bounded.
            bounded(output, 64, "gated width")?;
            let layer_active = boolean(&array["layer1x1"], "active", Some(true))?;
            let head_active = boolean(&array["head1x1"], "active", Some(false))?;
            let head_input = if head_active {
                dimension(&array["head1x1"], "out_channels", 64)?
            } else {
                bottleneck
            };
            if !layer_active && bottleneck != channels {
                return Err(refuse("inactive layer1x1 shape"));
            }
            if input != previous_channels
                || (index > 0
                    && (channels != previous_legacy_head
                        || input != first_channels
                        || previous_channels != first_channels
                        || head_input != previous_head
                        || head_input != max_head))
            {
                return Err(refuse("WaveNet fixed scratch/cross-array shape"));
            }
            self.convolution(input, channels, 1, 1, false, false)?;
            let kernels = array.get("kernel_sizes").and_then(Value::as_array);
            if array.get("kernel_sizes").is_some() && kernels.is_none() {
                return Err(refuse("kernel_sizes"));
            }
            if kernels.is_some_and(|k| k.len() != dilations.len()) {
                return Err(refuse("kernel_sizes length"));
            }
            for (layer, dilation) in dilations.iter().enumerate() {
                let kernel = match kernels {
                    Some(values) => list_dimension(&values[layer], 9)?,
                    None => dimension(array, "kernel_size", 9)?,
                };
                self.convolution(
                    channels,
                    output,
                    kernel,
                    list_dimension(dilation, 32_768)?,
                    true,
                    true,
                )?;
                self.convolution(1, output, 1, 1, false, false)?;
                if layer_active {
                    self.convolution(bottleneck, channels, 1, 1, true, false)?;
                }
                if head_active {
                    self.convolution(bottleneck, head_input, 1, 1, true, false)?;
                }
                self.buffer(add(mul(2, output)?, add(channels, head_input)?)?)?;
                self.allocations += 4;
                self.activation(
                    array
                        .get("activation")
                        .ok_or_else(|| refuse("activation"))?,
                    bottleneck,
                    1,
                )?;
                if gated {
                    self.activation(
                        array
                            .get("secondary_activation")
                            .unwrap_or(&Value::String("Sigmoid".into())),
                        bottleneck,
                        1,
                    )?;
                }
            }
            let head_bias = boolean(array, "head_bias", None)?;
            let (head, kernel, dilation, bias) = match array.get("head").filter(|h| !h.is_null()) {
                Some(head) => (
                    dimension(head, "out_channels", 64)?,
                    dimension(head, "kernel_size", 9)?,
                    optional_dimension(head, "head_dilation", 1, 32_768)?,
                    boolean(head, "bias", None)?,
                ),
                None => (dimension(array, "head_size", 64)?, 1, 1, head_bias),
            };
            self.convolution(head_input, head, kernel, dilation, bias, true)?;
            self.buffer(add(head, add(head_input, mul(2, channels)?)?)?)?;
            self.allocations += 4;
            previous_channels = channels;
            previous_legacy_head = optional_dimension(array, "head_size", head, 64)?;
            previous_head = head;
        }
        self.buffer(add(1, add(first_channels, add(max_head, previous_head)?)?)?)?;
        self.allocations += 4;
        if let Some(head) = config.get("head").filter(|h| !h.is_null()) {
            let channels = dimension(head, "channels", 64)?;
            dimension(head, "out_channels", 1)?;
            let kernels = list(head, "kernel_sizes", 8)?;
            let activation = head.get("activation").ok_or_else(|| refuse("activation"))?;
            let mut input = previous_head;
            let mut widest = input.max(channels);
            for (index, kernel) in kernels.iter().enumerate() {
                let output = if index + 1 == kernels.len() {
                    1
                } else {
                    channels
                };
                self.activation(activation, input, 1)?;
                self.convolution(input, output, list_dimension(kernel, 9)?, 1, true, true)?;
                widest = widest.max(output);
                input = output;
            }
            self.buffer(mul(2, widest)?)?;
            self.allocations += 4;
        } else if previous_head != 1 {
            return Err(refuse("mono WaveNet output required"));
        }
        self.weights = add(self.weights, 1)?;
        Ok(())
    }
}

// The shared BN constructor rejects negative variance but a finite weight can
// still fold to infinity. Validate those exact f32 coefficients before any
// constructor; a ReLU during silence could otherwise hide a poisoned NaN.
fn validate_batchnorm(config: &Value, text: &str) -> Result<(), String> {
    let channels = dimension(config, "channels", 64)? as usize;
    let blocks = list(config, "dilations", 32)?.len();
    let mut values = text[1..text.len() - 1].split(',');
    let mut next = || -> Result<f32, String> {
        values
            .next()
            .ok_or_else(|| refuse("batchnorm weights"))?
            .trim()
            .parse()
            .map_err(|_| refuse("batchnorm weights"))
    };
    let mut input = 1;
    for _ in 0..blocks {
        for _ in 0..input * channels * 2 {
            next()?;
        }
        let mut mean = [0.0f32; 64];
        let mut variance = [0.0f32; 64];
        let mut scale = [0.0f32; 64];
        let mut bias = [0.0f32; 64];
        for value in &mut mean[..channels] {
            *value = next()?;
        }
        for value in &mut variance[..channels] {
            *value = next()?;
        }
        for value in &mut scale[..channels] {
            *value = next()?;
        }
        for value in &mut bias[..channels] {
            *value = next()?;
        }
        let eps = next()?;
        for index in 0..channels {
            let variance = variance[index] + eps;
            let scale = scale[index] / variance.sqrt();
            let loc = bias[index] - scale * mean[index];
            if variance <= 0.0 || !variance.is_finite() || !scale.is_finite() || !loc.is_finite() {
                return Err(refuse("non-finite batchnorm fold"));
            }
        }
        input = channels;
    }
    Ok(())
}
