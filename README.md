# pi-cavallo

Generate and edit video in pi using Alibaba HappyHorse models.
It supports standard text-to-video, image-to-video, reference-to-video and video-editing tasks.

## Models

- `happyhorse-t2v` (Text-to-Video)
- `happyhorse-i2v` (Image-to-Video)
- `happyhorse-r2v` (Reference-to-Video, up to 9 images)
- `happyhorse-video-edit` (Video editing via language + references)

## Setup

Requires the Alibaba DashScope API key.

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