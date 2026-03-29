pub mod scheduler;
pub mod audio_thread;

use rtrb::{RingBuffer, Producer};
use scheduler::GraphCommand;
use audio_thread::{spawn_audio_thread, AudioThreadHandle};
use std::sync::{Arc, Mutex};

pub struct EngineHandle {
    command_tx: Producer<GraphCommand>,
    _audio_thread: Arc<Mutex<AudioThreadHandle>>,
}

impl EngineHandle {
    /// Boot the native audio engine (spawns CPAL stream)
    pub fn new() -> Result<Self, String> {
        // Create lock-free ring buffer for 256 pending commands
        let (tx, rx) = RingBuffer::new(256);
        
        // Spawn real-time audio thread strictly locking on CPAL host
        let thread_handle = spawn_audio_thread(rx)?;

        Ok(Self {
            command_tx: tx,
            _audio_thread: Arc::new(Mutex::new(thread_handle)),
        })
    }

    /// Add an effect to the native rendering graph lock-free
    pub fn add_effect(&mut self, id: usize, plugin_type: &str) -> Result<(), String> {
        self.command_tx.push(GraphCommand::AddEffect(id, plugin_type.to_string()))
            .map_err(|_| "Audio command queue full".to_string())
    }

    /// Update an effect parameter natively
    pub fn set_effect_param(&mut self, id: usize, param: &str, value: f32) -> Result<(), String> {
        self.command_tx.push(GraphCommand::SetParam(id, param.to_string(), value))
            .map_err(|_| "Audio command queue full".to_string())
    }
}
