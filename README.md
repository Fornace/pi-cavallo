# pi-cavallo

Generate and edit video in pi using Alibaba DashScope models.
Supports **HappyHorse** and **Wan2.7**, including text-to-video, image-to-video, reference-to-video, and video editing.

## Models

### Wan2.7
- `wan2.7-t2v` (Text-to-Video)
- `wan2.7-i2v-2026-04-25` (Image-to-Video: first frame, last frame, video continuation)
- `wan2.7-r2v` (Reference-to-Video)
- `wan2.7-videoedit` (Video editing via instruction + reference images)

### HappyHorse
- `happyhorse-1.0-t2v` (Text-to-Video)
- `happyhorse-1.0-i2v` (Image-to-Video)
- `happyhorse-1.0-r2v` (Reference-to-Video, up to 9 images)
- `happyhorse-1.0-video-edit` (Video editing via language + references)

## Features

- **Non-blocking Execution**: Submits to DashScope and polls in the background, freeing up the chat.
- **Smart Thumbnails**: Automatically extracts and displays a thumbnail when the video finishes downloading using `ffmpeg` (if installed).
- **Finder Integration**: Clickable markdown links to quickly reveal the exported video in Finder without launching it (`open -R`).
- **Headless Mode Support**: Fully compatible with API usage or RPC mode.
- **Granular Control**: Supports settings like `resolution` (defaulting to 720P for speed/cost), `duration`, `aspectRatio`, `watermark`, `seed`, and `promptExtend`.
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