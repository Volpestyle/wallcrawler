### Flow of Creating a Wallcrawler Stagehand Instance, Managing Sessions, and Handling Screencasts

Wallcrawler emulates Browserbase-like functionality but is self-hosted on AWS. Sessions are provisioned asynchronously via ECS tasks (running Chrome with CDP on port 9222 and an authenticated proxy on 9223). Screencasting uses Chrome's native DevTools Protocol (CDP) capabilities, with authentication via signed JWT URLs.

#### 1. **Creating a Wallcrawler Stagehand Instance**

- **Client-Side (Stagehand SDK)**:
  - Instantiate `new Stagehand({ env: "WALLCRAWLER" })` (defaults to Wallcrawler if not specified; requires `WALLCRAWLER_API_KEY` and `WALLCRAWLER_PROJECT_ID` env vars).
  - Call `stagehand.init()`:
    - Validates env vars and creates a `Wallcrawler` client (from `sdk-node`).
    - Calls `getBrowser()` internally, which:
      - If no existing session ID, creates a new session via `wallcrawler.sessions.create({ projectId })`.
      - Retrieves the session's `connectUrl` (a signed CDP WebSocket URL).
      - Connects to the remote browser via `chromium.connectOverCDP(connectUrl)`.
      - Applies stealth scripts to evade detection (e.g., hides `navigator.webdriver`).
    - Initializes `StagehandContext` and `StagehandPage` wrappers around the Playwright browser/context/page.
    - If using API mode (`useAPI: true`), initializes `StagehandAPI` client for proxying requests to backend endpoints.
  - Returns `{ sessionId, debugUrl }` (debugUrl points to a Wallcrawler debug endpoint for session inspection).
- **Backend Flow**:
  - No direct backend involvement here; the instance creation is client-side, but it triggers session creation (see below).

**Key Notes**: This sets up a CDP connection to a remote Chrome instance. If resuming an existing session (via `browserbaseSessionID` param), it validates the session status first.

#### 2. **Starting a Session**

- **Client-Side (Stagehand SDK)**:
  - Handled in `getBrowser()` during `init()`.
  - If no existing session, calls `wallcrawler.sessions.create()` (POST `/sessions/start` equivalent).
  - Connects via CDP to the returned `connectUrl`.
  - Stagehand injects DOM helper scripts (from `scriptContent`) for accessibility tree extraction and element interaction.
- **Backend Flow** (Triggered by Client Request):
  - Request hits `/sessions/start` Lambda (sessions-start/main.go):
    - Validates headers (e.g., `x-wc-api-key`, `x-wc-project-id`).
    - Generates session ID, stores initial state in Redis (status: CREATING).
    - Publishes "SessionCreateRequested" event to EventBridge with session details.
  - EventBridge routes to `session-provisioner` Lambda (session-provisioner/main.go):
    - Updates Redis status to PROVISIONING.
    - Launches ECS Fargate task (via `utils.CreateECSTask()`) using the browser task definition (includes Go controller + Chrome).
    - Monitors task startup asynchronously (polls for public IP, updates Redis with `connectUrl` like `ws://<public-ip>:9223?token=<jwt>`).
    - If fails (e.g., max 3 retries), publishes "SessionCreateFailed" and marks as FAILED in Redis.
  - Inside ECS Task (ecs-controller/main.go):
    - Starts Chrome with remote debugging on localhost:9222 (args include `--headless=new`, `--remote-debugging-port=9222`).
    - Waits for Chrome readiness (polls `/json/version`).
    - Initializes CDP connection via chromedp.
    - Starts authenticated CDP proxy on port 9223 (for external access).
    - Updates Redis status to READY and publishes "SessionChromeReady" event.
    - Listens for session events (e.g., act, observe) via Redis pub/sub and processes them (e.g., using CDP for navigation, LLM ops).
  - Session is "started" when ECS task is running and CDP is connectable (async; client polls or waits via `retrieve` endpoint).

**Key Notes**: Sessions are async and provisioned on-demand via ECS (preferred over Lambda per memories). Status flows: CREATING → PROVISIONING → STARTING → READY.

#### 3. **Starting/Stopping a Screencast of That Session**

- **Current Implementation**:
  - Screencasting uses **Chrome's native CDP screencast** (via DevTools Protocol), not a custom implementation.
  - **Starting**:
    - No explicit "start" API; it's enabled by connecting to the CDP WebSocket (port 9223 via signed URL).
    - Client requests signed URL via `/sessions/{id}/cdp-url` (cdp-url/main.go, not in attached files but referenced).
    - Connect a CDP client (e.g., Chrome DevTools) to `ws://<ecs-public-ip>:9223?token=<jwt>` (JWT auth via proxy).
    - In DevTools, enable screencast in the settings (streams video frames via CDP events like `Page.screencastFrame`).
  - **Stopping**:
    - Disconnect the CDP client; screencast stops automatically (no persistent streaming).
    - Full session stop (below) kills the ECS task and Chrome process.
- **Backend Handling**:
  - In ecs-controller, native screencast is mentioned; custom frame capture was removed (comments note: "Custom frame capture has been removed in favor of Chrome's built-in DevTools screencast").
  - Clients connect directly via signed URLs; proxy on 9223 handles auth and forwards to Chrome's localhost:9222.

**Key Notes**: No dedicated start/stop endpoints; it's client-driven via CDP. Gaps: No API for explicit screencast control (e.g., start/stop streaming without full CDP connection).

#### 4. **Pausing the Stagehand Instance for Human Input**

- **Current Implementation**:
  - No explicit "pause" method in Stagehand or backend.
  - Stagehand can "pause" by not calling methods like `act()`, `observe()`, etc., allowing manual interaction.
  - For remote input: Use the signed CDP URL to connect DevTools or a custom viewer (e.g., `components/BrowserViewer.tsx` for React-based viewing).
  - In Stagehand: Call `stagehand.page` methods manually (e.g., `page.click(selector)`) during pause.
  - Backend: While session is READY, external tools can connect via CDP proxy for live interaction (e.g., inspect, click elements).
- **Flow**:
  - After session start, get debug URL via `stagehand.init()` or `/sessions/{id}/debug`.
  - "Pause" automation by stopping Stagehand calls.
  - Human connects via CDP (e.g., open Chrome DevTools with the ws URL).
  - Resume by calling Stagehand methods again (e.g., `act()` refreshes page state via API if `useAPI: true`).

**Key Notes**: Pausing is implicit; no backend "pause" state in Redis. For true pausing, you'd need to suspend LLM events in ecs-controller.

#### 5. **Stopping the Session**

- **Client-Side**:
  - Call `stagehand.close()`: If API mode, calls `/sessions/{id}/end`; otherwise closes local Playwright context/browser.
- **Backend Flow**:
  - Request hits `/sessions/{id}/end` Lambda (end/main.go, not fully attached but referenced).
  - Publishes "SessionTerminationRequested" to EventBridge.
  - session-provisioner handles: Stops ECS task via `utils.StopECSTask()`.
  - ecs-controller cleanup: Stops Chrome (SIGTERM then kill), updates Redis to STOPPED, publishes "SessionCleanupCompleted".
  - Redis session deleted or marked inactive.

**Key Notes**: Ensures cleanup of ECS resources. If not called, sessions may idle until timeout (not implemented).

### Enabling Human Input into the Remote Browser CDP Screencast

Currently, human input is possible but manual and indirect. The system supports remote CDP access via signed URLs, but lacks a built-in interactive viewer for "human-in-the-loop" input during pauses.

#### What to Add:

1. **Frontend Viewer Integration**:
   - Use `components/BrowserViewer.tsx` (from client-nextjs) as a base: Embed an iframe or WebSocket-based viewer that connects to the signed CDP URL (ws://<ip>:9223?token=<jwt>).
   - Add a Stagehand method like `stagehand.enableHumanInput()`:
     - Calls `/sessions/{id}/cdp-url` to get signed URL.
     - Launches a local Next.js viewer (e.g., via `pnpm run` script) or integrates into an existing app.
     - Example: Render a React component that uses CDP client libs (e.g., `chrome-remote-interface`) to stream screencast and proxy inputs (clicks, typing).

2. **Backend Enhancements**:
   - Add `/sessions/{id}/screencast/start` endpoint: Enable CDP screencast mode explicitly (send `Page.startScreencast` via chromedp in ecs-controller).
   - For input: Ensure CDP proxy (port 9223) allows bidirectional events (e.g., `Input.dispatchMouseEvent` for clicks). It's already set up for this.
   - Secure access: Use JWT with short expiry for human sessions; add role-based auth (e.g., "viewer" vs. "controller").

3. **Stagehand SDK Additions**:
   - New method: `async pauseForInput(timeoutMs?: number)` – Pauses automation, opens viewer, resumes on input complete or timeout.
   - Event emitter: `stagehand.on('humanInputComplete', callback)` to resume after input.

4. **Tools/Libs**:
   - Use `puppeteer` or `playwright` in the viewer for proxying inputs to CDP.
   - For streaming: Handle `Page.screencastFrame` events to render video; send acknowledgments with `Page.screencastFrameAck`.

This would make "pausing for human input" seamless, e.g., during captcha solving or complex decisions.

### Gaps in the Implementation So Far

Based on code analysis:

1. **Screencast Handling**:
   - No explicit start/stop APIs; relies on client-side CDP connection. Add endpoints for control (e.g., start/stop streaming without full DevTools).
   - Removed custom frame capture (per ecs-controller comments) – if native CDP is insufficient (e.g., for low-latency), reimplement.

2. **Human Input/Pausing**:
   - No built-in pausing or viewer; human input requires manual CDP connection. Gaps in UX for "human-in-the-loop" (e.g., no integration with BrowserViewer.tsx).
   - Security: Signed URLs are good, but no viewer auth or session locking during human input.

3. **Session Management**:
   - Async provisioning: Client may need to poll `/retrieve` for READY status (not explicit in Stagehand init).
   - Retries: Max 3 in provisioner, but no client-side handling for failures.
   - Timeouts/Idling: No auto-termination for inactive sessions; could leak ECS resources.

4. **General**:
   - LLM Integration: Act/observe/extract assume OpenAI/Anthropic/Google; gaps for other providers in API mode.
   - Iframe Support: Experimental (`experimental: true` in Stagehand constructor); not fully stable.
   - Testing: Per rules, don't test features yourself – but code lacks integration tests for full flow.
   - Docs: wallcrawler-design-doc.md is source of truth, but attached code has inconsistencies (e.g., deleted screencast/main.go).
   - Direct Mode: Supported via proxy, but no client-side helpers for human input.

To address gaps, prioritize adding a viewer component and pause/resume APIs. If needed, I can propose code changes (e.g., via edit_file tool).
