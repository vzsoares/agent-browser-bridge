# Testing pi-browser-bridge with Multiple Clients

Quickstart guide for validating the WebSocket bridge with multiple pi instances.

## Prerequisites

- Brave/Chrome with the Pi Browser Bridge extension loaded
- `bun` installed
- `pi` CLI available on PATH
- This repo checked out and dependencies installed (`bun install`)

## 1. Build the Extension

```bash
cd chrome-extension
bun run build
```

Load it in the browser: `brave://extensions` → Developer mode ON → Load unpacked → select `chrome-extension/dist/`.

**⚠️ Service worker limitation:** The extension background script uses `.then()` callbacks instead of top-level `await` because MV3 service workers + `@crxjs/vite-plugin` don't support it. If you add top-level `await` to `background.ts`, the build succeeds but the service worker fails to register ("top-level wait is disallowed").

## 2. Start the Bridge Server

```bash
# Terminal 1 — server
cd pi-browser-bridge
PI_BROWSER_BRIDGE_LOG_LEVEL=info bun run index.ts
# Expected output:
#   [INFO pi-browser-bridge] Starting WebSocket server on ws://localhost:9242
#   [INFO pi-browser-bridge] Ready on port 9242. Waiting for Chrome extension connection...
```

The server binds to `PI_BROWSER_PORT` env var (default: `9242`).

## 3. Verify Single Connection

```bash
# Terminal 2 — pi client
pi -p "Navigate to https://example.com and read the page title"
```

If the bridge is connected, pi uses `browser_navigate` + `browser_read` tools.  
If you get "No browser extension is connected", check the extension popup — toggle "Enable Bridge" ON and verify the port matches (9242).

## 4. Test Two Concurrent pi Sessions

```bash
# Terminal 2 — first pi client
pi -p "Navigate to https://httpbin.org/get, then read the JSON response"

# Terminal 3 — second pi client  
pi -p "Navigate to https://example.com and tell me the page title"
```

Both sessions share the same WebSocket server and Chrome extension. The server handles concurrent connections via `owner`/`client` failover — the first connection is the "owner" (receives browser messages), subsequent connections are "clients" (bridge their requests through the owner).

## 5. Debugging

```bash
# Check if server is listening
lsof -i :9242

# Check extension connection in browser console
# brave://extensions → "Pi Browser Bridge" → service worker → Console

# Enable debug logging
PI_BROWSER_BRIDGE_LOG_LEVEL=debug bun run index.ts

# Run extension tests (happy-dom, no browser needed)
bun run test:vitest
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "No browser extension connected" | Reload extension in `brave://extensions`, verify port 9242 |
| Request times out (30s) | Extension is connected but content script failed. Check the active tab isn't a restricted page (`chrome://`, `brave://`, `about:`) |
| "Content script not available" | Tab might be a restricted URL. Navigate to `https://example.com` first |
| Service worker fails to register | Rebuild extension after any `background.ts` changes |
| Two clients interfere | The second client must wait for the first to finish its current request |
