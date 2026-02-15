# M5.2 Handoff Analysis (for external agent)

## Snapshot
- Branch: `m5-2-factcheck-additive`
- Head commit: `f15d53f`
- Base: `origin/main` (`09bc8c4`)
- Diff size: `11 files`, `+2294/-141`
- Build status: `npm run build` passes (Next.js production build completed)

## Files changed vs `main`
- `app/api/recognize/route.ts`
- `app/page.tsx`
- `components/CameraView.tsx`
- `lib/types.ts`
- `lib/factcheck/types.ts` (new)
- `lib/factcheck/orchestrator.ts` (new)
- `lib/factcheck/validator.ts` (new)
- `lib/factcheck/providers/wikimedia.ts` (new)
- `lib/factcheck/providers/aic.ts` (new)
- `lib/factcheck/providers/cma.ts` (new)
- `README.md`

## What was implemented
### 1) Core recognition pipeline (`app/api/recognize/route.ts`)
- Recognition still runs through Claude image analysis pass 1 (+ optional retry pass 2).
- Fact-check step is now mode-driven:
  - `FACTCHECK_MODE=off|shadow|enrich`
  - default is `shadow` (if env is missing/invalid).
- Core fields are intended to remain immutable during fact-check:
  - `painting`, `artist`, `year`, `museum`, `style`, `confidence`, `reasoning`.
- Request tracing/logging is expanded with `requestId` and stage logs.

### 2) Fact-check subsystem (new `lib/factcheck/*`)
- Added evidence orchestrator with deadline budget and phase split:
  - Phase A: Wikimedia (primary, multilingual EN+RU + Wikidata)
  - Phase B: AIC + CMA (secondary, best-effort)
- Added validator for:
  - fact filtering against evidence tokens
  - additive summary merge (base summary preserved; only verified addon appended)
- Added in-memory TTL cache by normalized `painting|artist`.

### 3) API/UI contract expansion
- `RecognitionResponse` includes:
  - `reasoning`, `facts[]`, `factCheck{status,verifiedFacts,sources,latencyMs}`, `requestId`.
- Client parser in `app/page.tsx` was made tolerant:
  - missing/partial `facts/factCheck` no longer causes recognition failure.
- UI shows fact-check status and facts when present.

### 4) Camera tweaks
- Capture quality increased:
  - max image size `1024 -> 1536`
  - JPEG quality `0.7 -> 0.8`
- Camera error texts switched to English.

## Key code anchors for review
- Fact-check mode default/parsing: `app/api/recognize/route.ts:24`
- Mode fallback to `shadow`: `app/api/recognize/route.ts:30`
- Run pass logic: `app/api/recognize/route.ts:566`
- Retry decision: `app/api/recognize/route.ts:782`
- Unknown-result hard fail: `app/api/recognize/route.ts:810`
- Fact-check skip for low confidence/unknown: `app/api/recognize/route.ts:833`
- Evidence orchestration call: `app/api/recognize/route.ts:906`
- Facts draft gate by primary coverage: `app/api/recognize/route.ts:947`
- Shadow-mode candidate logging: `app/api/recognize/route.ts:992`
- Additive application (`enrich` only): `app/api/recognize/route.ts:1001`
- Core immutability assertion log: `app/api/recognize/route.ts:1021`

- Orchestration/budget phases: `lib/factcheck/orchestrator.ts:58`
- Wikimedia multilingual search: `lib/factcheck/providers/wikimedia.ts:9`
- Wikimedia primary fetch function: `lib/factcheck/providers/wikimedia.ts:197`
- Additive merge validator: `lib/factcheck/validator.ts:175`
- UI tolerant parsing of `factCheck`: `app/page.tsx:80`

## Regression hypotheses to investigate (accuracy drop)
1. Recognition prompt/parser strictness causes hard API error instead of degraded success.
   - JSON-only contract + parse extraction can fail and return `upstream_error`.
   - Relevant: `app/api/recognize/route.ts:626`, `app/api/recognize/route.ts:640`, `app/api/recognize/route.ts:381`.

2. Retry pass may reinforce wrong first guess (anchoring effect).
   - Retry prompt injects first-pass attribution details.
   - Relevant: `app/api/recognize/route.ts:388`, `app/api/recognize/route.ts:790`.

3. Unknown guard converts uncertain attribution into hard fail.
   - If both `painting` and `artist` resolve to `"unknown"`, API returns error.
   - Relevant: `app/api/recognize/route.ts:810`.

4. Third step latency/cost can still impact end-to-end stability under weak network/serverless variability.
   - Even in `shadow`, evidence + optional facts draft are executed.
   - Relevant: `app/api/recognize/route.ts:906`, `app/api/recognize/route.ts:950`.

## Fast isolation protocol
1. Compare outputs of:
   - `FACTCHECK_MODE=off`
   - `FACTCHECK_MODE=shadow` (current default)
   - `FACTCHECK_MODE=enrich`
2. For each failed/low-quality result capture:
   - `requestId`
   - API code/status
   - logs for `claude_call_start/end`, `claude_parse_error`, `analysis_failed`
3. Confirm whether failures happen before or after fact-check:
   - if failures are `claude_parse_error` / `analysis_failed`, root cause is core recognition stage, not evidence providers.
4. Measure p50/p95 API latency by mode on the same painting set.

## Minimal reproducible commands
```bash
git checkout m5-2-factcheck-additive
npm install
npm run build
npm run dev
```

Optional quick API check:
```bash
curl -i -X POST "http://localhost:3000/api/recognize" \
  -H "Content-Type: application/json" \
  -H "x-request-id: handoff-check-001" \
  -d '{"imageBase64":"data:image/jpeg;base64,Zm9v"}'
```

## Suggested first tasks for external agent
1. Quantify failure mode distribution from logs (parse error vs upstream timeout vs unknown-after-passes).
2. Evaluate whether retry prompt should be softened or removed for first test cohort.
3. Verify that `shadow` mode does not materially reduce recognition success/latency vs `off`.
4. If core failures dominate: adjust pass-1 schema/prompt strictness before touching providers.
