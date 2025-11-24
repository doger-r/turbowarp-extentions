(function (Scratch) {
  'use strict';

  /**
   * Console Extension v3
   * * Features:
   * - Advanced Logging (Text, Gradients, Images)
   * - Individual Line Styling (Font, Size, Align overrides)
   * - Interactive Input with Minecraft-style Autofill
   * - IntersectionObserver based rendering
   * - Timestamps (Relative/Absolute)
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
      this.suggestionBox = null;
      this.stage = null;

      // data
      // entries: { id, type, text?, src?, width?, height?, colorRaw, ts, customFont?, customSize?, customAlign? }
      this._consoleCache = []; 
      this._nextId = 1;
      this._inputCache = '';
      this.lastInput = '';
      
      // Autofill data
      this._commandRegistry = new Set();
      this._activeSuggestions = [];
      this._suggestionIndex = -1;

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
      this._timestampFormat = 'off';

      // IntersectionObserver
      this._io = null; 
      this._ioOptions = { root: null, rootMargin: '0px', threshold: [0, 0.01] };
      this._visibleSet = new Set();
      this._visibleUpdateInterval = null;
      this._visibleIntervalMs = 200;

      // helpers
      this._observer = null;
      this._recoveryInterval = null;
      this._placeholderStyleEl = null;
      this._supportsBackgroundClipText = this._detectBackgroundClipTextSupport();

      // bind exported methods
      const methods = [
        'getInfo','toggleConsole','showConsole','hideConsole','clearConsole','logMessage','logDots','logImage','removeLine',
        'styleLine', // New method
        'getConsoleAsArray','setConsoleFromArray','getConsoleLineCount','isConsoleShown','setSelectable',
        'setTimestampFormat','toggleInput','showInput','hideInput','setInputText','runInput','clearInput','setLogInput',
        'whenInput','getLastInput','getCurrentInput','isInputShown',
        'addCommand', 'removeCommand', 'clearCommands',
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
          
          { opcode: 'logImage', blockType: BlockType.COMMAND, text: 'log image [SRC] size [W] x [H]', arguments: { SRC: { type: ArgumentType.STRING, defaultValue: 'https://scv.scratch.mit.edu/da8ed626bf4c64df753823e590740662.svg' }, W: { type: ArgumentType.NUMBER, defaultValue: 50 }, H: { type: ArgumentType.NUMBER, defaultValue: 50 } } },
          
          { opcode: 'logDots', blockType: BlockType.COMMAND, text: 'log dots' },
          { opcode: 'removeLine', blockType: BlockType.COMMAND, text: 'remove console line [INDEX]', arguments: { INDEX: { type: ArgumentType.NUMBER, defaultValue: 1 } } },

          // New Styling Block
          { opcode: 'styleLine', blockType: BlockType.COMMAND, text: 'style line [INDEX] font [FONT] size [SIZE] align [ALIGN]', arguments: { INDEX: { type: ArgumentType.NUMBER, defaultValue: 1 }, FONT: { type: ArgumentType.STRING, defaultValue: 'Sans Serif' }, SIZE: { type: ArgumentType.NUMBER, defaultValue: 1 }, ALIGN: { type: ArgumentType.STRING, menu: 'alignmentMenu', defaultValue: 'left' } } },

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

          { blockType: BlockType.LABEL, text: 'Input & Autofill' },
          { opcode: 'toggleInput', blockType: BlockType.COMMAND, text: '[ACTION] input', arguments: { ACTION: { type: ArgumentType.STRING, menu: 'toggleMenu', defaultValue: 'show' } } },
          { opcode: 'setInputText', blockType: BlockType.COMMAND, text: 'set input to [DATA]', arguments: { DATA: { type: ArgumentType.STRING, defaultValue: '' } } },
          
          { opcode: 'addCommand', blockType: BlockType.COMMAND, text: 'add command [TEXT] to autofill', arguments: { TEXT: { type: ArgumentType.STRING, defaultValue: '/help' } } },
          { opcode: 'removeCommand', blockType: BlockType.COMMAND, text: 'remove command [TEXT] from autofill', arguments: { TEXT: { type: ArgumentType.STRING, defaultValue: '/help' } } },
          { opcode: 'clearCommands', blockType: BlockType.COMMAND, text: 'clear all autofill commands' },

          { opcode: 'runInput', blockType: BlockType.COMMAND, text: 'run [TEXT]', arguments: { TEXT: { type: ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'clearInput', blockType: BlockType.COMMAND, text: 'clear input' },
          { opcode: 'setLogInput', blockType: BlockType.COMMAND, text: 'set log input to [ENABLED]', arguments: { ENABLED: { type: ArgumentType.BOOLEAN, defaultValue: true } } },
          { opcode: 'whenInput', blockType: BlockType.HAT, text: 'when input entered' },
          { opcode: 'getLastInput', blockType: BlockType.REPORTER, text: 'last input' },
          { opcode: 'getCurrentInput', blockType: BlockType.REPORTER, text: 'current input' },
          { opcode: 'isInputShown', blockType: BlockType.BOOLEAN, text: 'input shown?' },

          { blockType: BlockType.LABEL, text: 'Global Styling' },
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
        .console-img { vertical-align: middle; max-width: 100%; border-radius: 4px; }
        /* Suggestion Box Styles */
        .console-suggestions {
          position: absolute;
          bottom: 100%; left: 0; right: 0;
          max-height: 150px;
          overflow-y: auto;
          display: none;
          flex-direction: column-reverse;
          z-index: 100;
          box-shadow: 0px -2px 10px rgba(0,0,0,0.3);
          border-top-left-radius: 4px;
          border-top-right-radius: 4px;
        }
        .console-suggestion-item {
          padding: 8px 10px;
          cursor: pointer;
          font-family: inherit;
          opacity: 0.8;
          transition: background 0.1s;
        }
        .console-suggestion-item.selected {
          opacity: 1.0;
          background: rgba(255,255,255,0.15);
          font-weight: bold;
        }
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
        this.suggestionBox = null;
        this._createInput();
        if (this.inputField && this._inputCache) this.inputField.value = this._inputCache;
      }
      if (Date.now() - (this._lastUserScroll || 0) > this._userScrollGrace) this._applyCachedScroll();
    }

    // ---- DYNAMIC SIZING LOGIC UPDATED FOR PER-LINE STYLING ----
    _resizeDynamicSizes () {
      const stageH = (typeof vm !== 'undefined' && vm && vm.runtime && vm.runtime.renderer && vm.runtime.renderer.canvas)
        ? vm.runtime.renderer.canvas.clientHeight
        : 360;
      const scale = stageH / 360;
      const base = 14;

      // Base Globals
      this._computedTsPx = Math.max(10, base * scale * (this.style.sizeTimestamp || 1));
      this._computedInputPx = Math.max(10, base * scale * (this.style.sizeInput || 1));

      // Resize all lines in logArea
      if (this.logArea) {
        for (const line of Array.from(this.logArea.children)) {
          // Check for line-specific multiplier override
          const lineMult = line.dataset.sizeMult ? Number(line.dataset.sizeMult) : (this.style.sizeText || 1);
          const linePx = Math.max(10, base * scale * lineMult);

          const spans = line.querySelectorAll('span');
          // spans[0] is timestamp, spans[1] is text content
          if (spans[0]) spans[0].style.fontSize = `${this._computedTsPx}px`;
          // If type=text, spans[1] exists. If type=image, it might be an img tag (no font size needed).
          if (spans[1]) spans[1].style.fontSize = `${linePx}px`;
        }
      }

      if (this.inputField) {
        this.inputField.style.fontSize = `${this._computedInputPx}px`;
        this.inputField.style.fontFamily = this.style.fontInput;
        this.inputField.style.textAlign = this.style.inputAlign;
      }
      if (this.suggestionBox) {
        this.suggestionBox.style.fontSize = `${this._computedInputPx}px`;
        this.suggestionBox.style.fontFamily = this.style.fontInput;
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
      if (this._timestampFormat === 'relative') this._setupObserverForRelative();
      this._resizeDynamicSizes();
    }

    _createInput () {
      if (!this.stage) return;
      if (this.inputOverlay && this.stage.contains(this.inputOverlay)) return;

      const overlay = document.createElement('div');
      Object.assign(overlay.style, { position: 'absolute', left: '0', right: '0', bottom: '0', zIndex: '60', boxSizing: 'border-box' });

      // -- Suggestion Box (Autofill) --
      const suggestionBox = document.createElement('div');
      suggestionBox.className = 'console-suggestions';
      suggestionBox.style.background = this.style.inputBG; 
      suggestionBox.style.color = this._firstColorFromRaw(this.style.inputTextRaw);
      overlay.appendChild(suggestionBox);
      this.suggestionBox = suggestionBox;

      const input = document.createElement('input');
      input.className = 'console-input';
      Object.assign(input.style, {
        width: '100%', border: 'none', outline: 'none', padding: '10px',
        background: this.style.inputBG, color: this._firstColorFromRaw(this.style.inputTextRaw), fontFamily: this.style.fontInput, boxSizing: 'border-box'
      });

      input.placeholder = this.style.inputPlaceholder != null ? this.style.inputPlaceholder : this._defaults.inputPlaceholder;
      this._updatePlaceholderCSS(this.style.inputPlaceholderColorRaw || this._defaults.inputPlaceholderColorRaw);

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          if (this._activeSuggestions.length > 0) {
            const idx = this._suggestionIndex >= 0 ? this._suggestionIndex : 0;
            const chosen = this._activeSuggestions[idx];
            input.value = chosen;
            this._inputCache = chosen;
            this._hideSuggestions();
          }
          return;
        }
        if (e.key === 'ArrowUp') {
            if (this.suggestionBox.style.display === 'flex') {
                e.preventDefault();
                this._navigateSuggestions(1);
            }
            return;
        }
        if (e.key === 'ArrowDown') {
            if (this.suggestionBox.style.display === 'flex') {
                e.preventDefault();
                this._navigateSuggestions(-1);
            }
            return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (this.suggestionBox.style.display === 'flex' && this._suggestionIndex !== -1) {
             const chosen = this._activeSuggestions[this._suggestionIndex];
             input.value = chosen;
             this._inputCache = chosen;
             this._hideSuggestions();
          } else {
             const txt = input.value;
             input.value = '';
             this._inputCache = '';
             this._hideSuggestions();
             this._dispatchInput(txt, true);
          }
        }
      });

      input.addEventListener('input', () => { 
          this._inputCache = input.value; 
          this._updateSuggestions(input.value);
      });
      input.addEventListener('blur', () => { 
        this._inputCache = input.value; 
        setTimeout(() => this._hideSuggestions(), 200);
      });
      input.addEventListener('focus', () => { this._updateSuggestions(input.value); });

      overlay.appendChild(input);
      try { this.stage.appendChild(overlay); } catch (e) { document.body.appendChild(overlay); }

      this.inputOverlay = overlay;
      this.inputField = input;
      this._applyInputBackground(this.style.inputBG);
      this._applyInputTextColor(this.style.inputTextRaw);
      this._resizeDynamicSizes();
    }

    // ---- Autofill Logic ----
    addCommand(args) { this._commandRegistry.add(String(args.TEXT)); }
    removeCommand(args) { this._commandRegistry.delete(String(args.TEXT)); }
    clearCommands() { this._commandRegistry.clear(); }

    _updateSuggestions(text) {
        if (!this.suggestionBox || this._commandRegistry.size === 0 || !text.trim()) {
            this._hideSuggestions();
            return;
        }
        const lower = text.toLowerCase();
        this._activeSuggestions = Array.from(this._commandRegistry)
            .filter(cmd => cmd.toLowerCase().includes(lower))
            .sort();

        if (this._activeSuggestions.length === 0) {
            this._hideSuggestions();
            return;
        }
        this.suggestionBox.innerHTML = '';
        this.suggestionBox.style.display = 'flex';
        this._suggestionIndex = -1;

        this._activeSuggestions.forEach((cmd, i) => {
            const div = document.createElement('div');
            div.className = 'console-suggestion-item';
            div.textContent = cmd;
            div.onmousedown = (e) => {
                e.preventDefault();
                if (this.inputField) {
                    this.inputField.value = cmd;
                    this._inputCache = cmd;
                    this.inputField.focus();
                    this._hideSuggestions();
                }
            };
            this.suggestionBox.appendChild(div);
        });
        this._applyInputBackground(this.style.inputBG);
    }

    _navigateSuggestions(dir) {
        if (!this._activeSuggestions.length) return;
        const count = this._activeSuggestions.length;
        if (this._suggestionIndex === -1 && dir === 1) this._suggestionIndex = count - 1;
        else if (this._suggestionIndex === -1 && dir === -1) this._suggestionIndex = 0;
        else {
             this._suggestionIndex -= dir;
             if (this._suggestionIndex < 0) this._suggestionIndex = count - 1;
             if (this._suggestionIndex >= count) this._suggestionIndex = 0;
        }
        const items = this.suggestionBox.children;
        for (let i = 0; i < items.length; i++) items[i].classList.remove('selected');
        if (items[this._suggestionIndex]) {
            items[this._suggestionIndex].classList.add('selected');
            items[this._suggestionIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    _hideSuggestions() {
        if (this.suggestionBox) {
            this.suggestionBox.style.display = 'none';
            this.suggestionBox.innerHTML = '';
        }
        this._activeSuggestions = [];
        this._suggestionIndex = -1;
    }

    // ---- Color Parsers ----
    gradientReporter (args) {
      const c1 = String(args.COLOR1 || '').trim();
      const c2 = String(args.COLOR2 || '').trim();
      const angle = Number(args.ANGLE || 180) || 180;
      return `${c1},${c2},${angle}`;
    }
    gradient3Reporter (args) { return `${String(args.COLOR1)},${String(args.COLOR2)},${String(args.COLOR3)},${args.ANGLE||180}`; }
    gradient4Reporter (args) { return `${String(args.COLOR1)},${String(args.COLOR2)},${String(args.COLOR3)},${String(args.COLOR4)},${args.ANGLE||180}`; }

    _parseColorArg (colorArg) {
      const raw = String(colorArg || '').trim();
      if (!raw) return { isGradient: false, color: '#FFFFFF', gradientCSS: '' };
      if (/^linear-gradient\(/i.test(raw)) {
        const firstMatch = raw.match(/rgba?\([^\)]+\)|#[0-9A-Fa-f]+|[a-zA-Z\-]+/);
        return { isGradient: true, color: firstMatch ? firstMatch[0] : '#FFFFFF', gradientCSS: raw, colors: [], angle: 180 };
      }
      const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length <= 1) return { isGradient: false, color: parts[0] || '#FFFFFF', gradientCSS: '' };
      let angle = 180;
      let colors = parts.slice(0);
      const last = parts[parts.length - 1];
      if (/^-?\d+(\.\d+)?$/.test(last)) { angle = Number(last); colors = parts.slice(0, -1); }
      const gradientCSS = `linear-gradient(${angle}deg, ${colors.join(', ')})`;
      return { isGradient: true, color: colors[0] || '#FFFFFF', gradientCSS, colors, angle };
    }

    _firstColorFromRaw (raw) { try { return this._parseColorArg(raw).color || '#FFFFFF'; } catch (e) { return '#FFFFFF'; } }

    _applyInputBackground (bgRaw) {
      if (!this.inputField) return;
      const parsed = this._parseColorArg(bgRaw);
      const bgCSS = parsed.isGradient ? parsed.gradientCSS : (parsed.color || this._defaults.inputBG);
      this.inputField.style.background = bgCSS;
      if (this.suggestionBox) this.suggestionBox.style.background = bgCSS;
    }

    _applyInputTextColor (rawColor) {
      if (!this.inputField) return;
      const parsedText = this._parseColorArg(rawColor);
      const parsedBg = this._parseColorArg(this.style.inputBG);
      const bgLayer = parsedBg.isGradient ? parsedBg.gradientCSS : (parsedBg.color || this._defaults.inputBG);
      
      const textColor = parsedText.color || '#FFFFFF';

      if (parsedText.isGradient && parsedText.gradientCSS && this._supportsBackgroundClipText) {
        this.inputField.style.background = `${parsedText.gradientCSS}, ${bgLayer}`;
        this.inputField.style.backgroundRepeat = 'no-repeat, no-repeat';
        this.inputField.style.backgroundSize = '100% 100%, 100% 100%';
        try { this.inputField.style.webkitBackgroundClip = 'text, padding-box'; this.inputField.style.backgroundClip = 'text, padding-box'; } 
        catch (e) { this.inputField.style.webkitBackgroundClip = 'text'; this.inputField.style.backgroundClip = 'text'; }
        this.inputField.style.webkitTextFillColor = 'transparent';
        this.inputField.style.color = 'transparent';
      } else {
        this.inputField.style.background = bgLayer;
        this.inputField.style.backgroundRepeat = ''; this.inputField.style.backgroundSize = '';
        this.inputField.style.webkitBackgroundClip = ''; this.inputField.style.backgroundClip = '';
        this.inputField.style.webkitTextFillColor = ''; this.inputField.style.color = textColor;
      }
      if (this.suggestionBox) this.suggestionBox.style.color = textColor;
      this._updatePlaceholderCSS(this.style.inputPlaceholderColorRaw || this._defaults.inputPlaceholderColorRaw);
    }

    _updatePlaceholderCSS (colorRaw) {
      try {
        const parsed = this._parseColorArg(colorRaw || this._defaults.inputPlaceholderColorRaw);
        const placeholderSolid = parsed.color || this._defaults.inputPlaceholderColorRaw;
        const id = 'console-ext-placeholder-style';
        let el = this._placeholderStyleEl || document.getElementById(id);
        if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
        if (parsed.isGradient && parsed.gradientCSS && this._supportsBackgroundClipText) {
          el.textContent =
            `.console-input::placeholder { color: ${placeholderSolid} !important; opacity: 1 !important; }` +
            `.console-input::placeholder { background-image: ${parsed.gradientCSS}; -webkit-background-clip: text; background-clip: text; color: transparent !important; }`;
        } else {
          el.textContent = `.console-input::placeholder { color: ${placeholderSolid} !important; opacity: 1 !important; }`;
        }
        this._placeholderStyleEl = el;
      } catch (e) {}
    }

    // ---- DOM Element Creation & Styling ----

    _createLineElement (entry) {
      const container = document.createElement('div');
      container.className = 'console-line';
      container.style.lineHeight = String(this.style.lineSpacing || this._defaults.lineSpacing);
      
      // Initial dataset population
      container.dataset.id = String(entry.id);
      container.dataset.ts = String(entry.ts || Date.now());

      const tsSpan = document.createElement('span');
      const fmt = (this._timestampFormat === 'off') ? '' : this._formatTimestamp(entry.ts);
      tsSpan.textContent = fmt ? `[${fmt}] ` : '';
      tsSpan.style.fontFamily = this.style.fontTimestamp; // Initial global, updated in _applyLineStyle if specific
      tsSpan.style.display = 'inline';
      this._applyInlineTextColor(tsSpan, this.style.timestampTextRaw);
      container.appendChild(tsSpan);

      if (entry.type === 'image') {
        const img = document.createElement('img');
        img.className = 'console-img';
        img.src = entry.src;
        const w = entry.width;
        const h = entry.height;
        img.style.width = typeof w === 'number' ? `${w}px` : w;
        img.style.height = typeof h === 'number' ? `${h}px` : h;
        container.appendChild(img);
      } else {
        const msgSpan = document.createElement('span');
        msgSpan.textContent = entry.text;
        msgSpan.style.fontFamily = this.style.fontText; // Initial global
        msgSpan.style.display = 'inline';
        this._applyInlineTextColor(msgSpan, entry.colorRaw || '#FFFFFF');
        container.appendChild(msgSpan);
      }

      // Apply line-specific overrides if they exist in cache
      this._applyLineStyle(container, entry);

      return container;
    }

    // New Helper: Applies specific overrides to a DOM element
    _applyLineStyle (el, entry) {
        if (!el) return;
        
        // 1. Alignment
        // Use custom alignment if present, otherwise global
        el.style.textAlign = entry.customAlign ? entry.customAlign : this.style.textAlign;

        // 2. Font Family (Text Span)
        const msgSpan = el.querySelectorAll('span')[1]; // [0] is ts, [1] is msg
        if (msgSpan && entry.type === 'text') {
            msgSpan.style.fontFamily = entry.customFont ? entry.customFont : this.style.fontText;
        }

        // 3. Size Multiplier
        // We store the specific multiplier in dataset. 
        // _resizeDynamicSizes will read this on next pass (called immediately after this).
        if (entry.customSize) {
            el.dataset.sizeMult = String(entry.customSize);
        } else {
            delete el.dataset.sizeMult;
        }
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

      if (this._timestampFormat === 'relative' && this._io) {
        try { this._io.observe(el); } catch (e) {}
      }

      this._resizeDynamicSizes(); // This will apply the correct pixel size based on dataset.sizeMult
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
      const entry = { id: this._nextId++, type: 'text', text: String(text), colorRaw: String(colorRaw), ts: Date.now() };
      this._consoleCache.push(entry);
      if (this._dotsInterval) this._stopDots();
      this._addLineToDOM(entry);
    }
    logMessage (args) { this._log(args.TEXT, args.COLOR); }
    
    logImage (args) {
        const entry = { id: this._nextId++, type: 'image', src: String(args.SRC), width: args.W, height: args.H, ts: Date.now() };
        this._consoleCache.push(entry);
        if (this._dotsInterval) this._stopDots();
        this._addLineToDOM(entry);
    }

    // -- New Style Line Method --
    styleLine (args) {
        const visibleIndex = Math.floor(Number(args.INDEX) || 1);
        const idx = visibleIndex - 1;

        // Validation
        if (idx < 0 || idx >= this._consoleCache.length) return;

        const entry = this._consoleCache[idx];
        
        // Update Cache
        entry.customFont = String(args.FONT || '');
        entry.customSize = Number(args.SIZE) || 1;
        entry.customAlign = String(args.ALIGN || '').toLowerCase();
        
        // Update DOM if exists
        if (this.logArea) {
            const el = this.logArea.querySelector(`[data-id="${entry.id}"]`);
            if (el) {
                this._applyLineStyle(el, entry);
                // Trigger resize to calculate new pixel sizes based on the new multiplier
                this._resizeDynamicSizes();
            }
        }
    }

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
        const entry = this._consoleCache[idx];
        const el = this.logArea.querySelector(`[data-id="${entry.id}"]`);
        if (el) {
          if (this._io) try { this._io.unobserve(el); } catch (e) {}
          this._visibleSet.delete(el);
          el.remove();
        }
        this._consoleCache.splice(idx, 1);
        if (this.logArea.scrollHeight) this.logArea.scrollTop = prevScroll; // simplistic maintain
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
          type: e.type || 'text',
          text: String(e.text || ''),
          src: e.src, width: e.width, height: e.height,
          colorRaw: String(e.colorRaw || '#FFFFFF'),
          ts: e.ts ? Number(e.ts) : Date.now(),
          customFont: e.customFont,
          customSize: e.customSize,
          customAlign: e.customAlign
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
      if (this._timestampFormat === 'relative' && fmt !== 'relative') this._disconnectObserverAndLoop();
      this._timestampFormat = fmt;
      if (this.logArea) this._refreshTimestamps();
      if (fmt === 'relative') { this._setupObserverForRelative(); this._updateVisibleLinesNow(); }
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

    _setupObserverForRelative () {
      this._disconnectObserverAndLoop();
      if (!this.logArea) return;
      const callback = (entries) => {
        for (const entry of entries) {
          const el = entry.target;
          if (entry.isIntersecting) { this._visibleSet.add(el); this._updateTimestampForElement(el); } 
          else { this._visibleSet.delete(el); }
        }
      };
      try {
        const options = Object.assign({}, this._ioOptions, { root: this.logArea });
        this._io = new IntersectionObserver(callback, options);
        this._observeAllLines();
      } catch (e) {
        this._io = null;
        if (this.logArea) this.logArea.addEventListener('scroll', () => this._updateVisibleLinesNow(), { passive: true });
      }
      this._startVisibleUpdateLoop();
    }

    _observeAllLines () { if (!this.logArea) return; if (this._io) for (const c of Array.from(this.logArea.children)) { try { this._io.observe(c); } catch (e) {} } else this._updateVisibleLinesNow(); }
    _disconnectObserverAndLoop () { try { if (this._io) { this._io.disconnect(); this._io = null; } } catch (e) {} this._stopVisibleUpdateLoop(); this._visibleSet.clear(); }
    _updateTimestampForElement (el) {
      if (!el) return;
      try {
        const ts = Number(el.dataset.ts || 0);
        const formatted = (this._timestampFormat === 'off') ? '' : this._formatTimestamp(ts);
        const spans = el.querySelectorAll('span');
        if (spans[0]) spans[0].textContent = formatted ? `[${formatted}] ` : '';
      } catch (e) {}
    }
    _startVisibleUpdateLoop () { if (this._visibleUpdateInterval) return; this._visibleUpdateInterval = setInterval(() => { try { const snapshot = Array.from(this._visibleSet); for (const el of snapshot) { if (el && el.isConnected) this._updateTimestampForElement(el); else this._visibleSet.delete(el); } } catch (e) {} }, Math.max(10, Number(this._visibleIntervalMs) || 200)); }
    _stopVisibleUpdateLoop () { if (this._visibleUpdateInterval) { clearInterval(this._visibleUpdateInterval); this._visibleUpdateInterval = null; } }
    _updateVisibleLinesNow () {
      if (!this.logArea) return;
      const areaRect = this.logArea.getBoundingClientRect();
      for (const c of Array.from(this.logArea.children)) {
        try {
          const r = c.getBoundingClientRect();
          const intersects = !(r.bottom < areaRect.top || r.top > areaRect.bottom);
          if (intersects) { if (this._io) { this._updateTimestampForElement(c); } else { this._visibleSet.add(c); this._updateTimestampForElement(c); } } 
          else { if (!this._io) this._visibleSet.delete(c); }
        } catch (e) {}
      }
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
          // Only update text span if no custom override exists for this line
          const entry = this._consoleCache.find(e => String(e.id) === ch.dataset.id);
          if (part === 'text' && spans[1] && (!entry || !entry.customFont)) spans[1].style.fontFamily = this.style.fontText;
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
        for (const ch of Array.from(this.logArea.children)) {
            const entry = this._consoleCache.find(e => String(e.id) === ch.dataset.id);
            if (!entry || !entry.customAlign) ch.style.textAlign = this.style.textAlign;
        }
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
      if (this.suggestionBox) {
          this.suggestionBox.style.background = this.style.inputBG;
          this.suggestionBox.style.color = this._firstColorFromRaw(this.style.inputTextRaw);
      }
      if (this.logArea) this._restoreConsoleCache();
    }
    
    // ---- scroll ----
    setAutoScroll (args) { this._autoScrollEnabled = !!args.ENABLED; }
    isAutoScroll () { return !!this._autoScrollEnabled; }
    setConsoleScrollTo (args) {
      const y = Number(args.Y || 0);
      if (this.logArea) {
        const max = Math.max(0, this.logArea.scrollHeight - this.logArea.clientHeight);
        this.logArea.scrollTop = Math.min(max, Math.max(0, y));
        this._scrollCache = this.logArea.scrollTop;
      } else { this._scrollCache = Math.max(0, y); }
    }
    consoleMaxScroll () { return this.logArea ? Math.max(0, this.logArea.scrollHeight - this.logArea.clientHeight) : (this._scrollCache || 0); }
    consoleCurrentScroll () { return this.logArea ? this.logArea.scrollTop : (this._scrollCache || 0); }
    _applyCachedScroll () { if (!this.logArea) return; const max = Math.max(0, this.logArea.scrollHeight - this.logArea.clientHeight); this.logArea.scrollTop = Math.min(max, Math.max(0, this._scrollCache || 0)); }
    _instantScrollToBottom () {
      if (!this.logArea) return;
      const hadObserver = !!this._observer; if (hadObserver) try { this._observer.disconnect(); } catch (e) {}
      const hadRecovery = !!this._recoveryInterval; if (hadRecovery) try { clearInterval(this._recoveryInterval); } catch (e) {}
      const prevBehavior = this.logArea.style.scrollBehavior || '';
      const prevOverflow = this.logArea.style.overflowY || '';
      this.logArea.style.scrollBehavior = 'auto'; this.logArea.style.overflowY = 'hidden'; void this.logArea.offsetHeight;
      try { this.logArea.scrollTop = this.logArea.scrollHeight; this._scrollCache = this.logArea.scrollTop; } catch (e) {}
      this.logArea.style.overflowY = prevOverflow; this.logArea.style.scrollBehavior = prevBehavior;
      if (hadObserver) try { this._observer.observe(this.stage); } catch (e) {}
      if (hadRecovery) this._startRecovery();
    }
    // ---- toggles ----
    toggleConsole (args) { const act = String(args.ACTION || 'toggle').toLowerCase(); if (act === 'show') this.showConsole(); else if (act === 'hide') this.hideConsole(); else this.consoleVisible ? this.hideConsole() : this.showConsole(); }
    showConsole () { this.consoleVisible = true; this._ensureUI(); if (this.consoleOverlay) this.consoleOverlay.style.display = 'flex'; if (this.logArea) { this._restoreConsoleCache(); this._applyCachedScroll(); } this._resizeDynamicSizes(); if (this._timestampFormat === 'relative') this._setupObserverForRelative(); }
    hideConsole () { if (this.consoleOverlay) this.consoleOverlay.style.display = 'none'; this.consoleVisible = false; }
    toggleInput (args) { const act = String(args.ACTION || 'toggle').toLowerCase(); let priorAtBottom = false; try { priorAtBottom = this.logArea ? ((this.logArea.scrollTop + this.logArea.clientHeight) >= (this.logArea.scrollHeight - 5)) : true; } catch (e) { priorAtBottom = false; } if (act === 'show') this.showInput(priorAtBottom); else if (act === 'hide') this.hideInput(priorAtBottom); else { if (this.inputVisible) this.hideInput(priorAtBottom); else this.showInput(priorAtBottom); } }
    showInput (priorAtBottom = false) { this.inputVisible = true; this._ensureUI(); if (!this.inputOverlay) this._createInput(); if (this.inputOverlay) this.inputOverlay.style.display = 'block'; this._resizeDynamicSizes(); if (this.logArea && priorAtBottom) this._instantScrollToBottom(); }
    hideInput (priorAtBottom = false) { try { priorAtBottom = (typeof priorAtBottom === 'boolean') ? priorAtBottom : (this.logArea ? ((this.logArea.scrollTop + this.logArea.clientHeight) >= (this.logArea.scrollHeight - 5)) : false); } catch (e) { priorAtBottom = false; } if (this.inputOverlay) this.inputOverlay.style.display = 'none'; this.inputVisible = false; this._hideSuggestions(); if (this.logArea && priorAtBottom) this._instantScrollToBottom(); }
    setInputText (args) { const v = String(args.DATA || ''); this._inputCache = v; if (this.inputField) this.inputField.value = v; }
    runInput (args) { this._dispatchInput(String(args.TEXT || ''), false); }
    clearInput () { this._inputCache = ''; if (this.inputField) this.inputField.value = ''; }
    setLogInput (args) { this.logInputEnabled = !!args.ENABLED; }
    getLastInput () { return this.lastInput || ''; }
    getCurrentInput () { return (this.inputField ? this.inputField.value : this._inputCache) || ''; }
    isInputShown () { return !!this.inputVisible; }
    _dispatchInput (text, manual) { const txt = String(text || ''); this.lastInput = txt; if (this.logInputEnabled && txt.trim()) this._log('> ' + txt.trim(), '#FFFFFF'); this._inputEventId = (this._inputEventId || 0) + 1; try { if (typeof vm !== 'undefined' && vm && vm.runtime && typeof vm.runtime.startHats === 'function') vm.runtime.startHats(`${this.id}_whenInput`); } catch (e) {} }
    whenInput (args, util) { try { const tid = util?.target?.id ?? 'global'; if (!this._lastSeenEventIdByTarget) this._lastSeenEventIdByTarget = new Map(); const lastSeen = this._lastSeenEventIdByTarget.get(tid) || 0; if ((this._inputEventId || 0) > lastSeen) { this._lastSeenEventIdByTarget.set(tid, this._inputEventId); return true; } return false; } catch (e) { return false; } }
  }

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
