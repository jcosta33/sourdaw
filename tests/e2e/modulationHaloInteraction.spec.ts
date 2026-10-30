import { expect, test, type Locator, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function dragTo(page: Page, source: Locator, target: Locator): Promise<void> {
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    if (!sourceBox || !targetBox) {
        throw new Error('Modulation drag source and target must be visible');
    }
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 20 });
}

async function mappingState(page: Page) {
    return page.evaluate(async () => {
        const { modulationStore } = await import('/src/modules/Automation/stores/index.ts');
        return structuredClone(modulationStore.value?.modulators ?? []);
    });
}

test('source halos, transient drag preview and stored eligibility follow live modulation', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await setupWorkspace(page);
    await launch_new_project(page);
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();

    const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
    await inspector.getByRole('button', { name: 'Add device' }).click();
    await page.getByRole('menuitem', { name: /^Phaser$/ }).click();
    await expect(inspector.getByRole('button', { name: /Bypass Phaser/ })).toBeVisible();
    await inspector.getByText('Phaser', { exact: true }).click();
    const target = inspector.getByRole('region', { name: 'Modulation target for Rate' });
    const knob = target.getByRole('slider', { name: 'Rate' });
    await expect(target).toBeVisible();
    await expect(knob).toBeVisible();

    const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
    if ((await dock.getAttribute('aria-pressed')) === 'false') {
        await dock.click();
    }
    await page.getByRole('tab', { name: 'Modulation', exact: true }).click();
    const matrix = page.getByRole('region', { name: 'Modulation matrix' });
    await expect(matrix).toBeVisible();
    for (const name of ['First LFO', 'Second LFO']) {
        await matrix.getByRole('button', { name: 'New Modulator', exact: true }).click();
        await matrix.getByRole('textbox', { name: 'Modulator name' }).fill(name);
        await matrix.getByRole('button', { name: 'Add', exact: true }).click();
        await expect(matrix.getByRole('button', { name: `Drag modulator ${name} to a parameter` })).toBeVisible();
    }
    const initial = await mappingState(page);
    expect(initial).toHaveLength(2);
    const first = initial.find((modulator) => modulator.name === 'First LFO');
    const second = initial.find((modulator) => modulator.name === 'Second LFO');
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) throw new Error('Both created modulators must exist');
    expect(first.mappings).toHaveLength(0);
    expect(second.mappings).toHaveLength(0);
    const firstHandle = matrix.getByRole('button', { name: 'Drag modulator First LFO to a parameter' });
    const secondHandle = matrix.getByRole('button', { name: 'Drag modulator Second LFO to a parameter' });
    const firstHalo = target.locator(`[data-modulation-halo="${first.id}"]`);
    const secondHalo = target.locator(`[data-modulation-halo="${second.id}"]`);

    await dragTo(page, firstHandle, target);
    await expect(firstHalo).toHaveAttribute('data-preview', 'true');
    const previewColor = await firstHalo.evaluate((element) => getComputedStyle(element).backgroundImage);
    await page.mouse.move(10, 10, { steps: 10 });
    await expect(firstHalo).toHaveCount(0);
    await page.mouse.up();
    expect((await mappingState(page)).flatMap((modulator) => modulator.mappings)).toHaveLength(0);

    await dragTo(page, firstHandle, target);
    await expect(firstHalo).toHaveAttribute('data-preview', 'true');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(firstHalo).toHaveCount(0);
    expect((await mappingState(page)).flatMap((modulator) => modulator.mappings)).toHaveLength(0);

    await dragTo(page, firstHandle, target);
    await expect(firstHalo).toHaveAttribute('data-preview', 'true');
    await page.mouse.up();
    await expect.poll(async () => (await mappingState(page)).flatMap((modulator) => modulator.mappings).length).toBe(1);
    await expect(firstHalo).not.toHaveAttribute('data-preview', 'true');
    expect(await firstHalo.evaluate((element) => getComputedStyle(element).backgroundImage)).toBe(previewColor);

    await dragTo(page, secondHandle, target);
    await expect(secondHalo).toHaveAttribute('data-preview', 'true');
    await page.mouse.up();
    await expect.poll(async () => (await mappingState(page)).flatMap((modulator) => modulator.mappings).length).toBe(2);
    await expect(secondHalo).not.toHaveAttribute('data-preview', 'true');
    expect(await secondHalo.evaluate((element) => getComputedStyle(element).backgroundImage)).not.toBe(previewColor);
    const before = await knob.getAttribute('aria-valuenow');
    await knob.focus();
    await page.keyboard.press('ArrowUp');
    await expect(knob).not.toHaveAttribute('aria-valuenow', before!);
    expect((await mappingState(page)).flatMap((modulator) => modulator.mappings)).toHaveLength(2);

    const legacy = await page.evaluate(
        async ({ sourceId }) => {
            const [{ buildProjectData }, { applyImportedProjectData }, { trackStore }] = await Promise.all([
                import('/src/modules/Project/useCases/projectPersistence/fileIO/buildProjectData.ts'),
                import('/src/modules/Project/useCases/projectPersistence/fileIO/applyImportedProjectData.ts'),
                import('/src/modules/Arrangement/stores/index.ts'),
            ]);
            const snapshot = await buildProjectData();
            const track = trackStore.value?.tracks.find((candidate) =>
                candidate.devices.some((device) => device.type === 'builtin-phaser')
            );
            const device = track?.devices.find((candidate) => candidate.type === 'builtin-phaser');
            const source = snapshot?.data.modulation?.modulators.find((modulator) => modulator.id === sourceId);
            if (!snapshot || !track || !device || !source)
                throw new Error('Legacy fixture requires the real project, Phaser and LFO');
            const mapping = {
                targetTrackId: track.id,
                targetDeviceId: device.id,
                targetParamId: 'phaser-stages',
                amount: 0.5,
            };
            source.mappings.push(mapping);
            const imported = await applyImportedProjectData({ data: snapshot.data });
            return { imported, mapping };
        },
        { sourceId: first.id }
    );
    expect(legacy.imported).toBe(true);
    const proof = await page.evaluate(
        async ({ mapping, sourceId }) => {
            const [{ applyModulation }, { resolveModulationBinding }, { modulationRuntimeStore, modulationStore }] =
                await Promise.all([
                    import('/src/modules/Automation/useCases/modulation/applyModulation.ts'),
                    import('/src/modules/Automation/useCases/modulation/resolveModulationBinding.ts'),
                    import('/src/modules/Automation/stores/index.ts'),
                ]);
            applyModulation(0);
            return {
                runtime: modulationRuntimeStore.value?.runtimeValues[sourceId],
                binding: resolveModulationBinding(mapping),
                stored: modulationStore.value?.modulators.find((modulator) => modulator.id === sourceId)?.mappings,
            };
        },
        { mapping: legacy.mapping, sourceId: first.id }
    );
    expect(proof.runtime).toBeGreaterThan(0);
    expect(proof.binding).toBeNull();
    expect(proof.stored).toContainEqual(legacy.mapping);
    await expect(inspector.getByRole('region', { name: 'Modulation target for Stages' })).toHaveCount(0);
    const stages = inspector.getByRole('slider', { name: 'Stages' });
    await expect(stages).toBeVisible();
    await expect(stages.locator('[data-modulation-halo]')).toHaveCount(0);
    await expect(target.locator(`[data-modulation-halo="${first.id}"]`)).toBeVisible();
});
