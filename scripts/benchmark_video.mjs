#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';

dotenv.config({ path: path.join(os.homedir(), '.env'), quiet: true });
dotenv.config({ path: path.resolve('.env'), override: false, quiet: true });

function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
        const key = token.slice(2);
        const next = argv[index + 1];
        if (!next || next.startsWith('--')) {
            args[key] = true;
        } else {
            args[key] = next;
            index += 1;
        }
    }
    return args;
}

function required(args, key) {
    const value = args[key];
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Missing required --${key} argument.`);
    }
    return value;
}

function boolArg(value, fallback) {
    if (value === undefined) return fallback;
    if (value === true || value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    throw new Error(`Expected a boolean value, received ${value}.`);
}

function numberArg(value, fallback, name) {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number.`);
    return parsed;
}

function safeName(value) {
    return String(value).replace(/[^a-z0-9._-]+/gi, '_');
}

function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

function imageMime(file) {
    switch (path.extname(file).toLowerCase()) {
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.webp':
            return 'image/webp';
        case '.gif':
            return 'image/gif';
        case '.avif':
            return 'image/avif';
        default:
            return 'image/png';
    }
}

function decodeDataUri(value) {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(value);
    if (!match) throw new Error('Provider returned an unsupported data URI.');
    return { mime: match[1], bytes: Buffer.from(match[2], 'base64') };
}

async function downloadVideo(value) {
    if (value.startsWith('data:')) return decodeDataUri(value);
    if (!/^https?:\/\//i.test(value)) throw new Error('Provider returned neither a data URI nor an HTTP URL.');
    const response = await fetch(value);
    if (!response.ok) throw new Error(`Video download failed: ${response.status} ${response.statusText}`);
    return {
        mime: (response.headers.get('content-type') || 'video/mp4').split(';')[0],
        bytes: Buffer.from(await response.arrayBuffer()),
    };
}

function videoExtension(mime) {
    if (mime.includes('webm')) return 'webm';
    if (mime.includes('quicktime')) return 'mov';
    return 'mp4';
}

function reducedAspectRatio(width, height) {
    let left = width;
    let right = height;
    while (right !== 0) {
        const remainder = left % right;
        left = right;
        right = remainder;
    }
    return `${width / left}:${height / left}`;
}

function normalizedAspectRatio(value) {
    if (typeof value !== 'string') return undefined;
    const match = /^(\d+):(\d+)$/.exec(value);
    if (!match) return undefined;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width <= 0 || height <= 0) return undefined;
    return reducedAspectRatio(width, height);
}

export function extractMediaFraming(media) {
    if (media?.error) return { error: media.error };
    const stream = media?.streams?.find(entry => entry.codec_type === 'video');
    const width = Number(stream?.width);
    const height = Number(stream?.height);
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
        return { error: 'ffprobe did not report positive integer dimensions for a video stream.' };
    }

    const storageAspectRatio = reducedAspectRatio(width, height);
    return {
        width,
        height,
        aspect_ratio: normalizedAspectRatio(stream.display_aspect_ratio) || storageAspectRatio,
        storage_aspect_ratio: storageAspectRatio,
        ...(normalizedAspectRatio(stream.sample_aspect_ratio)
            ? { pixel_aspect_ratio: normalizedAspectRatio(stream.sample_aspect_ratio) }
            : {}),
    };
}

function probeMedia(file) {
    try {
        const output = execFileSync(
            'ffprobe',
            [
                '-v',
                'error',
                '-show_entries',
                'format=duration,size,bit_rate:stream=index,codec_type,codec_name,width,height,sample_aspect_ratio,display_aspect_ratio,r_frame_rate,avg_frame_rate,nb_frames',
                '-of',
                'json',
                file,
            ],
            { encoding: 'utf8' }
        );
        return JSON.parse(output);
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
}

function requireSourceFraming(file) {
    const framing = extractMediaFraming(probeMedia(file));
    if (framing.error) {
        throw new Error(`Could not determine source image dimensions for ${file}: ${framing.error}`);
    }
    return framing;
}

export function claimFreshOutputDirectory(outDir) {
    fs.mkdirSync(path.dirname(outDir), { recursive: true });
    if (fs.existsSync(outDir)) {
        if (!fs.statSync(outDir).isDirectory()) {
            throw new Error(`Requested output path is not a directory: ${outDir}`);
        }
        const existing = fs.readdirSync(outDir);
        if (existing.length > 0) {
            throw new Error(
                `Requested output directory is not empty and may contain prior evidence: ${outDir}. Choose a fresh directory.`
            );
        }
    } else {
        fs.mkdirSync(outDir);
    }

    const claimFile = path.join(outDir, '.video-benchmark-active');
    try {
        fs.writeFileSync(claimFile, `${process.pid}\n`, { flag: 'wx' });
    } catch (error) {
        throw new Error(
            `Could not exclusively claim output directory ${outDir}; another benchmark may be using it: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }
    return claimFile;
}

function releaseOutputDirectoryClaim(claimFile) {
    try {
        fs.unlinkSync(claimFile);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
}

export function runModelsInParallel(models, run) {
    return Promise.all(models.map(model => run(model)));
}

export function assertDistinctModelOutputDirectories(models) {
    const directories = new Map();
    for (const model of models) {
        const directory = safeName(model);
        const priorModel = directories.get(directory);
        if (priorModel) {
            throw new Error(
                `Models "${priorModel}" and "${model}" map to the same evidence directory "${directory}".`
            );
        }
        directories.set(directory, model);
    }
}

async function runModel({
    model,
    imageDataUri,
    endImageDataUri,
    prompt,
    outDir,
    options,
    sourceEvidence,
    endSourceEvidence,
    costTracker,
    ensembleVideo,
}) {
    const requestId = randomUUID();
    const modelDir = path.join(outDir, safeName(model));
    fs.mkdirSync(modelDir, { recursive: true });
    const evidenceFile = path.join(modelDir, 'evidence.json');
    const startedAt = new Date();
    const usage = [];
    const usageListener = entry => {
        if (entry?.request_id === requestId) usage.push(entry);
    };
    costTracker.onAddUsage(usageListener);

    const evidence = {
        schema_version: 1,
        request_id: requestId,
        model,
        source: sourceEvidence,
        end_source: endSourceEvidence,
        prompt,
        options,
        started_at: startedAt.toISOString(),
        status: 'running',
        outputs: [],
        usage: [],
    };
    fs.writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`[${model}] submitted`);

    try {
        const values = await ensembleVideo(
            prompt,
            { agent_id: `video-benchmark-${safeName(model)}`, model },
            {
                ...options,
                source_image: imageDataUri,
                ...(endImageDataUri ? { end_image: endImageDataUri } : {}),
                request_id: requestId,
            }
        );
        for (let index = 0; index < values.length; index += 1) {
            const payload = await downloadVideo(values[index]);
            const outputFile = path.join(modelDir, `output-${index + 1}.${videoExtension(payload.mime)}`);
            fs.writeFileSync(outputFile, payload.bytes);
            const media = probeMedia(outputFile);
            evidence.outputs.push({
                file: outputFile,
                mime_type: payload.mime,
                bytes: payload.bytes.length,
                sha256: sha256(payload.bytes),
                media,
                framing: extractMediaFraming(media),
            });
        }
        evidence.status = 'completed';
    } catch (error) {
        evidence.status = 'failed';
        evidence.error = error instanceof Error ? error.message : String(error);
    } finally {
        costTracker.offAddUsage(usageListener);
        evidence.completed_at = new Date().toISOString();
        evidence.wall_time_ms = Date.now() - startedAt.getTime();
        evidence.usage = usage;
        evidence.tracked_cost_usd = usage.reduce((sum, entry) => sum + (entry.cost || 0), 0);
        fs.writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
    }

    const seconds = (evidence.wall_time_ms / 1000).toFixed(1);
    const cost = evidence.tracked_cost_usd.toFixed(4);
    console.log(`[${model}] ${evidence.status} in ${seconds}s; tracked cost $${cost}`);
    if (evidence.error) console.error(`[${model}] ${evidence.error}`);
    return evidence;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const imageFile = path.resolve(required(args, 'image'));
    const outDir = path.resolve(required(args, 'out'));
    const models = required(args, 'models')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    if (models.length === 0) throw new Error('--models did not contain any model IDs.');
    assertDistinctModelOutputDirectories(models);

    const prompt =
        typeof args['prompt-file'] === 'string'
            ? fs.readFileSync(path.resolve(args['prompt-file']), 'utf8').trim()
            : required(args, 'prompt');
    const imageBytes = fs.readFileSync(imageFile);
    const imageDataUri = `data:${imageMime(imageFile)};base64,${imageBytes.toString('base64')}`;
    const endImageFile = typeof args['end-image'] === 'string' ? path.resolve(args['end-image']) : undefined;
    const endImageBytes = endImageFile ? fs.readFileSync(endImageFile) : undefined;
    const endImageDataUri =
        endImageFile && endImageBytes
            ? `data:${imageMime(endImageFile)};base64,${endImageBytes.toString('base64')}`
            : undefined;
    const options = {
        duration: numberArg(args.duration, 4, 'duration'),
        resolution: args.resolution || '720p',
        aspect_ratio: args['aspect-ratio'] || '9:16',
        generate_audio: boolArg(args['generate-audio'], false),
        timeout_ms: numberArg(args['timeout-ms'], 10 * 60_000, 'timeout-ms'),
        poll_interval_ms: numberArg(args['poll-interval-ms'], 5000, 'poll-interval-ms'),
    };
    const sourceFraming = requireSourceFraming(imageFile);
    const sourceEvidence = {
        file: imageFile,
        mime_type: imageMime(imageFile),
        bytes: imageBytes.length,
        sha256: sha256(imageBytes),
        width: sourceFraming.width,
        height: sourceFraming.height,
        aspect_ratio: sourceFraming.aspect_ratio,
    };
    const endSourceFraming = endImageFile ? requireSourceFraming(endImageFile) : undefined;
    const endSourceEvidence =
        endImageFile && endImageBytes
            ? {
                  file: endImageFile,
                  mime_type: imageMime(endImageFile),
                  bytes: endImageBytes.length,
                  sha256: sha256(endImageBytes),
                  width: endSourceFraming.width,
                  height: endSourceFraming.height,
                  aspect_ratio: endSourceFraming.aspect_ratio,
              }
            : undefined;

    const claimFile = claimFreshOutputDirectory(outDir);
    try {
        const { costTracker, ensembleVideo } = await import('../dist/index.js');
        const results = await runModelsInParallel(models, model =>
            runModel({
                model,
                imageDataUri,
                endImageDataUri,
                prompt,
                outDir,
                options,
                sourceEvidence,
                endSourceEvidence,
                costTracker,
                ensembleVideo,
            })
        );
        const summary = {
            schema_version: 1,
            started_at: results.reduce(
                (earliest, result) => (result.started_at < earliest ? result.started_at : earliest),
                results[0]?.started_at || new Date().toISOString()
            ),
            completed_at: results.reduce(
                (latest, result) => (result.completed_at > latest ? result.completed_at : latest),
                results[0]?.completed_at || new Date().toISOString()
            ),
            source: sourceEvidence,
            end_source: endSourceEvidence,
            prompt,
            options,
            models: results.map(result => result.model),
            total_tracked_cost_usd: results.reduce((sum, result) => sum + result.tracked_cost_usd, 0),
            results: results.map(result => ({
                model: result.model,
                status: result.status,
                wall_time_ms: result.wall_time_ms,
                tracked_cost_usd: result.tracked_cost_usd,
                outputs: result.outputs,
                error: result.error,
            })),
        };
        const summaryFile = path.join(outDir, 'benchmark-summary.json');
        fs.writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
        console.log(`Saved summary: ${summaryFile}`);
        if (results.every(result => result.status === 'failed')) process.exitCode = 1;
    } finally {
        releaseOutputDirectoryClaim(claimFile);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
