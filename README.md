# inspired2site - Fullstack Starter (v2)

This is an improved full-stack starter for Inspired2Site.
It includes:
- Express backend with /api/analyze, /api/generate-image, /api/export
- Simple frontend (vanilla JS) chat-like assistant (paste URL, upload image, generate preview)
- miracle.css with utilities and a glass header effect
- JSZip export handled server-side

## Quick start (on Replit / StackBlitz / Render)

1. Install dependencies:
```
npm install
```

2. Run the server:
```
node server.js
```

3. Open the site at the provided preview URL.

## Env variables (optional)
- SUPABASE_URL
- SUPABASE_KEY
- HF_API_KEY

If HF_API_KEY is set, the /api/generate-image route will attempt to call Hugging Face SDXL.

## Notes
This starter focuses on a solid, visible preview and a chat-style assistant. It builds a simple multi-section preview (hero, headings, blocks) from the analyzed URL and produces a zip export.
