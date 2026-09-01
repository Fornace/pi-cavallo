# Changelog

## 2.1.0

> OpenAI-compatible video provider support with interactive setup (works with mantice, MiniMax H3 Max via fal).

- New `/cavallo-setup` wizard: enter a base URL and API key, the wizard probes the gateway for video models and the `/videos/generations` endpoint, then saves the route to settings.json.
- When configured, cavallo_video submits to `{baseUrl}/videos/generations` and polls `{baseUrl}/videos/generations/{id}` (the mantice gateway flow). Delete the "cavallo" section from settings.json to return to DashScope.
- Verified live through mantice: fornace-video routes to MiniMax H3 Max (fal), submission to finished mp4 URL with native audio.
- The OpenAI-compatible route is text-to-video only for now; i2v/r2v/edit keep using DashScope.

## 2.0.0

> New generation catalog and auto-selected defaults, grounded in Alibaba Model Studio docs (2026-09-01).

- Added HappyHorse 1.1 family: `happyhorse-1.1-t2v`, `happyhorse-1.1-i2v`, `happyhorse-1.1-r2v` (native audio, 480P/720P/1080P, 3-15s).
- Added Wan 3.0: `wan3.0-video` and speed-optimized `wan3.0-video-prime` (all-in-one reference/edit/stitching, up to 30 seconds).
- `model` parameter is now optional: the best default is auto-selected from the task type (imagePath -> i2v, videoPath -> edit, referenceImages -> r2v, else t2v).
- New defaults: t2v/i2v/r2v -> HappyHorse 1.1, edit -> happyhorse-1.0-video-edit (Alibaba's recommended models).
- Persistent per-task-type defaults via `cavallo.defaults` in settings.json; manage with the new `/cavallo-models` command (list + `t2v=<model-id>` override syntax).
- Spec-driven validation: duration and resolution limits now come from the per-model catalog and error messages list the supported values.
- Split into focused modules (models, settings, task API); typecheck against pi 0.84.4.

## 1.1.0

- pi-native auth resolution (auth.json/modelRegistry before env var).

## 1.0.1

- Remove onUpdate call from background task to prevent agent listener error.
