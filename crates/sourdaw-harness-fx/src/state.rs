//! The state chunk both front ends save and load.
//!
//! Beside the one restorable value, `Gain`, the chunk carries the process mode
//! the host gave the instance, so a host test observes the mode through the
//! ordinary state read rather than through a side channel. Loading restores
//! only `Gain`: the mode is a record of what the host did, not a setting.

const MAGIC: &[u8; 4] = b"SDFX";
const MAGIC_BYTES: usize = 4;
const GAIN_BYTES: usize = 8;
const MODE_BYTES: usize = 4;
/// The number of bytes one chunk occupies.
pub(crate) const CHUNK_BYTES: usize = MAGIC_BYTES + GAIN_BYTES + 2 * MODE_BYTES;

/// The mode field of an instance the host never told anything.
pub const MODE_NEVER_SET: i32 = -1;

/// What one saved chunk records.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RecordedState {
    pub gain: f64,
    /// CLAP: the mode `clap.render`'s `set` was last called with, in
    /// `CLAP_RENDER_*` values. VST3: the `processMode` of the last
    /// `setupProcessing`, in `ProcessModes_` values.
    pub configured_mode: i32,
    /// VST3: the `processMode` of the last `ProcessData`. CLAP carries no
    /// per-block mode, so a CLAP instance always records [`MODE_NEVER_SET`].
    pub last_block_mode: i32,
}

pub fn encode(state: RecordedState) -> Vec<u8> {
    let mut chunk = Vec::with_capacity(CHUNK_BYTES);
    chunk.extend_from_slice(MAGIC);
    chunk.extend_from_slice(&state.gain.to_le_bytes());
    chunk.extend_from_slice(&state.configured_mode.to_le_bytes());
    chunk.extend_from_slice(&state.last_block_mode.to_le_bytes());
    chunk
}

/// The chunk's fields, or `None` for bytes this plugin did not write.
pub fn decode(chunk: &[u8]) -> Option<RecordedState> {
    if chunk.len() != CHUNK_BYTES {
        return None;
    }
    let (magic, rest) = chunk.split_at(MAGIC_BYTES);
    if magic != MAGIC {
        return None;
    }
    let (gain, modes) = rest.split_at(GAIN_BYTES);
    let (configured, last_block) = modes.split_at(MODE_BYTES);
    Some(RecordedState {
        gain: f64::from_le_bytes(gain.try_into().ok()?),
        configured_mode: i32::from_le_bytes(configured.try_into().ok()?),
        last_block_mode: i32::from_le_bytes(last_block.try_into().ok()?),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_chunk_round_trips_every_field() {
        let state = RecordedState {
            gain: 0.25,
            configured_mode: 2,
            last_block_mode: MODE_NEVER_SET,
        };

        assert_eq!(decode(&encode(state)), Some(state));
    }

    #[test]
    fn bytes_this_plugin_did_not_write_are_refused() {
        let mut chunk = encode(RecordedState {
            gain: 0.25,
            configured_mode: 0,
            last_block_mode: 0,
        });
        chunk[0] = b'X';

        assert_eq!(decode(&chunk), None);
        assert_eq!(decode(&chunk[..CHUNK_BYTES - 1]), None);
    }
}
