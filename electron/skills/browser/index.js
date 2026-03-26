// ─── Browser Runtime ──────────────────────────────────────────────
// Active skill runtime that manages a pool of hidden Electron BrowserWindow
// instances, one per agentId, up to a configurable maximum.

const BaseRuntime = require('../base-runtime');
const { BrowserWindow } = require('electron');

// Maximum number of concurrent browser windows
const MAX_WINDOWS = 3;

// Milliseconds to wait after navigation for dynamic content to settle
const NAVIGATE_SETTLE_MS = 1500;

// Milliseconds to wait after a click for any resulting navigation/render
const CLICK_SETTLE_MS = 500;

// Maximum characters of page text returned by browse:navigate
const TEXT_TRUNCATE_LIMIT = 10000;

class BrowserRuntime extends BaseRuntime {
  constructor() {
    super('browser');

    /** @type {Map<string, BrowserWindow>} agentId -> BrowserWindow */
    this.windows = new Map();
    this.maxWindows = MAX_WINDOWS;

    // ── Register tools ────────────────────────────────────────────
    this.registerTool('browse:navigate', {
      name: 'browse:navigate',
      description: 'Navigate to a URL and return the page text content',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to' },
          agentId: { type: 'string', description: 'Agent ID (for window management)' },
        },
        required: ['url'],
      },
    }, this._navigate, { timeout: 60_000 });

    this.registerTool('browse:screenshot', {
      name: 'browse:screenshot',
      description: 'Take a screenshot of the current page',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Agent ID' },
        },
        required: [],
      },
    }, this._screenshot);

    this.registerTool('browse:click', {
      name: 'browse:click',
      description: 'Click an element by CSS selector',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the element to click' },
          agentId: { type: 'string', description: 'Agent ID' },
        },
        required: ['selector'],
      },
    }, this._click);

    this.registerTool('browse:fill', {
      name: 'browse:fill',
      description: 'Fill a form field with a value',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector for the input element' },
          value: { type: 'string', description: 'Value to fill into the field' },
          agentId: { type: 'string', description: 'Agent ID' },
        },
        required: ['selector', 'value'],
      },
    }, this._fill);

    this.registerTool('browse:evaluate', {
      name: 'browse:evaluate',
      description: 'Execute JavaScript in the page context and return the result',
      parameters: {
        type: 'object',
        properties: {
          script: { type: 'string', description: 'JavaScript expression or statement to execute' },
          agentId: { type: 'string', description: 'Agent ID' },
        },
        required: ['script'],
      },
    }, this._evaluate);
  }

  // ── Auth ──────────────────────────────────────────────────────

  async authenticate() {
    this.status = 'connected';
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  async destroy() {
    for (const [, win] of this.windows) {
      if (!win.isDestroyed()) {
        win.close();
      }
    }
    this.windows.clear();
    this.status = 'disconnected';
  }

  // ── Private: window pool ───────────────────────────────────────

  _getOrCreateWindow(agentId) {
    const existing = this.windows.get(agentId);
    if (existing && !existing.isDestroyed()) {
      return existing;
    }

    // Evict the oldest window when the pool is full
    if (this.windows.size >= this.maxWindows) {
      const oldestId = this.windows.keys().next().value;
      const oldest = this.windows.get(oldestId);
      if (oldest && !oldest.isDestroyed()) {
        oldest.close();
      }
      this.windows.delete(oldestId);
    }

    const win = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
      },
    });

    win.on('closed', () => {
      if (this.windows.get(agentId) === win) {
        this.windows.delete(agentId);
      }
    });

    this.windows.set(agentId, win);
    return win;
  }

  // ── Tool implementations ──────────────────────────────────────

  async _navigate({ url, agentId }) {
    const win = this._getOrCreateWindow(agentId || 'default');
    await win.loadURL(url);
    await _sleep(NAVIGATE_SETTLE_MS);

    let title = '';
    let text = '';

    try {
      title = await win.webContents.executeJavaScript('document.title');
    } catch (err) {
      console.warn('[browser] Could not read document.title:', err.message);
    }

    try {
      text = await win.webContents.executeJavaScript('document.body.innerText');
    } catch (err) {
      console.warn('[browser] Could not read document.body.innerText:', err.message);
      text = '';
    }

    const truncated =
      text.length > TEXT_TRUNCATE_LIMIT
        ? text.slice(0, TEXT_TRUNCATE_LIMIT) + '\n\n[truncated]'
        : text;

    return `# ${title}\n\n${truncated}`;
  }

  async _screenshot({ agentId }) {
    const win = this._getOrCreateWindow(agentId || 'default');
    try {
      const image = await win.webContents.capturePage();
      const base64 = image.toPNG().toString('base64');
      const { width, height } = image.getSize();
      return `[Screenshot captured: ${width}x${height}px, base64 length: ${base64.length}]`;
    } catch (err) {
      throw new Error(`browse:screenshot failed: ${err.message}`);
    }
  }

  async _click({ selector, agentId }) {
    const win = this._getOrCreateWindow(agentId || 'default');
    try {
      await win.webContents.executeJavaScript(
        `document.querySelector(${JSON.stringify(selector)})?.click()`
      );
    } catch (err) {
      throw new Error(`browse:click failed for selector "${selector}": ${err.message}`);
    }
    await _sleep(CLICK_SETTLE_MS);
    return `Clicked: ${selector}`;
  }

  async _fill({ selector, value, agentId }) {
    const win = this._getOrCreateWindow(agentId || 'default');
    try {
      await win.webContents.executeJavaScript(`
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
          el.value = ${JSON.stringify(value)};
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        })()
      `);
    } catch (err) {
      throw new Error(`browse:fill failed for selector "${selector}": ${err.message}`);
    }
    return `Filled ${selector} with value`;
  }

  async _evaluate({ script, agentId }) {
    const win = this._getOrCreateWindow(agentId || 'default');
    let result;
    try {
      result = await win.webContents.executeJavaScript(script);
    } catch (err) {
      throw new Error(`browse:evaluate failed: ${err.message}`);
    }
    return String(result);
  }
}

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = BrowserRuntime;
