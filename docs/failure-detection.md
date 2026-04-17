# Failure Detection

This document describes how failure detection works across `ensembleRequest`,
`ensembleImage`, and `ensembleResult`, with a focus on JSON/text requests and
image generation workflows.

## Goal

Callers should be able to detect terminal failures as soon as Ensemble knows a
 request has failed, without relying on external heartbeat timers.

Heartbeat monitors are still useful for process-level liveness, but they should
not be the primary mechanism for deciding whether an Ensemble operation failed.

## Shared Contract

Ensemble now emits a shared lifecycle event:

```ts
{
  type: 'operation_status',
  operation: 'request' | 'image' | 'result',
  status: 'started' | 'retrying' | 'failed' | 'completed',
  error?: string,
  reason?: string,
  recoverable?: boolean,
  terminal?: boolean,
  will_continue?: boolean,
  attempt?: number,
  max_attempts?: number,
  request_id?: string,
}
```

Interpretation rules:

- `status: 'retrying'` means Ensemble has observed a failure, but the overall
  operation is still alive and will continue.
- `status: 'failed'` with `terminal: true` means the operation is definitively
  failed and the caller can retry or move on immediately.
- `status: 'completed'` means the overall operation succeeded.

The legacy `error` event is still emitted for compatibility, but callers that
need reliable orchestration should treat `operation_status` as authoritative.

## Request Flow

`ensembleRequest(...)` emits:

- `operation_status: started` at the beginning of the overall request.
- `operation_status: retrying` when a round fails and Ensemble will retry.
- `operation_status: failed` when retries are exhausted or an unrecoverable
  exception escapes.
- `operation_status: completed` before `stream_end` when the request finishes
  successfully.

This means a caller can stop waiting as soon as it sees:

```ts
event.type === 'operation_status' &&
event.operation === 'request' &&
event.status === 'failed' &&
event.terminal === true
```

## Image Flow

`ensembleImage(..., { stream: true })` emits:

- `image_start`
- `operation_status: started`
- zero or more `cost_update`
- one or more `file_complete`
- `image_complete`
- `operation_status: completed`

Or, on failure:

- `image_start`
- `operation_status: started`
- `operation_status: failed`
- `error`

This is important because image providers usually do not stream provider-native
queue/progress/failure states back through Ensemble. Instead, each provider runs
its own request or polling loop, throws on terminal failure, and the top-level
image wrapper converts that into a unified terminal failure event.

## ensembleResult

`ensembleResult(stream, { failFast: true })` now returns as soon as it sees a
terminal failure event instead of waiting for `stream_end`.

It also records structured failure metadata:

```ts
{
  error?: string,
  failure?: {
    operation?: 'request' | 'image' | 'result',
    request_id?: string,
    reason?: string,
    terminal: boolean,
    recoverable: boolean,
    detectedAt: Date,
  }
}
```

Use this when you want a Promise-based API but still need immediate failure
detection.

## Recommended Caller Pattern

### Stream-first orchestration

```ts
for await (const event of ensembleImage(prompt, agent, { stream: true, timeout_ms: 120000 })) {
  if (event.type === 'operation_status') {
    if (event.status === 'retrying') {
      // optional logging or metrics
    }

    if (event.status === 'failed' && event.terminal) {
      // retry now, switch to fallback, or continue workflow without this result
      break;
    }
  }
}
```

### Promise-style aggregation with fail-fast behavior

```ts
const result = await ensembleResult(stream, { failFast: true });

if (result.failure?.terminal) {
  // immediate retry / fallback path
}
```

## Gemini, OpenAI, and Grok Image Generation

### Summary

For these three providers, the shared failure handling works because each
provider already throws on terminal image-generation failure. `ensembleImage`
then converts that thrown error into a unified `operation_status: failed` event.

### OpenAI

Implementation: `model_providers/openai.ts#createImage`

Observed failure behavior:

- Throws if `ImageGenerationOpts.n` is invalid.
- Throws if fetching a source image URL for image editing fails.
- Throws if the OpenAI Images API returns a response without a `data` array.
- Throws if any returned item is missing `b64_json`.
- Throws if no images are returned.

Operational result:

- Provider-detected failures become immediate terminal failures in
  `ensembleImage(..., { stream: true })`.
- Stalled SDK calls can be bounded with `timeout_ms` at the Ensemble wrapper
  layer.

### Gemini

Implementation: `model_providers/gemini.ts#createImage`

Observed failure behavior:

- Throws if `ImageGenerationOpts.n` is invalid.
- Throws when Gemini image streaming finishes without any image parts.
- Throws when Imagen responses contain no generated images.
- Logs and rethrows provider exceptions.

Operational result:

- Empty or malformed Gemini image outputs become terminal failures.
- Stalled provider calls can be bounded with `timeout_ms` at the wrapper layer.

### Grok / xAI

Implementation: `model_providers/grok.ts#createImage`

Observed failure behavior:

- Throws if `ImageGenerationOpts.n` is outside `1..10`.
- Throws if masks are supplied, since masks are not supported here yet.
- Throws if too many source images are supplied.
- Throws if source images are malformed.
- Throws if the xAI API response contains no image outputs.

Operational result:

- Invalid request-shape and empty-response failures become immediate terminal
  failures in `ensembleImage`.
- Stalled provider calls can be bounded with `timeout_ms` at the wrapper layer.

## What This Solves

This removes the need to infer request failure from heartbeat expiration in the
common cases:

- provider returns a terminal error
- provider returns malformed or empty image output
- Ensemble retries have been exhausted
- the caller sets `timeout_ms` and the provider stalls

## What This Does Not Solve

This does not create provider-native progress events for image jobs. Providers
such as Gemini, OpenAI, and Grok still expose image generation as a Promise-like
operation in Ensemble, so the shared wrapper can report:

- started
- terminal failure
- terminal success

but not granular in-flight states like queued, running, or polling step N.

If provider-native progress becomes important later, the next step would be a
provider-agnostic async job interface rather than Promise-only `createImage(...)`.
