pub mod audio_decode;

pub use audio_decode::{DecodedAudio, AudioStreamMeta, decode_audio_file, decode_audio_file_bytes, get_audio_file_metadata};
