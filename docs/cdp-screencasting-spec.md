# CDP Screencasting Specification

## Overview

Implement fully interactive browser JPG stream using CDP screencasting in @/components/BrowserStream.tsx.

## Requirements

- Real-time JPG frames from browser via CDP.
- Handle input events (mouse, keyboard) back to browser.
- React functional component with Tailwind CSS.
- Optimize for low latency/bandwidth.

## High-Level Design

1. **Connection**: Use Playwright CDP session to enable Page.startScreencast.
2. **Streaming**: Receive frames via 'Page.screencastFrame' event → Convert to JPG → Display in <img> or canvas.
3. **Interactivity**: Capture events on overlay div → Send via CDP (Input.dispatchMouseEvent, etc.).
4. **State Management**: useState for frame, useEffect for setup/cleanup.

## Implementation Steps

- Extend BrowserStream props: {cdpSession: CDPSession, quality?: number, fps?: number}
- In component: Enable screencast on mount, disable on unmount.
- Handle frame events: Acknowledge and update img src.
- Add event handlers for input forwarding.

## Edge Cases

- Handle resizing, full-screen.
- Fallback on connection loss.
- Mobile touch events.
