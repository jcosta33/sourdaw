pub mod audio_decode;

pub use audio_decode::{
    decode_audio_file, decode_audio_file_bytes, get_audio_file_metadata, AudioStreamMeta,
    DecodedAudio,
};
