# pi-cavallo

Generate and edit video in pi using Alibaba Model Studio video models.
Supports **HappyHorse 1.1/1.0**, **Wan 3.0**, and **Wan2.7**: text-to-video, image-to-video, reference-to-video, and video editing.

## Notification contract

Notices use official Pi TUI components through a bundled shared module. They render without loading pi-fornace or modifying Pi. New notices use a package-owned entry type; historical Fornace notices remain readable. `extensions/shared/fornace-messages.ts` is generated from the source identified in `SOURCE.json`, never edited independently.

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

The gateway route supports text-to-video everywhere, plus image inputs when the configured model is a verified MiniMax H3 route (`fornace-video`, `fornace-video-h3-max`):

- `imagePath` (first frame) and `lastImagePath` map to `content` items with `role=first_frame` / `role=last_frame`.
- `referenceImages` (1-9) map to `role=reference_image` items.
- Frames and reference images are mutually exclusive; `lastImagePath` requires `imagePath`.
- Local images load as base64 data URIs; `http(s)://` and `mm_file://` URLs pass through.
- Requested vs effective aspect ratio: with first/last frames the upstream always derives the ratio from the input image (`adaptive`); a requested `aspectRatio` is sent but ignored upstream. Reference-to-video may request a concrete ratio (for example `16:9`); default `adaptive`.

DashScope stays the route for every other input (`videoPath`, `firstClipPath`, `audioPath`) and model.

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

- **Optional tool exposure**: `cavallo_video` and `cavallo_configure` register inside the `fornace-video` namespace as optional tools. A session carries one family line and their names; the full declaration and prompt guidance appear once a load (native `tool_search`, codemode `searchTools()`, or `tool_load`) names them. Explicit selection such as `--tools cavallo_video` declares the tool directly.
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