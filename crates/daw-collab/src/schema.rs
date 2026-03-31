/// Unique identifier for an Automerge document in the multi-document model.
pub type DocId = String;

// -- Root document keys --

/// Top-level key in the root Automerge document.
pub const KEY_PROJECT: &str = "project";

// Keys within the `project` map
pub const KEY_ID: &str = "id";
pub const KEY_NAME: &str = "name";
pub const KEY_SAMPLE_RATE: &str = "sampleRate";
pub const KEY_CREATED_AT: &str = "createdAt";
pub const KEY_UPDATED_AT: &str = "updatedAt";

/// Map of track ID → { ref: DocId, orderKey: String }
pub const KEY_TRACKS: &str = "tracks";

/// Map of connection ID → connection data
pub const KEY_ROUTING: &str = "routing";
pub const KEY_CONNECTIONS: &str = "connections";

/// Map of marker ID → marker data
pub const KEY_MARKERS: &str = "markers";

/// Map of asset hash → asset metadata
pub const KEY_ASSETS: &str = "assets";

/// Transport configuration (persisted subset)
pub const KEY_TRANSPORT: &str = "transport";

/// Tempo map entries
pub const KEY_TEMPO_MAP: &str = "tempoMap";

/// Time signature map entries
pub const KEY_TIME_SIGNATURE_MAP: &str = "timeSignatureMap";

// -- Track document keys --

/// Top-level key in a track child document.
pub const KEY_TRACK: &str = "track";

pub const KEY_TYPE: &str = "type";
pub const KEY_VOLUME_DB: &str = "volumeDb";
pub const KEY_PAN: &str = "pan";
pub const KEY_MUTE: &str = "mute";
pub const KEY_SOLO: &str = "solo";
pub const KEY_ARMED: &str = "armed";
pub const KEY_COLOR: &str = "color";

/// Map of clip ID → { orderKey, ref? }
pub const KEY_CLIPS: &str = "clips";

/// Map of device ID → { orderKey, type, ref? }
pub const KEY_DEVICES: &str = "devices";

/// Map of automation lane ID → { paramPath, ref? }
pub const KEY_AUTOMATION_LANES: &str = "automationLanes";

// -- Clip document keys --

pub const KEY_CLIP: &str = "clip";
pub const KEY_START: &str = "start";
pub const KEY_LENGTH: &str = "length";
pub const KEY_OFFSET: &str = "offset";
pub const KEY_LOOP: &str = "loop";

/// Map of note ID → note data (for MIDI clips)
pub const KEY_NOTES: &str = "notes";

pub const KEY_PITCH: &str = "pitch";
pub const KEY_VELOCITY: &str = "velocity";
pub const KEY_CHANNEL: &str = "channel";

// -- Automation document keys --

pub const KEY_AUTOMATION: &str = "automation";
pub const KEY_PARAM_PATH: &str = "paramPath";

/// Map of point ID → { time, value, curve, orderKey }
pub const KEY_POINTS: &str = "points";

pub const KEY_TIME: &str = "time";
pub const KEY_VALUE: &str = "value";
pub const KEY_CURVE: &str = "curve";

// -- Shared keys --

/// Fractional order key for sorted collections
pub const KEY_ORDER_KEY: &str = "orderKey";

/// Reference to a child document
pub const KEY_REF: &str = "ref";

// -- Document ID prefixes --

pub const DOC_PREFIX_ROOT: &str = "root";
pub const DOC_PREFIX_TRACK: &str = "track";
pub const DOC_PREFIX_CLIP: &str = "clip";
pub const DOC_PREFIX_AUTOMATION: &str = "auto";

/// Generate a document ID for a track.
pub fn track_doc_id(track_id: &str) -> DocId {
    format!("{}_{}", DOC_PREFIX_TRACK, track_id)
}

/// Generate a document ID for a clip.
pub fn clip_doc_id(clip_id: &str) -> DocId {
    format!("{}_{}", DOC_PREFIX_CLIP, clip_id)
}

/// Generate a document ID for an automation lane.
pub fn automation_doc_id(lane_id: &str) -> DocId {
    format!("{}_{}", DOC_PREFIX_AUTOMATION, lane_id)
}
