(function (Scratch) {
  'use strict';

  /**
   * Console extension — IntersectionObserver + visible-line periodic updates
   *
   * Behavior:
   * - 'relative' timestamp format updates timestamps ONLY for lines that are visible (intersecting).
   * - Visible lines are refreshed every 200 ms (0.2s).
   * - Lines refresh immediately when they become visible.
   * - No non-visible timers.
   *
   * Keeps prior features: gradients, placeholder handling, autoscroll, instant input show/hide autoscroll.
   */

  const BlockType = (Scratch && Scratch.BlockType) ? Scratch.BlockType : {
    COMMAND: 'command', REPORTER: 'reporter', BOOLEAN: 'boolean', HAT: 'hat', LABEL: 'label'
  };
  const ArgumentType = (Scratch && Scratch.ArgumentType) ? Scratch.ArgumentType : {
    STRING: 'string', NUMBER: 'number', COLOR: 'color', BOOLEAN: 'boolean'
  };

  class ConsoleExtension {
    constructor () {
      this.id = 'console';
      this.name = 'Console';

      // UI & DOM
      this.consoleVisible = false;
      this.inputVisible = false;
      this.consoleOverlay = null;
      this.inputOverlay = null;
      this.logArea = null;
      this.inputField = null;
      this.stage = null;

      // data
      this._consoleCache = []; // entries: { id, text, colorRaw, ts }
      this._nextId = 1;
      this._inputCache = '';
      this.lastInput = '';

      // styling defaults
      this._defaults = {
        consoleBG: '#000000',
        inputBG: '#222222',
        inputTextRaw: '#FFFFFF',
        timestampTextRaw: '#FFFFFF',
        inputPlaceholder: 'Type command...',
        inputPlaceholderColorRaw: '#888888',
        fontText: 'Sans Serif',
        fontTimestamp: 'Sans Serif',
        fontInput: 'Sans Serif',
        sizeText: 1,
        sizeTimestamp: 1,
        sizeInput: 1,
        textAlign: 'left',
        inputAlign: 'left',
        lineSpacing: 1.4
      };
      this.style = Object.assign({}, this._defaults);

      this.lineSpacing = this._defaults.lineSpacing;
      this.logInputEnabled = true;
      this.textSelectable = true;

      // scroll & autoscroll
      this._autoScrollEnabled = true;
      this._scrollCache = 0;
      this._lastUserScroll = 0;
      this._userScrollGrace = 2000;

      // timestamp format state
      this._timestampFormat = 'off'; // off|24h|12h|relative

      // IntersectionObserver + visible update loop
      this._io = null; // IntersectionObserver
      this._ioOptions = { root: null, rootMargin: '0px', threshold: [0, 0.01] };
      this._visibleSet = new Set(); // currently visible elements
      this._visibleUpdateInterval = null;
      this._visibleIntervalMs = 200; // 0.2s as requested

      // helpers
      this._observer = null;
      this._recoveryInterval = null;
      this._placeholderStyleEl = null;

      // feature detection
      this._supportsBackgroundClipText = this._detectBackgroundClipTextSupport();

      // bind exported methods
      const methods = [
        'getInfo','toggleConsole','showConsole','hideConsole','clearConsole','logMessage','logDots','removeLine',
        'getConsoleAsArray','setConsoleFromArray','getConsoleLineCount','isConsoleShown','setSelectable',
        'setTimestampFormat','toggleInput','showInput','hideInput','setInputText','runInput','clearInput','setLogInput',
        'whenInput','getLastInput','getCurrentInput','isInputShown',
        'setColorPicker','gradientReporter','gradient3Reporter','gradient4Reporter','setFont','setTextSizeMultiplier','setAlignment','setLineSpacing','setInputPlaceholder',
        'resetStyling','setConsoleScrollTo','consoleMaxScroll','consoleCurrentScroll','setAutoScroll','isAutoScroll'
      ];
      for (const m of methods) if (typeof this[m] === 'function') this[m] = this[m].bind(this);

      // startup
      this._injectBaseCSS();
      this._waitForStage();
      this._startRecovery();
    }

    // ---- block metadata ----
    getInfo () {
      return {
        id: this.id,
        name: this.name,
        color1: '#333333',
        color2: '#222222',
        color3: '#111111',
        blocks: [
          { opcode: 'toggleConsole', blockType: BlockType.COMMAND, text: '[ACTION] console', arguments: { ACTION: { type: ArgumentType.STRING, menu: 'toggleMenu', defaultValue: 'show' } } },
          { opcode: 'clearConsole', blockType: BlockType.COMMAND, text: 'clear console' },
          { opcode: 'logMessage', blockType: BlockType.COMMAND, text: 'log [TEXT] in color [COLOR]', arguments: { TEXT: { type: ArgumentType.STRING, defaultValue: 'Hello!' }, COLOR: { type: ArgumentType.COLOR, defaultValue: '#FFFFFF' } } },
          { opcode: 'logDots', blockType: BlockType.COMMAND, text: 'log dots' },
          { opcode: 'removeLine', blockType: BlockType.COMMAND, text: 'remove console line [INDEX]', arguments: { INDEX: { type: ArgumentType.NUMBER, defaultValue: 1 } } },

          { opcode: 'getConsoleAsArray', blockType: BlockType.REPORTER, text: 'get console JSON' },
          { opcode: 'setConsoleFromArray', blockType: BlockType.COMMAND, text: 'load console from JSON [ARRAY]', arguments: { ARRAY: { type: ArgumentType.STRING, defaultValue: '[]' } } },
          { opcode: 'getConsoleLineCount', blockType: BlockType.REPORTER, text: 'console line count' },
          { opcode: 'isConsoleShown', blockType: BlockType.BOOLEAN, text: 'console shown?' },

          { blockType: BlockType.LABEL, text: 'Scroll' },
          { opcode: 'setConsoleScrollTo', blockType: BlockType.COMMAND, text: 'set console scroll to [Y]', arguments: { Y: { type: ArgumentType.NUMBER, defaultValue: 0 } } },
          { opcode: 'consoleMaxScroll', blockType: BlockType.REPORTER, text: 'console max scroll' },
          { opcode: 'consoleCurrentScroll', blockType: BlockType.REPORTER, text: 'console current scroll' },
          { opcode: 'setAutoScroll', blockType: BlockType.COMMAND, text: 'set autscroll to [ENABLED]', arguments: { ENABLED: { type: ArgumentType.BOOLEAN, defaultValue: true } } },
          { opcode: 'isAutoScroll', blockType: BlockType.BOOLEAN, text: 'is autoscroll on?' },

          { blockType: BlockType.LABEL, text: 'Input' },
          { opcode: 'toggleInput', blockType: BlockType.COMMAND, text: '[ACTION] input', arguments: { ACTION: { type: ArgumentType.STRING, menu: 'toggleMenu', defaultValue: 'show' } } },
          { opcode: 'setInputText', blockType: BlockType.COMMAND, text: 'set input to [DATA]', arguments: { DATA: { type: ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'runInput', blockType: BlockType.COMMAND, text: 'run [TEXT]', arguments: { TEXT: { type: ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'clearInput', blockType: BlockType.COMMAND, text: 'clear input' },
          { opcode: 'setLogInput', blockType: BlockType.COMMAND, text: 'set log input to [ENABLED]', arguments: { ENABLED: { type: ArgumentType.BOOLEAN, defaultValue: true } } },
          { opcode: 'whenInput', blockType: BlockType.HAT, text: 'when input entered' },
          { opcode: 'getLastInput', blockType: BlockType.REPORTER, text: 'last input' },
          { opcode: 'getCurrentInput', blockType: BlockType.REPORTER, text: 'current input' },
          { opcode: 'isInputShown', blockType: BlockType.BOOLEAN, text: 'input shown?' },

          { blockType: BlockType.LABEL, text: 'Styling' },
          { opcode: 'setColorPicker', blockType: BlockType.COMMAND, text: 'set [PART] color to [COLOR]', arguments: { PART: { type: ArgumentType.STRING, menu: 'colorParts', defaultValue: 'console background' }, COLOR: { type: ArgumentType.COLOR, defaultValue: '#000000' } } },
          { opcode: 'gradientReporter', blockType: BlockType.REPORTER, text: 'gradient [COLOR1] to [COLOR2] angle [ANGLE]', arguments: { COLOR1: { type: ArgumentType.COLOR, defaultValue: '#000000' }, COLOR2: { type: ArgumentType.COLOR, defaultValue: '#333333' }, ANGLE: { type: ArgumentType.NUMBER, defaultValue: 180 } } },
          { opcode: 'gradient3Reporter', blockType: BlockType.REPORTER, text: 'gradient [COLOR1] to [COLOR2] to [COLOR3] angle [ANGLE]', arguments: { COLOR1: { type: ArgumentType.COLOR, defaultValue: '#000000' }, COLOR2: { type: ArgumentType.COLOR, defaultValue: '#555555' }, COLOR3: { type: ArgumentType.COLOR, defaultValue: '#999999' }, ANGLE: { type: ArgumentType.NUMBER, defaultValue: 180 } } },
          { opcode: 'gradient4Reporter', blockType: BlockType.REPORTER, text: 'gradient [COLOR1] to [COLOR2] to [COLOR3] to [COLOR4] angle [ANGLE]', arguments: { COLOR1: { type: ArgumentType.COLOR, defaultValue: '#000000' }, COLOR2: { type: ArgumentType.COLOR, defaultValue: '#444444' }, COLOR3: { type: ArgumentType.COLOR, defaultValue: '#888888' }, COLOR4: { type: ArgumentType.COLOR, defaultValue: '#CCCCCC' }, ANGLE: { type: ArgumentType.NUMBER, defaultValue: 180 } } },

          { opcode: 'setFont', blockType: BlockType.COMMAND, text: 'set [PART] font to [FONT]', arguments: { PART: { type: ArgumentType.STRING, menu: 'fontParts', defaultValue: 'text' }, FONT: { type: ArgumentType.STRING, defaultValue: 'Sans Serif' } } },
          { opcode: 'setTextSizeMultiplier', blockType: BlockType.COMMAND, text: 'set [PART] text size multiplier to [MULTIPLIER]', arguments: { PART: { type: ArgumentType.STRING, menu: 'sizeParts', defaultValue: 'text' }, MULTIPLIER: { type: ArgumentType.NUMBER, defaultValue: 1 } } },
          { opcode: 'setAlignment', blockType: BlockType.COMMAND, text: 'set [PART] alignment to [ALIGN]', arguments: { PART: { type: ArgumentType.STRING, menu: 'alignmentParts', defaultValue: 'text' }, ALIGN: { type: ArgumentType.STRING, menu: 'alignmentMenu', defaultValue: 'left' } } },

          { opcode: 'setLineSpacing', blockType: BlockType.COMMAND, text: 'set line spacing to [SPACING]', arguments: { SPACING: { type: ArgumentType.NUMBER, defaultValue: 1.4 } } },
          { opcode: 'setInputPlaceholder', blockType: BlockType.COMMAND, text: 'set input placeholder to [TEXT]', arguments: { TEXT: { type: ArgumentType.STRING, defaultValue: 'Type command...' } } },
          { opcode: 'setTimestampFormat', blockType: BlockType.COMMAND, text: 'set timestamp format to [FORMAT]', arguments: { FORMAT: { type: ArgumentType.STRING, menu: 'timeFormat', defaultValue: 'off' } } },
          { opcode: 'resetStyling', blockType: BlockType.COMMAND, text: 'reset styling' }
        ],
        menus: {
          toggleMenu: ['show', 'hide', 'toggle'],
          timeFormat: ['off', '24h', '12h', 'relative'],
          colorParts: ['console background', 'input background', 'input text', 'timestamp text', 'input placeholder'],
          fontParts: ['text', 'timestamp', 'input'],
          sizeParts: ['text', 'timestamp', 'input'],
          alignmentParts: ['text', 'input'],
          alignmentMenu: ['left', 'center', 'right']
        }
      };
    }

    // ---- CSS ----
    _injectBaseCSS () {
      const style = document.createElement('style');
      style.textContent = `
        .consoleOverlay, .consoleOverlay * { scrollbar-width: none; -ms-overflow-style: none; }
        .consoleOverlay::-webkit-scrollbar, .consoleOverlay *::-webkit-scrollbar { display: none; }
        .console-line { white-space: pre-wrap; word-break: break-word; display: block; }
        .console-input { outline: none !important; box-shadow: none !important; border: none !important; background-repeat: no-repeat; }
        .console-input::placeholder { color: var(--console-input-placeholder-color, ${this._defaults.inputPlaceholderColorRaw}) !important; opacity: 1 !important; }
        .console-line span { vertical-align: middle; }
      `;
      document.head.appendChild(style);
    }

    // ---- detection ----
    _detectBackgroundClipTextSupport () {
      try {
        if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
          if (CSS.supports('-webkit-background-clip', 'text')) return true;
          if (CSS.supports('background-clip', 'text')) return true;
        }
        const tmp = document.createElement('span');
        tmp.style.cssText = '-webkit-background-clip:text;background-clip:text;color:transparent;';
        document.body.appendChild(tmp);
        const cs = window.getComputedStyle(tmp);
        const ok = (cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text');
        tmp.remove();
        return !!ok;
      } catch (e) { return false; }
    }

    // ---- stage detection / recovery ----
    _waitForStage () {
      const loop = () => {
        const canvasParent = (typeof vm !== 'undefined' && vm && vm.runtime && vm.runtime.renderer && vm.runtime.renderer.canvas)
          ? vm.runtime.renderer.canvas.parentElement
          : null;
        this.stage = canvasParent || document.querySelector('.stage') || document.body;
        if (this.stage) this._observeResize();
        else requestAnimationFrame(loop);
      };
      loop();
    }

    _observeResize () {
      if (this._observer) return;
      try {
        this._observer = new ResizeObserver(() => {
          if (this.inputField && typeof this.inputField.value === 'string') this._inputCache = this.inputField.value;
          this._ensureUI();
          this._resizeDynamicSizes();
        });
        this._observer.observe(this.stage);
      } catch (e) {}
    }

    _startRecovery () {
      if (this._recoveryInterval) clearInterval(this._recoveryInterval);
      this._recoveryInterval = setInterval(() => {
        if (this.inputField && typeof this.inputField.value === 'string') this._inputCache = this.inputField.value;
        this._ensureUI();
        this._resizeDynamicSizes();
        if (Date.now() - (this._lastUserScroll || 0) > this._userScrollGrace) this._applyCachedScroll();
      }, 500);
    }

    _ensureUI () {
      if (!this.stage) return;

      if (this.consoleVisible && (!this.consoleOverlay || !this.stage.contains(this.consoleOverlay))) {
        this.consoleOverlay = null;
        this.logArea = null;
        this._createConsole();
        this._restoreConsoleCache();
      }

      if (this.inputVisible && (!this.inputOverlay || !this.stage.contains(this.inputOverlay))) {
        if (this.inputOverlay && this.inputField && typeof this.inputField.value === 'string') this._inputCache = this.inputField.value;
        this.inputOverlay = null;
        this.inputField = null;
        this._createInput();
        if (this.inputField && this._inputCache) this.inputField.value = this._inputCache;
      }

      // apply cached scroll after attaches
      if (Date.now() - (this._lastUserScroll || 0) > this._userScrollGrace) this._applyCachedScroll();
    }

    _resizeDynamicSizes () {
      const stageH = (typeof vm !== 'undefined' && vm && vm.runtime && vm.runtime.renderer && vm.runtime.renderer.canvas)
        ? vm.runtime.renderer.canvas.clientHeight
        : 360;
      const scale = stageH / 360;
      const base = 14;
      this._computedTextPx = Math.max(10, base * scale * (this.style.sizeText || 1));
      this._computedTsPx = Math.max(10, base * scale * (this.style.sizeTimestamp || 1));
      this._computedInputPx = Math.max(10, base * scale * (this.style.sizeInput || 1));

      if (this.logArea) {
        for (const line of Array.from(this.logArea.children)) {
          const spans = line.querySelectorAll('span');
          if (spans[0]) spans[0].style.fontSize = `${this._computedTsPx}px`;
          if (spans[1]) spans[1].style.fontSize = `${this._computedTextPx}px`;
        }
      }
      if (this.inputField) {
        this.inputField.style.fontSize = `${this._computedInputPx}px`;
        this.inputField.style.fontFamily = this.style.fontInput;
        this.inputField.style.textAlign = this.style.inputAlign;
      }

      if (this.consoleOverlay && this.inputField && this.inputVisible) {
        const inputHt = this.inputField.getBoundingClientRect().height || (this._computedInputPx + 16);
        this.consoleOverlay.style.paddingBottom = `${inputHt}px`;
      } else if (this.consoleOverlay) {
        this.consoleOverlay.style.paddingBottom = '';
      }
    }

    // ---- create/destroy console & input ----
    _createConsole () {
      if (!this.stage) return;
      if (this.consoleOverlay && this.stage.contains(this.consoleOverlay)) return;

      const overlay = document.createElement('div');
      overlay.className = 'consoleOverlay';
      Object.assign(overlay.style, {
        position: 'absolute',
        top: '0', left: '0', right: '0', bottom: '0',
        display: 'flex', flexDirection: 'column',
        zIndex: '50', overflowY: 'auto', padding: '10px',
        background: this.style.consoleBG,
        boxSizing: 'border-box',
        userSelect: this.textSelectable ? 'text' : 'none'
      });

      const logArea = document.createElement('div');
      logArea.style.flex = '1';
      logArea.style.overflowY = 'auto';
      logArea.style.WebkitOverflowScrolling = 'touch';
      logArea.addEventListener('scroll', () => {
        this._lastUserScroll = Date.now();
        try { this._scrollCache = this.logArea ? this.logArea.scrollTop : this._scrollCache; } catch (e) {}
      }, { passive: true });

      overlay.appendChild(logArea);
      try { this.stage.appendChild(overlay); } catch (e) { document.body.appendChild(overlay); }

      this.consoleOverlay = overlay;
      this.logArea = logArea;

      // if relative mode active, ensure all existing lines are observed
      if (this._timestampFormat === 'relative') this._setupObserverForRelative();

      this._resizeDynamicSizes();
    }

    _createInput () {
      if (!this.stage) return;
      if (this.inputOverlay && this.stage.contains(this.inputOverlay)) return;

      const overlay = document.createElement('div');
      Object.assign(overlay.style, { position: 'absolute', left: '0', right: '0', bottom: '0', zIndex: '60', boxSizing: 'border-box' });

      const input = document.createElement('input');
      input.className = 'console-input';
      Object.assign(input.style, {
        width: '100%', border: 'none', outline: 'none', padding: '10px',
        background: this.style.inputBG, color: this._firstColorFromRaw(this.style.inputTextRaw), fontFamily: this.style.fontInput, boxSizing: 'border-box'
      });

      input.placeholder = this.style.inputPlaceholder != null ? this.style.inputPlaceholder : this._defaults.inputPlaceholder;
      this._updatePlaceholderCSS(this.style.inputPlaceholderColorRaw || this._defaults.inputPlaceholderColorRaw);

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const txt = input.value;
          input.value = '';
          this._inputCache = '';
          this._dispatchInput(txt, true);
        }
      });
      input.addEventListener('input', () => { this._inputCache = input.value; });
      input.addEventListener('blur', () => { this._inputCache = input.value; });

      overlay.appendChild(input);
      try { this.stage.appendChild(overlay); } catch (e) { document.body.appendChild(overlay); }

      this.inputOverlay = overlay;
      this.inputField = input;

      this._applyInputBackground(this.style.inputBG);
      this._applyInputTextColor(this.style.inputTextRaw);

      this._resizeDynamicSizes();
    }

    // ---- gradient reporters / parsing ----
    gradientReporter (args) {
      const c1 = String(args.COLOR1 || '').trim();
      const c2 = String(args.COLOR2 || '').trim();
      const angle = Number(args.ANGLE || 180) || 180;
      return `${c1},${c2},${angle}`;
    }
    gradient3Reporter (args) {
      const c1 = String(args.COLOR1 || '').trim();
      const c2 = String(args.COLOR2 || '').trim();
      const c3 = String(args.COLOR3 || '').trim();
      const angle = Number(args.ANGLE || 180) || 180;
      return `${c1},${c2},${c3},${angle}`;
    }
    gradient4Reporter (args) {
      const c1 = String(args.COLOR1 || '').trim();
      const c2 = String(args.COLOR2 || '').trim();
      const c3 = String(args.COLOR3 || '').trim();
      const c4 = String(args.COLOR4 || '').trim();
      const angle = Number(args.ANGLE || 180) || 180;
      return `${c1},${c2},${c3},${c4},${angle}`;
    }

    _parseColorArg (colorArg) {
      const raw = String(colorArg || '').trim();
      if (!raw) return { isGradient: false, color: '#FFFFFF', gradientCSS: '' };
      if (/^linear-gradient\(/i.test(raw)) {
        const firstMatch = raw.match(/rgba?\([^\)]+\)|#[0-9A-Fa-f]+|[a-zA-Z\-]+/);
        const first = firstMatch ? firstMatch[0] : '#FFFFFF';
        return { isGradient: true, color: first, gradientCSS: raw, colors: [], angle: 180 };
      }
      const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length === 0) return { isGradient: false, color: '#FFFFFF', gradientCSS: '' };
      if (parts.length === 1) return { isGradient: false, color: parts[0], gradientCSS: '' };
      let angle = 180;
      let colors = parts.slice(0);
      const last = parts[parts.length - 1];
      if (/^-?\d+(\.\d+)?$/.test(last)) { angle = Number(last); colors = parts.slice(0, -1); }
      const gradientCSS = `linear-gradient(${angle}deg, ${colors.join(', ')})`;
      return { isGradient: true, color: colors[0] || '#FFFFFF', gradientCSS, colors, angle };
    }

    _firstColorFromRaw (raw) {
      try {
        const p = this._parseColorArg(raw);
        return p.color || '#FFFFFF';
      } catch (e) { return '#FFFFFF'; }
    }

    // ---- input background / text composition ----
    _applyInputBackground (bgRaw) {
      if (!this.inputField) return;
      const parsed = this._parseColorArg(bgRaw);
      if (parsed.isGradient && parsed.gradientCSS) this.inputField.style.background = parsed.gradientCSS;
      else this.inputField.style.background = parsed.color || this._defaults.inputBG;
    }

    _applyInputTextColor (rawColor) {
      if (!this.inputField) return;
      const parsedText = this._parseColorArg(rawColor);
      const parsedBg = this._parseColorArg(this.style.inputBG);
      const bgLayer = parsedBg.isGradient ? parsedBg.gradientCSS : (parsedBg.color || this._defaults.inputBG);

      if (parsedText.isGradient && parsedText.gradientCSS && this._supportsBackgroundClipText) {
        const textGradient = parsedText.gradientCSS;
        this.inputField.style.background = `${textGradient}, ${bgLayer}`;
        this.inputField.style.backgroundRepeat = 'no-repeat, no-repeat';
        this.inputField.style.backgroundSize = '100% 100%, 100% 100%';
        try {
          this.inputField.style.webkitBackgroundClip = 'text, padding-box';
          this.inputField.style.backgroundClip = 'text, padding-box';
        } catch (e) {
          this.inputField.style.webkitBackgroundClip = 'text';
          this.inputField.style.backgroundClip = 'text';
        }
        this.inputField.style.webkitTextFillColor = 'transparent';
        this.inputField.style.color = 'transparent';
      } else {
        const solidColor = parsedText.color || this._firstColorFromRaw(rawColor) || '#FFFFFF';
        this.inputField.style.background = bgLayer;
        this.inputField.style.backgroundRepeat = '';
        this.inputField.style.backgroundSize = '';
        this.inputField.style.webkitBackgroundClip = '';
        this.inputField.style.backgroundClip = '';
        this.inputField.style.webkitTextFillColor = '';
        this.inputField.style.color = solidColor;
      }

      this._updatePlaceholderCSS(this.style.inputPlaceholderColorRaw || this._defaults.inputPlaceholderColorRaw);
    }

    _updatePlaceholderCSS (colorRaw) {
      try {
        const parsed = this._parseColorArg(colorRaw || this._defaults.inputPlaceholderColorRaw);
        const placeholderSolid = parsed.color || this._defaults.inputPlaceholderColorRaw;
        const id = 'console-ext-placeholder-style';
        let el = this._placeholderStyleEl || document.getElementById(id);
        if (!el) {
          el = document.createElement('style');
          el.id = id;
          document.head.appendChild(el);
        }

        if (parsed.isGradient && parsed.gradientCSS && this._supportsBackgroundClipText) {
          el.textContent =
            `.console-input::placeholder, .consoleOverlay input::placeholder { color: ${placeholderSolid} !important; opacity: 1 !important; }` +
            `.console-input::-webkit-input-placeholder, .consoleOverlay input::-webkit-input-placeholder { color: ${placeholderSolid} !important; }` +
            `.console-input:-ms-input-placeholder, .consoleOverlay input:-ms-input-placeholder { color: ${placeholderSolid} !important; }` +
            `.console-input::placeholder { background-image: ${parsed.gradientCSS}; -webkit-background-clip: text; background-clip: text; color: transparent !important; }` +
            `.console-input::-webkit-input-placeholder { background-image: ${parsed.gradientCSS}; -webkit-background-clip: text; background-clip: text; color: transparent !important; }`;
        } else {
          el.textContent =
            `.console-input::placeholder, .consoleOverlay input::placeholder { color: ${placeholderSolid} !important; opacity: 1 !important; }` +
            `.console-input::-webkit-input-placeholder, .consoleOverlay input::-webkit-input-placeholder { color: ${placeholderSolid} !important; }` +
            `.console-input:-ms-input-placeholder, .consoleOverlay input:-ms-input-placeholder { color: ${placeholderSolid} !important; }`;
        }
        this._placeholderStyleEl = el;
      } catch (e) {}
    }

    // ---- create line element & coloring ----
    _createLineElement (entry) {
      const container = document.createElement('div');
      container.className = 'console-line';
      container.style.lineHeight = String(this.style.lineSpacing || this._defaults.lineSpacing);
      container.style.textAlign = this.style.textAlign;
      container.dataset.id = String(entry.id);
      container.dataset.ts = String(entry.ts || Date.now());

      const tsSpan = document.createElement('span');
      const fmt = (this._timestampFormat === 'off') ? '' : this._formatTimestamp(entry.ts);
      tsSpan.textContent = fmt ? `[${fmt}] ` : '';
      tsSpan.style.fontFamily = this.style.fontTimestamp;
      tsSpan.style.display = 'inline';
      this._applyInlineTextColor(tsSpan, this.style.timestampTextRaw);

      const msgSpan = document.createElement('span');
      msgSpan.textContent = entry.text;
      msgSpan.style.fontFamily = this.style.fontText;
      msgSpan.style.display = 'inline';
      this._applyInlineTextColor(msgSpan, entry.colorRaw || '#FFFFFF');

      container.appendChild(tsSpan);
      container.appendChild(msgSpan);
      return container;
    }

    _applyInlineTextColor (el, rawColorArg) {
      if (!el) return;
      const parsed = this._parseColorArg(rawColorArg);
      if (parsed.isGradient && parsed.gradientCSS) {
        el.style.backgroundImage = parsed.gradientCSS;
        el.style.backgroundRepeat = 'no-repeat';
        el.style.backgroundSize = '100% 100%';
        el.style.webkitBackgroundClip = 'text';
        el.style.backgroundClip = 'text';
        el.style.webkitTextFillColor = 'transparent';
        el.style.color = 'transparent';
        if (getComputedStyle(el).display === 'inline') el.style.display = 'inline-block';
      } else {
        el.style.backgroundImage = '';
        el.style.webkitBackgroundClip = '';
        el.style.backgroundClip = '';
        el.style.webkitTextFillColor = '';
        el.style.color = parsed.color || '#FFFFFF';
      }
    }

    _addLineToDOM (entry, skipAutoScroll = false) {
      if (!this.logArea) {
        if (!this.consoleVisible) return;
        this._createConsole();
      }

      let priorAtBottom = false;
      try { priorAtBottom = (this.logArea.scrollTop + this.logArea.clientHeight) >= (this.logArea.scrollHeight - 5); } catch (e) { priorAtBottom = false; }

      const el = this._createLineElement(entry);
      this.logArea.appendChild(el);

      // observe the new line immediately if relative mode is active
      if (this._timestampFormat === 'relative' && this._io) {
        try { this._io.observe(el); } catch (e) {}
      }

      this._resizeDynamicSizes();

      if (!skipAutoScroll && this._autoScrollEnabled && priorAtBottom) this._instantScrollToBottom();
    }

    _restoreConsoleCache () {
      if (!this.logArea) return;
      const prevScroll = this.logArea.scrollTop || 0;
      const prevMax = this.logArea.scrollHeight || 0;
      const wasAtBottom = (prevScroll + this.logArea.clientHeight) >= (prevMax - 5);

      this.logArea.innerHTML = '';
      for (const entry of this._consoleCache) {
        const el = this._createLineElement(entry);
        this.logArea.appendChild(el);
      }

      // if relative active, observe all lines now
      if (this._timestampFormat === 'relative' && this._io) this._observeAllLines();

      this._resizeDynamicSizes();

      if (wasAtBottom) {
        this.logArea.scrollTop = this.logArea.scrollHeight;
        this._scrollCache = this.logArea.scrollTop;
      } else {
        const newMax = this.logArea.scrollHeight || 0;
        const clamped = Math.min(Math.max(0, prevScroll), Math.max(0, newMax - this.logArea.clientHeight));
        this.logArea.scrollTop = isFinite(clamped) ? clamped : 0;
        this._scrollCache = this.logArea.scrollTop;
      }
    }

    // ---- logging API ----
    _log (text, colorRaw = '#FFFFFF') {
      const entry = { id: this._nextId++, text: String(text), colorRaw: String(colorRaw), ts: Date.now() };
      this._consoleCache.push(entry);
      if (this._dotsInterval) this._stopDots();
      this._addLineToDOM(entry);
    }
    logMessage (args) { this._log(args.TEXT, args.COLOR); }
    clearConsole () { this._consoleCache = []; if (this.logArea) this.logArea.innerHTML = ''; this._scrollCache = 0; }

    logDots () {
      if (!this.consoleVisible && !this.logArea) return;
      if (!this.logArea) this._createConsole();
      this._stopDots();

      const el = document.createElement('div');
      el.className = 'console-line';
      el.style.color = '#888';
      el.style.fontFamily = this.style.fontText;
      el.style.lineHeight = String(this.style.lineSpacing || this._defaults.lineSpacing);
      el.textContent = '.';
      this.logArea.appendChild(el);
      this._dotsElement = el;
      this._dotsStep = 0;
      const frames = ['.', '..', '...'];
      this._dotsInterval = setInterval(() => {
        this._dotsStep = (this._dotsStep + 1) % frames.length;
        if (this._dotsElement) this._dotsElement.textContent = frames[this._dotsStep];
      }, 200);

      if (this._autoScrollEnabled) this._instantScrollToBottom();
    }
    _stopDots () { if (this._dotsInterval) clearInterval(this._dotsInterval); this._dotsInterval = null; if (this._dotsElement) { this._dotsElement.remove(); this._dotsElement = null; } }

    removeLine (args) {
      const visibleIndex = Math.max(1, Math.floor(Number(args.INDEX) || 1));
      const idx = visibleIndex - 1;
      if (idx < 0 || idx >= this._consoleCache.length) return;

      if (this.logArea) {
        const prevScroll = this.logArea.scrollTop || 0;
        const prevClientH = this.logArea.clientHeight || 0;
        const prevScrollHeight = this.logArea.scrollHeight || 0;
        const wasAtBottom = (prevScroll + prevClientH) >= (prevScrollHeight - 5);

        const entry = this._consoleCache[idx];
        const el = this.logArea.querySelector(`[data-id="${entry.id}"]`);
        if (el) {
          // unobserve removed element to avoid leaking observers
          if (this._io) try { this._io.unobserve(el); } catch (e) {}
          this._visibleSet.delete(el);
          el.remove();
        }

        this._consoleCache.splice(idx, 1);

        if (wasAtBottom) this.logArea.scrollTop = this.logArea.scrollHeight;
        else {
          const newMax = Math.max(0, this.logArea.scrollHeight - this.logArea.clientHeight);
          this.logArea.scrollTop = Math.min(newMax, Math.max(0, prevScroll));
        }
      } else {
        this._consoleCache.splice(idx, 1);
      }
    }

    // ---- persistence ----
    getConsoleAsArray () { try { return JSON.stringify(this._consoleCache); } catch (e) { return '[]'; } }
    setConsoleFromArray (args) {
      try {
        const arr = JSON.parse(String(args.ARRAY || '[]'));
        if (!Array.isArray(arr)) return;
        this._consoleCache = arr.map(e => ({
          id: e.id ? Number(e.id) : this._nextId++,
          text: String(e.text || ''),
          colorRaw: String(e.colorRaw || '#FFFFFF'),
          ts: e.ts ? Number(e.ts) : (e.timestamp ? Number(e.timestamp) : Date.now())
        }));
        const maxId = this._consoleCache.reduce((m, x) => Math.max(m, x.id || 0), 0);
        this._nextId = Math.max(this._nextId, maxId + 1);
        if (this.logArea) this._restoreConsoleCache();
      } catch (e) {}
    }

    getConsoleLineCount () { return this._consoleCache.length; }
    isConsoleShown () { return !!this.consoleVisible; }
    setSelectable (args) { this.textSelectable = !!args.SELECTABLE; if (this.consoleOverlay) this.consoleOverlay.style.userSelect = this.textSelectable ? 'text' : 'none'; }

    // ---- timestamp format + IntersectionObserver logic ----
    setTimestampFormat (args) {
      const fmt = String(args.FORMAT || 'off');
      if (!['off','24h','12h','relative'].includes(fmt)) return;

      // if switching from relative to another state: disconnect observer + stop loop
      if (this._timestampFormat === 'relative' && fmt !== 'relative') {
        this._disconnectObserverAndLoop();
      }

      this._timestampFormat = fmt;

      // immediate refresh
      if (this.logArea) this._refreshTimestamps();

      // if switching to relative: set up observer and start visible-loop
      if (fmt === 'relative') {
        this._setupObserverForRelative();
        // ensure currently visible lines are immediately updated
        this._updateVisibleLinesNow();
      }
    }

    _formatTimestamp (ms) {
      if (!ms || this._timestampFormat === 'off') return '';
      const d = new Date(Number(ms));
      if (this._timestampFormat === 'relative') {
        const diff = Date.now() - d.getTime();
        if (diff < 0) return 'in future';
        const s = Math.floor(diff / 1000);
        if (s < 5) return 'just now';
        if (s < 60) return `${s}s ago`;
        const m = Math.floor(s / 60);
        if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h ago`;
        const days = Math.floor(h / 24);
        if (days === 1) return '1 day ago';
        return `${days} days ago`;
      }
      const h = d.getHours(), min = d.getMinutes(), s = d.getSeconds();
      if (this._timestampFormat === '12h') {
        const hh = ((h + 11) % 12) + 1;
        const ampm = h < 12 ? 'AM' : 'PM';
        return `${hh}:${String(min).padStart(2,'0')}:${String(s).padStart(2,'0')} ${ampm}`;
      }
      return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }

    _refreshTimestamps () {
      if (!this.logArea) return;
      for (const c of Array.from(this.logArea.children)) {
        const ts = Number(c.dataset.ts || 0);
        const formatted = (this._timestampFormat === 'off') ? '' : this._formatTimestamp(ts);
        const spans = c.querySelectorAll('span');
        if (spans[0]) spans[0].textContent = formatted ? `[${formatted}] ` : '';
      }
    }

    // setup intersection observer to update visible lines only
    _setupObserverForRelative () {
      // If already created, disconnect first
      this._disconnectObserverAndLoop();

      if (!this.logArea) return;

      const callback = (entries) => {
        for (const entry of entries) {
          const el = entry.target;
          if (entry.isIntersecting) {
            // add to visible set and update immediately
            this._visibleSet.add(el);
            this._updateTimestampForElement(el);
          } else {
            // remove from visible set
            this._visibleSet.delete(el);
          }
        }
      };

      try {
        // root should be the log area so visibility is relative to the console scrolling region
        const options = Object.assign({}, this._ioOptions, { root: this.logArea });
        this._io = new IntersectionObserver(callback, options);
        // observe all existing lines
        this._observeAllLines();
      } catch (e) {
        // fallback: if IntersectionObserver unsupported, fall back to refreshing visible lines on scroll
        this._io = null;
        if (this.logArea) {
          this.logArea.addEventListener('scroll', () => this._updateVisibleLinesNow(), { passive: true });
        }
      }

      // start visible update loop (200 ms)
      this._startVisibleUpdateLoop();
    }

    _observeAllLines () {
      if (!this.logArea) return;
      if (this._io) {
        for (const c of Array.from(this.logArea.children)) {
          try { this._io.observe(c); } catch (e) {}
        }
      } else {
        // if no IO, we still want to update visible lines on scroll (fallback)
        // initial immediate update
        this._updateVisibleLinesNow();
      }
    }

    _disconnectObserverAndLoop () {
      try {
        if (this._io) {
          try { this._io.disconnect(); } catch (e) {}
          this._io = null;
        }
      } catch (e) {}
      // stop visible update loop and clear visible set
      this._stopVisibleUpdateLoop();
      this._visibleSet.clear();
    }

    // update timestamp for a single element instantly (if it has a timestamp span)
    _updateTimestampForElement (el) {
      if (!el) return;
      try {
        const ts = Number(el.dataset.ts || 0);
        const formatted = (this._timestampFormat === 'off') ? '' : this._formatTimestamp(ts);
        const spans = el.querySelectorAll('span');
        if (spans[0]) spans[0].textContent = formatted ? `[${formatted}] ` : '';
      } catch (e) {}
    }

    // start/stop the periodic visible update loop
    _startVisibleUpdateLoop () {
      if (this._visibleUpdateInterval) return;
      this._visibleUpdateInterval = setInterval(() => {
        try {
          // iterate snapshot of visible set to avoid mutation issues during iteration
          const snapshot = Array.from(this._visibleSet);
          for (const el of snapshot) {
            if (el && el.isConnected) this._updateTimestampForElement(el);
            else this._visibleSet.delete(el);
          }
        } catch (e) { /* ignore errors */ }
      }, Math.max(10, Number(this._visibleIntervalMs) || 200));
    }

    _stopVisibleUpdateLoop () {
      if (this._visibleUpdateInterval) {
        clearInterval(this._visibleUpdateInterval);
        this._visibleUpdateInterval = null;
      }
    }

    // force an update of currently visible lines now (used as fallback or to trigger immediate refresh)
    _updateVisibleLinesNow () {
      if (!this.logArea) return;
      const areaRect = this.logArea.getBoundingClientRect();
      for (const c of Array.from(this.logArea.children)) {
        try {
          const r = c.getBoundingClientRect();
          const intersects = !(r.bottom < areaRect.top || r.top > areaRect.bottom);
          if (intersects) {
            // if using IO it's handled there; fallback we update and add to set so loop will continue to refresh
            if (this._io) {
              // if IO present, IO will handle adding to set on next tick; but update now regardless
              this._updateTimestampForElement(c);
            } else {
              this._visibleSet.add(c);
              this._updateTimestampForElement(c);
            }
          } else {
            if (!this._io) this._visibleSet.delete(c);
          }
        } catch (e) {}
      }
    }

    // ---- scroll control / autoscroll ----
    setAutoScroll (args) { this._autoScrollEnabled = !!args.ENABLED; }
    isAutoScroll () { return !!this._autoScrollEnabled; }

    setConsoleScrollTo (args) {
      const y = Number(args.Y || 0);
      if (this.logArea) {
        const max = Math.max(0, this.logArea.scrollHeight - this.logArea.clientHeight);
        const clamped = Math.min(max, Math.max(0, y));
        this.logArea.scrollTop = clamped;
        this._scrollCache = clamped;
      } else {
        this._scrollCache = Math.max(0, y);
      }
    }
    consoleMaxScroll () { return this.logArea ? Math.max(0, this.logArea.scrollHeight - this.logArea.clientHeight) : (this._scrollCache || 0); }
    consoleCurrentScroll () { return this.logArea ? this.logArea.scrollTop : (this._scrollCache || 0); }
    _applyCachedScroll () { if (!this.logArea) return; const max = Math.max(0, this.logArea.scrollHeight - this.logArea.clientHeight); const clamped = Math.min(max, Math.max(0, this._scrollCache || 0)); this.logArea.scrollTop = clamped; }

    _instantScrollToBottom () {
      if (!this.logArea) return;
      const hadObserver = !!this._observer;
      if (hadObserver) try { this._observer.disconnect(); } catch (e) {}
      const hadRecovery = !!this._recoveryInterval;
      if (hadRecovery) try { clearInterval(this._recoveryInterval); } catch (e) {}
      const prevBehavior = this.logArea.style.scrollBehavior || '';
      const prevOverflow = this.logArea.style.overflowY || '';
      this.logArea.style.scrollBehavior = 'auto';
      this.logArea.style.overflowY = 'hidden';
      void this.logArea.offsetHeight;
      try {
        this.logArea.scrollTop = this.logArea.scrollHeight;
        this._scrollCache = this.logArea.scrollTop;
      } catch (e) {}
      this.logArea.style.overflowY = prevOverflow;
      this.logArea.style.scrollBehavior = prevBehavior;
      if (hadObserver) try { this._observer.observe(this.stage); } catch (e) {}
      if (hadRecovery) this._startRecovery();
    }

    // ---- show/hide ----
    toggleConsole (args) {
      const act = String(args.ACTION || 'toggle').toLowerCase();
      if (act === 'show') this.showConsole();
      else if (act === 'hide') this.hideConsole();
      else this.consoleVisible ? this.hideConsole() : this.showConsole();
    }
    showConsole () {
      this.consoleVisible = true;
      this._ensureUI();
      if (this.consoleOverlay) this.consoleOverlay.style.display = 'flex';
      if (this.logArea) { this._restoreConsoleCache(); this._applyCachedScroll(); }
      this._resizeDynamicSizes();
      // if switched to relative earlier, ensure observer is active
      if (this._timestampFormat === 'relative') this._setupObserverForRelative();
    }
    hideConsole () { if (this.consoleOverlay) this.consoleOverlay.style.display = 'none'; this.consoleVisible = false; }

    // ---- input toggles + input API ----
    toggleInput (args) {
      const act = String(args.ACTION || 'toggle').toLowerCase();
      let priorAtBottom = false;
      try { priorAtBottom = this.logArea ? ((this.logArea.scrollTop + this.logArea.clientHeight) >= (this.logArea.scrollHeight - 5)) : true; } catch (e) { priorAtBottom = false; }
      if (act === 'show') this.showInput(priorAtBottom);
      else if (act === 'hide') this.hideInput(priorAtBottom);
      else { if (this.inputVisible) this.hideInput(priorAtBottom); else this.showInput(priorAtBottom); }
    }
    showInput (priorAtBottom = false) {
      this.inputVisible = true;
      this._ensureUI();
      if (!this.inputOverlay) this._createInput();
      if (this.inputOverlay) this.inputOverlay.style.display = 'block';
      this._resizeDynamicSizes();
      if (this.logArea && priorAtBottom) this._instantScrollToBottom();
    }
    hideInput (priorAtBottom = false) {
      try { priorAtBottom = (typeof priorAtBottom === 'boolean') ? priorAtBottom : (this.logArea ? ((this.logArea.scrollTop + this.logArea.clientHeight) >= (this.logArea.scrollHeight - 5)) : false); } catch (e) { priorAtBottom = false; }
      if (this.inputOverlay) this.inputOverlay.style.display = 'none';
      this.inputVisible = false;
      if (this.logArea && priorAtBottom) this._instantScrollToBottom();
    }

    setInputText (args) { const v = String(args.DATA || ''); this._inputCache = v; if (this.inputField) this.inputField.value = v; }
    runInput (args) { this._dispatchInput(String(args.TEXT || ''), false); }
    clearInput () { this._inputCache = ''; if (this.inputField) this.inputField.value = ''; }
    setLogInput (args) { this.logInputEnabled = !!args.ENABLED; }
    getLastInput () { return this.lastInput || ''; }
    getCurrentInput () { return (this.inputField ? this.inputField.value : this._inputCache) || ''; }
    isInputShown () { return !!this.inputVisible; }

    _dispatchInput (text, manual) {
      const txt = String(text || '');
      this.lastInput = txt;
      if (this.logInputEnabled && txt.trim()) this._log('> ' + txt.trim(), '#FFFFFF');
      this._inputEventId = (this._inputEventId || 0) + 1;
      try { if (typeof vm !== 'undefined' && vm && vm.runtime && typeof vm.runtime.startHats === 'function') vm.runtime.startHats(`${this.id}_whenInput`); } catch (e) {}
    }

    whenInput (args, util) {
      try {
        const tid = util?.target?.id ?? 'global';
        if (!this._lastSeenEventIdByTarget) this._lastSeenEventIdByTarget = new Map();
        const lastSeen = this._lastSeenEventIdByTarget.get(tid) || 0;
        if ((this._inputEventId || 0) > lastSeen) { this._lastSeenEventIdByTarget.set(tid, this._inputEventId); return true; }
        return false;
      } catch (e) { return false; }
    }

    // ---- styling blocks & helpers ----
    setColorPicker (args) {
      const part = String(args.PART || '').toLowerCase();
      const colorArg = String(args.COLOR || '').trim();
      const parsed = this._parseColorArg(colorArg);

      if (part.includes('console background')) {
        this.style.consoleBG = parsed.isGradient ? parsed.gradientCSS : parsed.color;
        if (this.consoleOverlay) this.consoleOverlay.style.background = this.style.consoleBG;
      } else if (part.includes('input background')) {
        this.style.inputBG = parsed.isGradient ? parsed.gradientCSS : parsed.color;
        if (this.inputField) this._applyInputBackground(this.style.inputBG);
        if (this.inputField) this._applyInputTextColor(this.style.inputTextRaw);
      } else if (part.includes('input text')) {
        this.style.inputTextRaw = colorArg || parsed.color;
        if (this.inputField) this._applyInputTextColor(this.style.inputTextRaw);
      } else if (part.includes('timestamp text')) {
        this.style.timestampTextRaw = colorArg || parsed.color;
        if (this.logArea) {
          for (const ch of Array.from(this.logArea.children)) {
            const tsSpan = ch.querySelectorAll('span')[0];
            if (tsSpan) this._applyInlineTextColor(tsSpan, this.style.timestampTextRaw);
          }
        }
      } else if (part.includes('input placeholder')) {
        this.style.inputPlaceholderColorRaw = colorArg || parsed.color;
        this._updatePlaceholderCSS(this.style.inputPlaceholderColorRaw || this._defaults.inputPlaceholderColorRaw);
      }

      this._resizeDynamicSizes();
    }

    setFont (args) {
      const part = String(args.PART || 'text').toLowerCase();
      const f = String(args.FONT || '').trim();
      if (!f) return;
      if (part === 'text') this.style.fontText = f;
      else if (part === 'timestamp') this.style.fontTimestamp = f;
      else if (part === 'input') this.style.fontInput = f;

      if (this.logArea) {
        for (const ch of Array.from(this.logArea.children)) {
          const spans = ch.querySelectorAll('span');
          if (spans.length === 0) continue;
          if (part === 'timestamp' && spans[0]) spans[0].style.fontFamily = this.style.fontTimestamp;
          if (part === 'text' && spans[spans.length - 1]) spans[spans.length - 1].style.fontFamily = this.style.fontText;
        }
      }
      if (this.inputField && part === 'input') this.inputField.style.fontFamily = this.style.fontInput;
    }

    setTextSizeMultiplier (args) {
      const part = String(args.PART || 'text').toLowerCase();
      let m = Number(args.MULTIPLIER);
      if (!isFinite(m) || m <= 0) m = 1;
      if (part === 'text') this.style.sizeText = Math.max(0.1, m);
      else if (part === 'timestamp') this.style.sizeTimestamp = Math.max(0.1, m);
      else if (part === 'input') this.style.sizeInput = Math.max(0.1, m);

      this._resizeDynamicSizes();
    }

    setAlignment (args) {
      const part = String(args.PART || 'text').toLowerCase();
      const a = String(args.ALIGN || 'left').toLowerCase();
      const valid = ['left', 'center', 'right'];
      const alignment = valid.includes(a) ? a : 'left';
      if (part === 'text') this.style.textAlign = alignment;
      else if (part === 'input') this.style.inputAlign = alignment;

      if (this.logArea && part === 'text') {
        for (const ch of Array.from(this.logArea.children)) ch.style.textAlign = this.style.textAlign;
      }
      if (this.inputField && part === 'input') this.inputField.style.textAlign = this.style.inputAlign;
    }

    setLineSpacing (args) {
      this.style.lineSpacing = Number(args.SPACING || this.style.lineSpacing) || this.style.lineSpacing;
      if (this.logArea) for (const ch of Array.from(this.logArea.children)) ch.style.lineHeight = String(this.style.lineSpacing);
    }

    setInputPlaceholder (args) {
      const txt = String(args.TEXT || '');
      this.style.inputPlaceholder = txt;
      if (this.inputField) this.inputField.placeholder = this.style.inputPlaceholder;
    }

    resetStyling () {
      this.style = Object.assign({}, this._defaults);
      this.lineSpacing = this._defaults.lineSpacing;

      if (this.consoleOverlay) this.consoleOverlay.style.background = this.style.consoleBG;
      if (this.inputField) {
        this._applyInputBackground(this.style.inputBG);
        this.inputField.placeholder = this.style.inputPlaceholder;
        this.inputField.style.fontFamily = this.style.fontInput;
        this.inputField.style.textAlign = this.style.inputAlign;
        this._applyInputTextColor(this.style.inputTextRaw);
        this._updatePlaceholderCSS(this.style.inputPlaceholderColorRaw || this._defaults.inputPlaceholderColorRaw);
        void this.inputField.offsetHeight;
      }

      if (this.logArea) this._restoreConsoleCache();
    }
  } // end class

  // register extension
  try {
    const instance = new ConsoleExtension();
    if (Scratch && Scratch.extensions && typeof Scratch.extensions.register === 'function') {
      Scratch.extensions.register(instance);
    } else {
      window.__consoleExtensionInstance = instance;
      console.warn('[Console extension] instance available at window.__consoleExtensionInstance (registration API not found).');
    }
  } catch (e) {
    console.error('[Console extension] registration failed:', e);
  }

})(typeof Scratch !== 'undefined' ? Scratch : {});