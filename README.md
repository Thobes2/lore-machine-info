# Lore Machine — loremachine.info

Plain HTML/CSS/JS, no build step. Deployed by Netlify from this repo: every push to `main` goes live on loremachine.info within a minute or so.
To roll back, open Netlify → Deploys and publish an earlier deploy.

## Pages
- `index.html` — homepage: "The Story Visualization Company", English/Japanese/Korean/Mandarin cycling subline, Software + Studio buttons (hover shows description; click opens the page).
- `software.html` — product pitch + embedded YouTube video, "Launch App" → loremachine.world.
- `studio.html` — tabs: How We Work (pipeline diagram), Case Study (HP × Intel × Anonymous Content), Get in Touch (three embedded Shorts + contact form).
- `about.html`, `news.html`, `press.html`.

Inner pages share a top bar (wordmark → home, emblem → menu overlay).

## Shared behaviour (inline in each page)
Kunai cursor + lock-on reticle (mouse only), ticker, interface sounds with mute toggle (Web Audio; starts after the
visitor's first click/keypress — browser rule), reduced-motion support, phone layout under 760px.

## City scene — `scene.js`
Three.js r147 (UMD from jsDelivr) renders the rainy city into `<canvas id="scene">`. Each page sets a camera view via
`<body data-view="…">`. API: `window.loreScene.setMood('software'|'studio'|null)`, `.pause()`, `.resume()`.
Falls back to a CSS gradient if WebGL is unavailable.

## Before launch
- **Contact form** (Studio → Get in Touch) uses Netlify Forms (form name `studio-contact`). In Netlify: Forms → enable
  form detection, redeploy, then add an email notification to thobey@loremachine.world. Only works on the live Netlify site.
- **Logos** in `assets/` were cropped from a screenshot; swap in the original hi-res/vector files.
- **Translations** in the homepage subline (Japanese, Korean, Mandarin) need a native-speaker check.
- **Press**: the Reuters link points to a Yahoo Finance repost; swap in the direct Reuters URL if available.
- **News**: Thilsavrass and Adventure_Mode are dated 2024 — confirm (may be 2025).
- **Studio caption** says Bilibili World in Beijing — confirm the city (Bilibili World is usually held in Shanghai).
