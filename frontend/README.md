# Digital Twin Frontend

React + Vite frontend for the campus digital twin.

## Backend integration

- Frontend API calls use `VITE_API_BASE_URL` (default: `/api`).
- Vite dev server proxies `/api/*` to `http://localhost:8000/*`.
- This allows running frontend and backend on different ports without hardcoded URLs in components.

## Run locally

1. Start backend (`digital-twin-backend`):

	```bash
	pip install -r requirements.txt
	uvicorn main:app --reload --host 0.0.0.0 --port 8000
	```

2. Start frontend (`digital-twin-app`):

	```bash
	npm install
	npm run dev
	```

3. Open the frontend URL shown by Vite (typically `http://localhost:5173`).

## Optional env config

Create `.env` in `digital-twin-app`:

```env
VITE_API_BASE_URL=/api
```

For direct backend URL (without Vite proxy), set for example:

```env
VITE_API_BASE_URL=http://localhost:8000
```

## AI-powered suggestions (backend)

`/suggest-building` now uses an LLM when configured, and automatically falls back to a deterministic dynamic heuristic when AI is unavailable.

Set these environment variables before starting backend:

```env
AI_PROVIDER=gemini
AI_API_KEY=your_api_key
AI_MODEL=gemini-2.5-flash-lite
AI_PROVIDER_URL=https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
```

OpenAI-compatible alternative:

```env
AI_PROVIDER=openai
AI_API_KEY=your_api_key
AI_MODEL=gpt-4o-mini
AI_PROVIDER_URL=https://api.openai.com/v1/chat/completions
```

If `AI_API_KEY` is missing, backend still returns non-random suggestions based on attendee count, capacity/occupancy, and simulated zone load.
