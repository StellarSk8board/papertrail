---
name: Web Browser
description: "Browse the web, take screenshots, interact with pages, fill forms. Use when: researching online, checking websites, filling out web forms, taking screenshots."
emoji: "🌐"
runtime: browser
tools:
  - browse:navigate
  - browse:screenshot
  - browse:click
  - browse:fill
  - browse:evaluate
---

# Web Browser Skill

You can browse the web using the browse:\* tools. A managed browser window handles navigation and interaction.

## Available Tools

- **browse:navigate** — Navigate to a URL and return the page text content. Params: `url` (string).
- **browse:screenshot** — Take a screenshot of the current page. Returns an image. No params.
- **browse:click** — Click an element by CSS selector. Params: `selector` (string).
- **browse:fill** — Fill a form field. Params: `selector` (string), `value` (string).
- **browse:evaluate** — Execute JavaScript in the page context and return the result. Params: `script` (string).

## Best Practices

- Navigate to the target page before interacting with elements
- Use specific CSS selectors to target elements precisely
- Wait for pages to load before taking screenshots or interacting
- Be mindful of the user's privacy when browsing
- Avoid logging into accounts or entering sensitive information unless explicitly asked
