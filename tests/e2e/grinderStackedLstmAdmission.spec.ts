import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const single_layer = readFileSync(
    new URL('../../crates/daw-dsp/src/grinder/nam/fixtures/lstm.nam', import.meta.url),
    'utf8'
);

function lstm_capture(num_layers: number, hidden_size: number): string {
    let weight_count = hidden_size + 1;
    for (let layer = 0; layer < num_layers; layer++) {
        const input_size = layer === 0 ? 1 : hidden_size;
        // Cell matrix, gate biases, initial hidden/cell states, then mono head.
        weight_count += 4 * hidden_size * (input_size + hidden_size) + 6 * hidden_size;
    }
    return JSON.stringify({
        version: '0.5.4',
        architecture: 'LSTM',
        config: { num_layers, input_size: 1, hidden_size, out_channels: 1 },
        weights: Array.from({ length: weight_count }, (_, index) => Math.sin(index + 1) * 0.2),
        sample_rate: 48_000,
        metadata: { name: 'Stacked mono capture' },
    });
}

async function import_nam(page: Page, name: string, text: string): Promise<void> {
    const picker = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import NAM', exact: true }).click();
    await (await picker).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
    await expect(page.getByRole('button', { name: 'Import NAM', exact: true })).toBeEnabled();
}

test('Import NAM reports the unsupported topology and retains the selected capture', async ({ page }) => {
    await setupWorkspace(page);
    await launch_new_project(page);
    await page.locator('button').filter({ hasText: 'Audio' }).filter({ hasText: 'Record or import' }).click();
    await page.getByLabel('Add device', { exact: true }).click();
    await page.getByRole('menuitem', { name: /Grinder/i }).click();
    await expect(page.getByRole('button', { name: 'Bypass Grinder' })).toBeVisible();
    await page.getByText('Grinder', { exact: true }).dblclick();
    await expect(page.getByRole('button', { name: 'Close Grinder' })).toBeVisible();
    await page.getByRole('group', { name: 'Effect control detail' }).getByRole('button', { name: 'route' }).click();
    await page.getByRole('group', { name: 'Grinder sections' }).getByRole('button', { name: 'Neural' }).click();

    await import_nam(page, 'single-layer.nam', single_layer);
    const retained = page.getByRole('button', { name: /Test LSTM 48000 Hz NAM import/ });
    await expect(retained).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Remove capture', exact: true })).toHaveCount(1);

    await import_nam(page, 'stacked-wide.nam', lstm_capture(2, 2));

    await expect(
        page.getByText('Invalid NAM model: stacked wide LSTM unsupported by current runtime', { exact: true })
    ).toBeVisible();
    await expect(retained).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Remove capture', exact: true })).toHaveCount(1);

    await import_nam(page, 'stacked-mono.nam', lstm_capture(2, 1));
    await expect(page.getByRole('button', { name: /Stacked mono capture 48000 Hz NAM import/ })).toHaveAttribute(
        'aria-pressed',
        'true'
    );
    await expect(retained).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: 'Remove capture', exact: true })).toHaveCount(2);
});

test('rebuilt WASM refuses stacked wide LSTM while the previous capture keeps rendering', async ({
    page,
}, test_info) => {
    await page.route('/', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
    await page.goto('/');
    const result = await page.evaluate(
        async ({ single_layer, unsupported, stacked_mono }) => {
            const dsp = await import('/src/modules/AudioEngine/wasm/daw_dsp.js');
            const bytes = await (await fetch('/wasm/daw-dsp/daw_dsp_bg.wasm')).arrayBuffer();
            const exports = dsp.initSync({ module: bytes });
            const instances = Array.from({ length: 5 }, () => new dsp.GrinderInstance(48_000));
            const [actual, reference, dry, supported, empty] = instances;
            for (const engine of instances) {
                engine.set_param('engineMode', 1);
                engine.set_param('neuralPlacement', 1);
                engine.set_param('gateEnabled', 0);
            }
            function refusal(engine: typeof actual): string {
                try {
                    engine.load_neural_model(unsupported);
                    return '';
                } catch (error) {
                    return String(error);
                }
            }
            function process(engine: typeof actual, offset: number): number[] {
                const input = Float32Array.from({ length: 128 }, (_, index) => Math.sin((offset + index) * 0.07) * 0.1);
                new Float32Array(exports.memory.buffer, engine.get_input_left_ptr(), 128).set(input);
                new Float32Array(exports.memory.buffer, engine.get_input_right_ptr(), 128).set(input);
                engine.process(128);
                return Array.from(new Float32Array(exports.memory.buffer, engine.get_output_left_ptr(), 128));
            }
            try {
                const empty_error = refusal(empty);
                const empty_loaded = empty.has_loaded_neural_model();
                actual.load_neural_model(single_layer);
                reference.load_neural_model(single_layer);
                supported.load_neural_model(stacked_mono);
                for (let block = 0; block < 32; block++) {
                    for (const engine of [actual, reference, dry, supported]) process(engine, block * 128);
                }
                const replacement_error = refusal(actual);
                let retention_delta = 0;
                let dry_delta = 0;
                let peak = 0;
                let supported_peak = 0;
                const pcm: number[] = [];
                for (let block = 32; block < 64; block++) {
                    const output = process(actual, block * 128);
                    const expected = process(reference, block * 128);
                    const unloaded = process(dry, block * 128);
                    const supported_output = process(supported, block * 128);
                    for (let index = 0; index < output.length; index++) {
                        retention_delta = Math.max(retention_delta, Math.abs(output[index] - expected[index]));
                        dry_delta = Math.max(dry_delta, Math.abs(output[index] - unloaded[index]));
                        peak = Math.max(peak, Math.abs(output[index]));
                        supported_peak = Math.max(supported_peak, Math.abs(supported_output[index]));
                    }
                    pcm.push(...output);
                }
                // Play the generated PCM through Chromium's actual offline audio graph.
                const context = new OfflineAudioContext(1, pcm.length, 48_000);
                const buffer = context.createBuffer(1, pcm.length, 48_000);
                buffer.getChannelData(0).set(pcm);
                const source = context.createBufferSource();
                source.buffer = buffer;
                source.connect(context.destination);
                source.start();
                const rendered = await context.startRendering();
                const playback = Array.from(rendered.getChannelData(0));
                return {
                    empty_error,
                    empty_loaded,
                    replacement_error,
                    retained_loaded: actual.has_loaded_neural_model(),
                    supported_loaded: supported.has_loaded_neural_model(),
                    retention_delta,
                    dry_delta,
                    peak,
                    supported_peak,
                    finite: pcm.every(Number.isFinite) && playback.every(Number.isFinite),
                    playback_peak: Math.max(...playback.map(Math.abs)),
                    nan_flushes: instances.reduce((sum, engine) => sum + engine.get_nan_flush_count(), 0).toString(),
                    frames: pcm.length,
                };
            } finally {
                for (const engine of instances) engine.free();
            }
        },
        { single_layer, unsupported: lstm_capture(2, 2), stacked_mono: lstm_capture(2, 1) }
    );

    await test_info.attach('real-wasm-admission-and-pcm.json', {
        body: JSON.stringify(result, null, 2),
        contentType: 'application/json',
    });
    expect(result.empty_error).toContain('stacked wide LSTM unsupported by current runtime');
    expect(result.empty_loaded).toBe(false);
    expect(result.replacement_error).toContain('stacked wide LSTM unsupported by current runtime');
    expect(result.retained_loaded).toBe(true);
    expect(result.supported_loaded).toBe(true);
    expect(result.retention_delta).toBe(0);
    expect(result.dry_delta).toBeGreaterThan(0.001);
    expect(result.peak).toBeGreaterThan(0.0001);
    expect(result.supported_peak).toBeGreaterThan(0.0001);
    expect(result.finite).toBe(true);
    expect(result.playback_peak).toBeGreaterThan(0.0001);
    expect(result.nan_flushes).toBe('0');
    expect(result.frames).toBe(4096);
});
