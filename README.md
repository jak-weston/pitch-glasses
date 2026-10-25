# Pitch Glasses

**Someone pitches you. While they talk, sourced facts about their market appear in your glasses. When they finish, a one-page brief is waiting and a follow-up email is drafted - you approve it with a tap. You never touch a screen.**

Built at c0mpiled-16 (UC San Diego) for the **No App** track, with Even Realities G2 glasses.

## How it works

```
G2 glasses mic (16 kHz PCM)
   │  WebSocket (HTTP fallback)
   ▼
Laptop server ──► Deepgram live transcription
   │
   ├─ every ~12 new words ──► Claude + web search ──► one sourced fact ──► glasses display
   │
   └─ pitch ends (tap, or "thanks for the pitch") ──► Claude + web search
          ├─► one-page brief ──► projector dashboard
          └─► follow-up draft ──► glasses: "Tap = send · Swipe = skip" ──► email (Resend)
```

- **Glasses** (`glasses/`): an Even Hub web app. Captures mic audio, shows one line at a time, and maps temple gestures: tap = start / done / approve, swipe = skip, double-tap = exit.
- **Server** (`server/`): Node + TypeScript. Streams audio to Deepgram, runs the research agent, keeps session state, and serves the dashboard.
- **Playbooks** (`playbooks/*.yaml`): each workflow is a config file - what facts to look for, the brief's sections, the follow-up's goal, and voice samples. `pitch-vetting` and `recruiting` ship today; adding a new one (sales call, customer interview) means writing a YAML file, not code.

## Design choices

- **Graded on a real investor rubric.** The pitch-vetting playbook scores Team, Product, Market, Execution, and Fundraisability 1-4 using a pre-seed deal rubric (even scale on purpose: no neutral middle), then lists comparables, key assumptions, and next questions. Fundraisability is judged from the live pitch itself.
- **The glasses only show sourced facts.** Judgment calls go in the brief, where there's room for nuance; the glasses get one line: score and verdict.
- **Nothing goes to another person without approval.** The agent drafts; a human taps to send.
- **Hands-free end of pitch.** The playbook's end phrase ("thanks for the pitch") closes the session automatically.
- **Degrades gracefully.** If the glasses WebView refuses WebSockets, the app falls back to HTTP. If the glasses aren't available, the dashboard can use the laptop mic.

## Scaling beyond the hackathon

The engine is playbook-agnostic: the same capture → research → brief → approved action loop serves investors, recruiters, sales reps, and journalists. Sessions are independent, so the server can run many wearers concurrently behind a queue, with per-org playbooks and voice samples.

## Run it

```bash
# 1. Keys
cp .env.example .env            # add ANTHROPIC_API_KEY, DEEPGRAM_API_KEY (Resend optional)

# 2. Server + dashboard
cd server && npm install && npm run dev          # http://localhost:8787

# 3. Public tunnel so the phone can reach the server
cloudflared tunnel --url http://localhost:8787  # copy the https://...trycloudflare.com URL

# 4. Glasses app
cd glasses && npm install
echo "VITE_SERVER_URL=https://<your-tunnel>.trycloudflare.com" > .env
# also put that URL in app.json -> permissions -> network -> whitelist
npm run dev
npx evenhub qr --url "http://<your-LAN-IP>:5173"  # scan with the Even app
```

## Built with

Even Realities G2 + Even Hub SDK · Deepgram Nova-3 · Claude (Anthropic API with web search) · Resend · Node/TypeScript · Vite
