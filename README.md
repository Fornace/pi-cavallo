# pi-cavallo

Generate and edit video in pi using Alibaba Model Studio video models.
Supports **HappyHorse 1.1/1.0**, **Wan 3.0**, and **Wan2.7**: text-to-video, image-to-video, reference-to-video, and video editing.

## Models

### Wan 3.0 (all-in-one, up to 30 seconds)
- `wan3.0-video` (T2V, I2V with first/last-frame stitching, R2V, editing; parses files and web links as references)
- `wan3.0-video-prime` (speed-optimized wan3.0-video)

### HappyHorse 1.1 (native audio, 480P/720P/1080P)
- `happyhorse-1.1-t2v` (Text-to-Video, recommended)
- `happyhorse-1.1-i2v` (Image-to-Video, recommended)
- `happyhorse-1.1-r2v` (Reference-to-Video, recommended)

### HappyHorse 1.0
- `happyhorse-1.0-t2v` (Text-to-Video)
- `happyhorse-1.0-i2v` (Image-to-Video)
- `happyhorse-1.0-r2v` (Reference-to-Video, up to 9 images)
- `happyhorse-1.0-video-edit` (Video editing via language + references)

### Wan2.7
- `wan2.7-t2v` (Text-to-Video)
- `wan2.7-i2v-2026-04-25` (Image-to-Video: first frame, last frame, video continuation)
- `wan2.7-r2v` (Reference-to-Video)
- `wan2.7-videoedit` (Video editing via instruction + reference images)

## OpenAI-compatible providers (mantice)

Run `/cavallo-setup` to submit video generation through an OpenAI-compatible gateway instead of DashScope. The wizard probes the endpoint and saves the route under `"cavallo"` in settings.json:

```json
"cavallo": { "baseUrl": "https://llm.fornace.net/v1", "apiKey": "sk-...", "model": "fornace-video" }
```

The gateway route is text-to-video; DashScope stays the default for i2v, r2v, and video editing.

## Defaults and overrides

Omit `model` and the best default is picked automatically from the task type:

| Task | Default |
|---|---|
| Text-to-Video | `happyhorse-1.1-t2v` |
| Image-to-Video | `happyhorse-1.1-i2v` |
| Reference-to-Video | `happyhorse-1.1-r2v` |
| Video editing | `happyhorse-1.0-video-edit` |

- `/cavallo-models` lists the catalog and current defaults.
- `/cavallo-models t2v=wan3.0-video` persists a default override (stored under `cavallo.defaults` in settings.json).
- Duration and resolution limits are validated per model (HappyHorse 3-15s; Wan 3.0 up to 30s).

## Features

- **Non-blocking Execution**: Submits to DashScope and polls in the background, freeing up the chat.
- **Smart Thumbnails**: Automatically extracts and displays a thumbnail when the video finishes downloading using `ffmpeg` (if installed).
- **Finder Integration**: Clickable markdown links to quickly reveal the exported video in Finder without launching it (`open -R`).
- **Headless Mode Support**: Fully compatible with API usage or RPC mode.
- **Granular Control**: Supports `resolution` (H3 Max defaults to 768P), `duration` (5 seconds by default), `aspectRatio` (16:9 by default), `promptExpansionMode` (`balanced` by default), and `seed`. The fal safety checker is always enabled.
- **Audio Support**: Wan2.7 models accept an `audioPath` parameter for driving video with sound (Note: Audio requires a public HTTP/HTTPS URL per DashScope API).

## Setup

The extension automatically pulls the `Alibaba Cloud (API Key)` from your internal Pi Models configuration (`/models`).
Alternatively, set the environment variable:

```bash
export DASHSCOPE_API_KEY="your-key-here"
```

## Install

```bash
npm install -g pi-cavallo
```

Then in pi:
```bash
/install pi-cavallo
```