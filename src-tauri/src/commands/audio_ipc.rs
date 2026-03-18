use crate::state::AppState;

/// Receives a block of interleaved f32 audio from the browser AudioWorklet,
/// runs it through the plugin's process() method, and returns the processed audio.
///
/// The data format is:
/// - instance_id: identifies which plugin to process through
/// - body: raw bytes representing interleaved f32 stereo samples
#[tauri::command]
pub async fn audio_ipc(
    instance_id: String,
    body: Vec<u8>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<u8>, String> {
    // Convert incoming bytes to f32 samples
    if body.len() % 4 != 0 {
        return Err("Audio data must be aligned to 4 bytes (f32)".to_string());
    }

    let num_samples = body.len() / 4;
    let input_f32: Vec<f32> = body
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect();

    // Split interleaved stereo into separate channels
    let samples_per_channel = num_samples / 2;
    let mut left_in = vec![0.0f32; samples_per_channel];
    let mut right_in = vec![0.0f32; samples_per_channel];

    for i in 0..samples_per_channel {
        left_in[i] = input_f32.get(i * 2).copied().unwrap_or(0.0);
        right_in[i] = input_f32.get(i * 2 + 1).copied().unwrap_or(0.0);
    }

    // Process through the plugin
    let mut left_out = vec![0.0f32; samples_per_channel];
    let mut right_out = vec![0.0f32; samples_per_channel];

    {
        let mut plugins = state.plugins.lock()
            .map_err(|e| format!("Failed to lock plugins: {}", e))?;

        if let Some(instance) = plugins.get_mut(&instance_id) {
            let inputs: &[&[f32]] = &[&left_in, &right_in];
            let outputs: &mut [&mut [f32]] = &mut [&mut left_out, &mut right_out];
            instance.plugin.process(inputs, outputs, samples_per_channel);
        } else {
            // No plugin found — passthrough
            left_out.copy_from_slice(&left_in);
            right_out.copy_from_slice(&right_in);
        }
    }

    // Interleave output back to stereo
    let mut output_f32 = Vec::with_capacity(num_samples);
    for i in 0..samples_per_channel {
        output_f32.push(left_out[i]);
        output_f32.push(right_out[i]);
    }

    // Convert f32 to bytes
    let output_bytes: Vec<u8> = output_f32
        .iter()
        .flat_map(|f| f.to_le_bytes())
        .collect();

    Ok(output_bytes)
}
