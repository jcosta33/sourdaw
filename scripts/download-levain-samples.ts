#!/usr/bin/env node
/**
 * download-levain-samples.mjs
 *
 * Downloads VSCO-2-CE orchestral samples from GitHub (CC0 — public domain)
 * and generates manifest.json files for the Levain plugin.
 *
 * Usage:
 *   node scripts/download-levain-samples.ts --print-asset-policy
 *   SOURDAW_ALLOW_PUBLIC_SAMPLE_DOWNLOAD=1 node scripts/download-levain-samples.ts
 *
 * Source: https://github.com/sgossner/VSCO-2-CE
 * License: CC0 (public domain — no attribution required)
 */

import { existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { LEVAIN_SOURCE } from './levainSource.ts';

const VSCO_REVISION = LEVAIN_SOURCE.revision;
const BASE_URL = `https://raw.githubusercontent.com/sgossner/VSCO-2-CE/${VSCO_REVISION}`;
const OUT_DIR = 'public/samples/levain';
const PUBLIC_SAMPLE_DOWNLOAD_OPT_IN_ENV = 'SOURDAW_ALLOW_PUBLIC_SAMPLE_DOWNLOAD';
const PRINT_ASSET_POLICY_FLAG = '--print-asset-policy';
const PUBLIC_SAMPLE_ASSET_POLICY = [
    'Sourdaw public sample asset policy:',
    '- public/samples/levain is a large generated CC0 sample payload.',
    '- Do not add, refresh, or expand this payload accidentally from an agent or CI run.',
    '- Existing tracked files are not deleted or moved without explicit human instruction naming files.',
    `- Set ${PUBLIC_SAMPLE_DOWNLOAD_OPT_IN_ENV}=1 only for an intentional sample-payload refresh.`,
].join('\n');

function shouldContinueWithPublicSampleDownload(): boolean {
    if (process.argv.includes(PRINT_ASSET_POLICY_FLAG)) {
        console.log(PUBLIC_SAMPLE_ASSET_POLICY);
        return false;
    }

    if (process.env[PUBLIC_SAMPLE_DOWNLOAD_OPT_IN_ENV] === '1') {
        return true;
    }

    console.error(PUBLIC_SAMPLE_ASSET_POLICY);
    console.error(`\nRefusing to write ${OUT_DIR}; set ${PUBLIC_SAMPLE_DOWNLOAD_OPT_IN_ENV}=1 to continue.`);
    process.exitCode = 1;
    return false;
}

// ─── Note name → MIDI number ───────────────────────────────────────────────

const NOTE_NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function noteNameToMidi(name) {
    // e.g. "A3", "C4", "Eb4", "F#5"
    const m = name.match(/^([A-G])(b|#?)(\d+)$/);
    if (!m) return null;
    const [, letter, accidental, octStr] = m;
    const semitone = NOTE_NAMES[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
    const octave = parseInt(octStr, 10);
    return (octave + 1) * 12 + semitone;
}

// ─── Parse VSCO-2-CE filename into note + velocity layer + round robin ────

function parseVscoFilename(filename) {
    const base = filename.replace('.wav', '');
    const parts = base.split('_');

    // Extract round-robin position (last part if _rr{n})
    let rrPos = 0;
    let rrLen = 1;
    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart.match(/^rr(\d+)$/i)) {
        rrPos = parseInt(lastPart.replace(/^rr/i, ''), 10) - 1; // 0-indexed
        parts.pop();
    }

    // Extract velocity layer (last remaining part if _v{n} or _p/_f/_mf etc.)
    const velPart = parts[parts.length - 1];
    let velIndex = 0;
    let dynamic;
    if (velPart && velPart.match(/^v(\d+)$/i)) {
        velIndex = parseInt(velPart.replace(/^v/i, ''), 10) - 1; // 0-indexed
        dynamic = `v${velIndex + 1}`;
        parts.pop();
    } else if (velPart && ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'].includes(velPart)) {
        dynamic = velPart;
        parts.pop();
    } else {
        dynamic = 'v1';
    }

    // Note is now the last remaining part
    const notePart = parts[parts.length - 1];
    if (!notePart) return null;

    const midi = noteNameToMidi(notePart);
    if (midi === null) return null;

    return { noteName: notePart, midi, dynamic, rrPos, rrLen, velIndex };
}

// ─── Dynamic → velocity range ─────────────────────────────────────────────

const DYNAMIC_ORDER = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8'];

function dynamicsToVelLayers(dynamics) {
    // Sort by dynamic order
    const sorted = [...dynamics].sort((a, b) => DYNAMIC_ORDER.indexOf(a) - DYNAMIC_ORDER.indexOf(b));
    const count = sorted.length;
    return sorted.map((d, i) => ({
        dynamic: d,
        loVel: Math.round((i / count) * 127),
        hiVel: Math.round(((i + 1) / count) * 127) - (i < count - 1 ? 1 : 0),
    }));
}

// ─── Build key ranges from a sorted list of MIDI root notes ──────────────

function buildKeyRanges(sortedMidis, instrumentRange) {
    const [rangeMin, rangeMax] = instrumentRange;
    return sortedMidis.map((midi, i) => {
        const prev = sortedMidis[i - 1];
        const next = sortedMidis[i + 1];
        const loKey = prev !== undefined ? Math.round((prev + midi) / 2) + 1 : rangeMin;
        const hiKey = next !== undefined ? Math.round((midi + next) / 2) : rangeMax;
        return { midi, loKey, hiKey };
    });
}

// ─── Fetch file list from GitHub API ──────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listGitHubDir(path) {
    await sleep(200); // avoid GitHub API rate limiting (60 req/hr unauthenticated)
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const apiUrl = `https://api.github.com/repos/sgossner/VSCO-2-CE/contents/${encoded}?ref=${VSCO_REVISION}`;
    const res = await fetch(apiUrl);
    if (!res.ok) {
        const remaining = res.headers.get('x-ratelimit-remaining');
        const reset = res.headers.get('x-ratelimit-reset');
        if (res.status === 403 && remaining === '0') {
            const resetDate = reset ? new Date(parseInt(reset) * 1000).toLocaleTimeString() : 'unknown';
            throw new Error(`GitHub API rate limit exceeded. Resets at ${resetDate}. Re-run after that time.`);
        }
        throw new Error(`GitHub API error for ${path}: ${res.status}`);
    }
    return res.json();
}

// ─── Download a single WAV file ───────────────────────────────────────────

async function downloadFile(remotePath, localPath) {
    if (existsSync(localPath)) return false; // skip if already downloaded
    // Properly encode each path segment (handles spaces, # etc.)
    const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/');
    const url = `${BASE_URL}/${encodedPath}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${url} (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(localPath, buf);
    return true;
}

// ─── Build a manifest for one articulation set ────────────────────────────

function buildManifest(instrumentId, articulations, micPositions = ['close']) {
    return {
        version: 1,
        instrumentId,
        sampleRate: 44100,
        micPositions,
        articulations,
    };
}

// ─── Instrument definitions ───────────────────────────────────────────────

/**
 * Each instrument entry:
 *   id           - our instrumentId
 *   keyRange     - [loMidi, hiMidi]
 *   articulations - array of { type, id, vscoPath, loopMode }
 */
const INSTRUMENTS = [
    {
        id: 'violin-1',
        keyRange: [55, 103], // G3–G7
        articulations: [
            { type: 'sustain', id: 0, vscoPath: 'Strings/Solo Violin/Arco Vib', loopMode: 'forward' },
            { type: 'spiccato', id: 7, vscoPath: 'Strings/Solo Violin/spic', loopMode: 'none' },
            { type: 'pizzicato', id: 10, vscoPath: 'Strings/Solo Violin/Pizz', loopMode: 'none' },
            { type: 'tremolo', id: 13, vscoPath: 'Strings/Solo Violin/Trem', loopMode: 'forward' },
        ],
    },
    {
        id: 'violin-2',
        keyRange: [55, 103],
        articulations: [
            { type: 'sustain', id: 0, vscoPath: 'Strings/Violin Section/susVib', loopMode: 'forward' },
            { type: 'spiccato', id: 7, vscoPath: 'Strings/Violin Section/Spic', loopMode: 'none' },
            { type: 'pizzicato', id: 10, vscoPath: 'Strings/Violin Section/Pizz', loopMode: 'none' },
            { type: 'tremolo', id: 13, vscoPath: 'Strings/Violin Section/Trem', loopMode: 'forward' },
        ],
    },
    {
        id: 'viola',
        keyRange: [48, 93], // C3–A6
        articulations: [
            { type: 'sustain', id: 0, vscoPath: 'Strings/Viola Section/susvib', loopMode: 'forward' },
            { type: 'spiccato', id: 7, vscoPath: 'Strings/Viola Section/spic', loopMode: 'none' },
            { type: 'pizzicato', id: 10, vscoPath: 'Strings/Viola Section/pizz', loopMode: 'none' },
        ],
    },
    {
        id: 'cello',
        keyRange: [36, 84], // C2–C6
        articulations: [
            { type: 'sustain', id: 0, vscoPath: 'Strings/Cello Section/susvib', loopMode: 'forward' },
            { type: 'spiccato', id: 7, vscoPath: 'Strings/Cello Section/spic', loopMode: 'none' },
            { type: 'pizzicato', id: 10, vscoPath: 'Strings/Cello Section/pizzT', loopMode: 'none' },
        ],
    },
    {
        id: 'double-bass',
        keyRange: [28, 67], // E1–G4
        articulations: [
            { type: 'sustain', id: 0, vscoPath: 'Strings/Solo Contrabass/SusVib', loopMode: 'forward' },
            { type: 'pizzicato', id: 10, vscoPath: 'Strings/Solo Contrabass/Pizz', loopMode: 'none' },
            { type: 'spiccato', id: 7, vscoPath: 'Strings/Solo Contrabass/Spic', loopMode: 'none' },
        ],
    },
    {
        id: 'trumpet',
        keyRange: [54, 82],
        articulations: [
            { type: 'sustain', id: 0, vscoPath: 'Brass/Trumpet/susvib', loopMode: 'forward' },
            { type: 'staccato', id: 8, vscoPath: 'Brass/Trumpet/stac', loopMode: 'none' },
        ],
    },
    {
        id: 'horn',
        keyRange: [34, 77],
        articulations: [
            { type: 'sustain', id: 0, vscoPath: 'Brass/F Horn/sus', loopMode: 'forward' },
            { type: 'staccato', id: 8, vscoPath: 'Brass/F Horn/stac', loopMode: 'none' },
        ],
    },
    {
        id: 'trombone',
        keyRange: [40, 72],
        articulations: [
            { type: 'sustain', id: 0, vscoPath: 'Brass/Tenor Trombone/sus', loopMode: 'forward' },
            { type: 'staccato', id: 8, vscoPath: 'Brass/Tenor Trombone/stac', loopMode: 'none' },
        ],
    },
    {
        id: 'tuba',
        keyRange: [28, 60],
        articulations: [
            { type: 'sustain', id: 0, vscoPath: 'Brass/Tuba/sus', loopMode: 'forward' },
            { type: 'staccato', id: 8, vscoPath: 'Brass/Tuba/stac', loopMode: 'none' },
        ],
    },
    {
        id: 'flute',
        keyRange: [60, 96],
        articulations: [
            { type: 'sustain', id: 0, vscoPath: 'Woodwinds/Flute/susvib', loopMode: 'forward' },
            { type: 'staccato', id: 8, vscoPath: 'Woodwinds/Flute/stac', loopMode: 'none' },
        ],
    },
    {
        id: 'oboe',
        keyRange: [58, 91],
        articulations: [
            { type: 'sustain', id: 0, vscoPath: 'Woodwinds/Oboe/Sus', loopMode: 'forward' },
            { type: 'staccato', id: 8, vscoPath: 'Woodwinds/Oboe/Stacc', loopMode: 'none' },
        ],
    },
    {
        id: 'clarinet',
        keyRange: [50, 91],
        articulations: [
            { type: 'sustain', id: 0, vscoPath: 'Woodwinds/Clarinet/susLong', loopMode: 'forward' },
            { type: 'staccato', id: 8, vscoPath: 'Woodwinds/Clarinet/stac', loopMode: 'none' },
        ],
    },
    {
        id: 'bassoon',
        keyRange: [34, 75],
        articulations: [
            { type: 'sustain', id: 0, vscoPath: 'Woodwinds/Bassoon/sus', loopMode: 'forward' },
            { type: 'staccato', id: 8, vscoPath: 'Woodwinds/Bassoon/stac', loopMode: 'none' },
        ],
    },
    {
        id: 'glockenspiel',
        keyRange: [72, 108],
        articulations: [{ type: 'sustain', id: 0, vscoPath: 'Percussion/Glock', loopMode: 'none' }],
    },
    {
        id: 'marimba',
        keyRange: [45, 96],
        articulations: [{ type: 'sustain', id: 0, vscoPath: 'Percussion/Marimba', loopMode: 'none' }],
    },
    {
        id: 'timpani',
        keyRange: [36, 57], // C2–A3
        articulations: [{ type: 'sustain', id: 0, vscoPath: 'Percussion/Timpani', loopMode: 'none' }],
    },
];

// ─── Process one instrument articulation directory ────────────────────────

async function processArticulation(vscoPath, artType, artId, loopMode, instrumentRange, outDir) {
    console.log(`  Fetching file list: ${vscoPath}`);
    let entries;
    try {
        entries = await listGitHubDir(vscoPath);
    } catch (e) {
        console.warn(`  ⚠️  Could not list ${vscoPath}: ${e.message}`);
        return null;
    }

    const wavFiles = entries.filter((e) => e.name.toLowerCase().endsWith('.wav'));
    if (wavFiles.length === 0) {
        console.warn(`  ⚠️  No WAV files in ${vscoPath}`);
        return null;
    }

    // Parse all filenames to note + dynamic
    const parsed = [];
    for (const f of wavFiles) {
        const info = parseVscoFilename(f.name);
        if (info) {
            parsed.push({ ...info, filename: f.name, downloadUrl: f.download_url });
        }
    }

    if (parsed.length === 0) {
        console.warn(`  ⚠️  Could not parse any filenames in ${vscoPath}`);
        return null;
    }

    // Group by note midi, then by dynamic, keeping all RR positions
    const byNote = new Map();
    for (const p of parsed) {
        if (!byNote.has(p.midi)) byNote.set(p.midi, []);
        byNote.get(p.midi).push(p);
    }

    // Get unique dynamics in this articulation
    const allDynamics = [...new Set(parsed.map((p) => p.dynamic))];
    const velLayers = dynamicsToVelLayers(allDynamics);

    // Build sorted note list and key ranges
    const sortedMidis = [...byNote.keys()].sort((a, b) => a - b);
    const keyRanges = buildKeyRanges(sortedMidis, instrumentRange);

    // Download files and build zone list
    const zones = [];
    let downloadCount = 0;
    let skipCount = 0;

    for (const { midi, loKey, hiKey } of keyRanges) {
        const noteSamples = byNote.get(midi) || [];

        for (const velLayer of velLayers) {
            // Get all RR positions for this note+dynamic
            const rrSamples = noteSamples
                .filter((s) => s.dynamic === velLayer.dynamic)
                .sort((a, b) => a.rrPos - b.rrPos);

            if (rrSamples.length === 0) continue;

            const rrLen = rrSamples.length;

            for (const sample of rrSamples) {
                const localFilename = sample.filename;
                const localPath = join(outDir, localFilename);
                const downloaded = await downloadFile(`${vscoPath}/${sample.filename}`, localPath);
                if (downloaded) downloadCount++;
                else skipCount++;

                zones.push({
                    file: localFilename,
                    rootNote: midi,
                    loKey,
                    hiKey,
                    loVel: velLayer.loVel,
                    hiVel: velLayer.hiVel,
                    rrPos: sample.rrPos,
                    rrLen,
                    micId: 0,
                    isRelease: false,
                    loopMode,
                    loopStart: 0,
                    loopEnd: 0,
                    loopCrossfade: 0,
                    gainDb: 0,
                    attack: artType === 'sustain' || artType === 'tremolo' ? 0.02 : 0.005,
                    decay: 0.1,
                    sustain: 1.0,
                    release: artType === 'sustain' || artType === 'tremolo' ? 0.5 : 0.15,
                });
            }
        }
    }

    console.log(`    ✓ ${zones.length} zones, ${downloadCount} downloaded, ${skipCount} cached`);

    return { type: artType, id: artId, zones };
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
    if (!shouldContinueWithPublicSampleDownload()) {
        return;
    }

    console.log('🎻 Levain Sample Downloader — VSCO-2-CE (CC0)\n');

    for (const instrument of INSTRUMENTS) {
        console.log(`\n📂 ${instrument.id}`);

        const outDir = join(OUT_DIR, instrument.id);
        await mkdir(outDir, { recursive: true });

        const manifestArticulations = [];

        for (const art of instrument.articulations) {
            console.log(`  🎵 ${art.type} (${art.vscoPath})`);
            const result = await processArticulation(
                art.vscoPath,
                art.type,
                art.id,
                art.loopMode,
                instrument.keyRange,
                outDir
            );
            if (result) {
                manifestArticulations.push(result);
            }
        }

        if (manifestArticulations.length > 0) {
            const manifest = buildManifest(instrument.id, manifestArticulations);
            const manifestPath = join(outDir, 'manifest.json');
            await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
            console.log(`  📋 manifest.json written (${manifestArticulations.length} articulations)`);
        } else {
            console.warn(`  ⚠️  No articulations loaded for ${instrument.id}`);
        }
    }

    console.log('\n✅ All done!');
}

main().catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
});
