# Changelog

## 2.0.0

### Breaking

- The extension must be paired. Every WebSocket's first frame is `{"type":"hello","token":"…"}`, sent within 2 s. A missing, wrong or late token closes the socket with 4401. Paste `~/.config/agent-browser-bridge/pair.token` into the popup.
- `/` only upgrades for the pinned extension Origin (`chrome-extension://jjlgogdanhhkgglgckdpigepfniilinm`, or `AGENT_BROWSER_EXTENSION_ID`). Other origins get 403. The manifest now carries a `key`, so the unpacked ID is the same on every machine. Remove any older install before loading this one.
- The bridge binds `127.0.0.1` by default (it used to listen on all interfaces). Override with `AGENT_BROWSER_HOST`.
- `/client` refuses any Origin and needs a client token that rotates at every owner start. `AGENT_BROWSER_CLIENT=off` removes the route.
- The server runs on `Bun.serve` (`@hono/node-server` removed), so refused upgrades get real 403/404 responses.

### Added

- Pairing-token field and a "Not paired" state in the popup.
- Badge states: OFF (grey), `…` (amber), ON (green), busy (blue), KEY (red, not paired).
- An action log in the extension: a 1,000-entry ring buffer, a popup list of the last 50, JSONL download and clear.
- A newer authenticated extension replaces the older one, and the older socket's in-flight requests fail with `CONNECTION_RESET`.
- The `UNAUTHORIZED` error code and the `HelloFrame` protocol type.

### Changed

- Toggle off closes the socket (1000) and stops reconnecting; toggle on reconnects at once. The state persists.
- The extension reconnects after the bridge closes normally, so a new agent session is picked up. Backoff is capped at 5 s (was 30 s).
- Tool descriptions say they drive "the user's real, logged-in Chrome". Tool names and shapes are unchanged.
- The MCP server reports the package version and exits when stdin closes.
- `browser_type` now reports a `typed: false` result as an error.
- Dependencies: `@modelcontextprotocol/sdk` 1.29, `@types/chrome` 0.3, vite 8.3, `@crxjs/vite-plugin` 3. Bun is pinned to 1.3.11 in `mise.toml` and CI.
- The manifest drops `activeTab`, sets `minimum_chrome_version` 120 and version 2.0.0, and the popup reads its version from the manifest.
- CI runs `bun run test` (it pointed at a non-existent `pi-extension` path).
