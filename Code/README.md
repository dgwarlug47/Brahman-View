# Brahman View API

This API implements the Brahman View backend that queries a Notion workspace and returns every line containing the current month/year or previous month/year.

## Setup

1. Install dependencies:

   ```bash
   cd "../Code"
   npm install
   ```

2. Create a `.env` file from `.env.example` and set your `NOTION_API_KEY`.

  For Netlify auto-refresh every 10 minutes, set `NETLIFY_BUILD_HOOK_URL` so the scheduled function can trigger a rebuild.

3. Start the server:

   ```bash
   npm start
   ```

## Endpoints

- `GET /health`
  - Returns `{ status: 'ok' }`
- `GET /api/search`
  - Searches the connected Notion workspace and returns matching lines for the current and previous month/year.

## Notes

- The Notion integration must have access to the workspace pages.
- The API uses the Notion Search endpoint and block children traversal to scan page content.
