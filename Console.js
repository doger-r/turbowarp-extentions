(function (Scratch) {
  'use strict';

  /**
   * Console Extension v6
   * * Features:
   * - Advanced Logging (Text, Gradients, Images)
   * - Individual Line Styling (Font, Size, Align overrides)
   * - Interactive Input with Minecraft-style Autofill
   * - IntersectionObserver based rendering
   * - Timestamps (Relative/Absolute)
   * - Smart Image Scaling (0 width/height logic)
   * - Image Roundness (border-radius)
   * - Auto-spacing for images (Hidden in JSON)
   * - Fixes: Line counting ignores spacing, Image autoscroll, Scrollbar hiding
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
      this.consoleStyle = {}; // not used much
      this.observer = null;

      // DATA & STATE
      this.currentLog = [];
      this.lastLog = '';
      this.lastInput = '';
      this.logInputEnabled = true;
      this._inputCache = '';
      this._inputHistory = [];
      this._inputHistoryIndex = -1;
      this._lastSeenEventIdByTarget = new Map();
      this._inputEventId = 0;

      // CONFIGURATION & DEFAULTS
      this._defaults = {
        inputPlaceholder: 'Enter command...', // MODIFIED: Removed new line instructions
        logImage: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Japanese_dango.jpg/600px-Japanese_dango.jpg', // MODIFIED: Changed to dango image URL
        inputBG: '#444444',
        inputTextRaw: '#FFFFFF',
        font: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        fontInput: '"Helvetica Neue", Helvetica, Arial, sans-serif'
      };

      this.style = Object.assign({}, this._defaults);

      // Dynamic Sizes (recalculated on resize)
      this._computedInputPx = 16;
      this._computedFontPx = 16;
      this._computedLineHeight = 1.25;

      // Init
      this._injectCSS();
      this._createOverlays();
      window.addEventListener('resize', () => this._resizeDynamicSizes());
    }

    getInfo () {
      return {
        id: this.id,
        name: this.name,
        blocks: [
          {
            opcode: 'show',
            blockType: BlockType.COMMAND,
            text: 'show console'
          },
          {
            opcode: 'hide',
            blockType: BlockType.COMMAND,
            text: 'hide console'
          },
          '---',
          {
            opcode: 'logText',
            blockType: BlockType.COMMAND,
            text: 'log [TEXT] [COLOR] [FONT_SIZE] [FONT] [ALIGN]'
          },
          {
            opcode: 'logImage',
            blockType: BlockType.COMMAND,
            text: 'log image [IMAGE_URL] [WIDTH] [HEIGHT] [ROUNDNESS]'
          },
          {
            opcode: 'logGradient',
            blockType: BlockType.COMMAND,
            text: 'log [TEXT] gradient [COLOR1] to [COLOR2] [FONT_SIZE] [FONT] [ALIGN]'
          },
          {
            opcode: 'clear',
            blockType: BlockType.COMMAND,
            text: 'clear console'
          },
          '---',
          {
            opcode: 'showInput',
            blockType: BlockType.COMMAND,
            text: 'show input'
          },
          {
            opcode: 'hideInput',
            blockType: BlockType.COMMAND,
            text: 'hide input'
          },
          {
            opcode: 'setTextPlaceholder',
            blockType: BlockType.COMMAND,
            text: 'set input placeholder to [TEXT]',
            arguments: {
              'TEXT': {
                type: ArgumentType.STRING,
                defaultValue: 'Enter command...' // MODIFIED: was 'Type command...'
              }
            }
          },
          {
            opcode: 'getInputText',
            blockType: BlockType.REPORTER,
            text: 'current input'
          },
          {
            opcode: 'getLastInput',
            blockType: ArgumentType.REPORTER,
            text: 'last entered command'
          },
          {
            opcode: 'whenInput',
            blockType: BlockType.HAT,
            text: 'when input received'
          },
          '---',
          {
            opcode: 'enableInputLogging',
            blockType: BlockType.COMMAND,
            text: 'set input logging [ENABLED]',
            arguments: {
              'ENABLED': {
                type: ArgumentType.BOOLEAN,
                defaultValue: true
              }
            }
          },
          {
            opcode: 'setConsoleStyle',
            blockType: BlockType.COMMAND,
            text: 'set console color [BG] text color [TEXT_COLOR] input color [INPUT_BG] input text color [INPUT_TEXT]'
          },
          {
            opcode: 'setFontDefaults',
            blockType: BlockType.COMMAND,
            text: 'set console font [FONT] size [FONT_SIZE] line height [LINE_HEIGHT]',
            arguments: {
              'FONT': { type: ArgumentType.STRING, defaultValue: this._defaults.font },
              'FONT_SIZE': { type: ArgumentType.NUMBER, defaultValue: 16 },
              'LINE_HEIGHT': { type: ArgumentType.NUMBER, defaultValue: 1.25 }
            }
          },
          {
            opcode: 'setTimestampMode',
            blockType: BlockType.COMMAND,
            text: 'set timestamp mode [MODE]',
            arguments: {
              'MODE': {
                type: ArgumentType.STRING,
                menu: 'timestampMode',
                defaultValue: 'none'
              }
            }
          }
        ],
        menus: {
          timestampMode: {
            acceptReporters: true,
            items: ['none', 'relative', 'absolute']
          },
          fontMenus: {
            acceptReporters: true,
            items: ['monospace', 'sans-serif', 'serif']
          }
        }
      };
    }

    // UTILITIES

    _injectCSS () {
      if (document.getElementById('console-css')) return;
      const style = document.createElement('style');
      style.id = 'console-css';
      style.innerHTML = `
        .consoleOverlay {
          position: absolute;
          top: 0;
          left: 0;
          bottom: 0;
          right: 0;
          background: #222222;
          overflow-y: scroll;
          opacity: 0;
          transition: opacity 0.2s;
          z-index: 1000;
          pointer-events: none;
          padding: 10px;
          display: flex;
          flex-direction: column;
          /* Hide scrollbar for Chrome, Safari and Opera */
          -ms-overflow-style: none;  /* IE and Edge */
          scrollbar-width: none;  /* Firefox */
        }
        .consoleOverlay::-webkit-scrollbar {
          display: none;
        }
        .consoleOverlay.visible {
          opacity: 1;
          pointer-events: auto;
        }
        .console-line {
          display: flex;
          flex-shrink: 0;
          min-height: 1.25em; /* default line height */
          font-family: ${this.style.font};
          font-size: ${this._computedFontPx}px;
          line-height: ${this._computedLineHeight};
          color: #FFFFFF;
          margin-bottom: 2px;
        }
        .console-line-text {
          word-wrap: break-word;
          white-space: pre-wrap;
          flex-grow: 1;
        }
        .console-line-text.image-line {
            display: inline-flex;
            align-items: center;
        }
        .console-line-text img {
          max-width: 100%;
          display: inline-block;
        }
        .console-timestamp {
          color: #AAAAAA;
          margin-right: 8px;
          font-family: monospace;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .inputOverlay {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          z-index: 1001;
          padding: 10px;
          pointer-events: none; /* Allows click through if console is hidden */
        }
        .inputOverlay.visible {
          pointer-events: auto;
        }
        .consoleInput {
          width: 100%;
          border: none;
          outline: none;
          padding: 10px;
          background: ${this.style.inputBG};
          color: ${this._firstColorFromRaw(this.style.inputTextRaw)};
          font-family: ${this.style.fontInput};
          box-sizing: border-box;
          font-size: ${this._computedInputPx}px;
          line-height: 1.25;
          resize: none;
        }
      `;
      document.head.appendChild(style);
      this._updateLineStyles(true);
    }

    _firstColorFromRaw (rawColor) {
      // Handles hex, rgb(), gradient(), and returns the first solid color.
      if (rawColor.includes('gradient')) return '#FFFFFF'; // Default for gradient
      if (rawColor.includes(',')) return rawColor.split(',')[0].trim();
      return rawColor;
    }

    _getStageContainer () {
      const player = document.querySelector('.scratch-desktop-wrapper') || document.querySelector('.player');
      if (player) return player;
      // Fallback for non-standard environments
      return document.body;
    }

    _createLogArea () {
      const logArea = document.createElement('div');
      logArea.style.flexGrow = 1;
      logArea.style.overflowY = 'auto';
      logArea.style.display = 'flex';
      logArea.style.flexDirection = 'column-reverse'; // Stack logs from bottom up
      this.consoleOverlay.appendChild(logArea);
      this.logArea = logArea;
    }

    _createInput () {
      const input = document.createElement('input');
      input.className = 'consoleInput';
      input.type = 'text';
      input.placeholder = this.style.inputPlaceholder;
      Object.assign(input.style, {
        background: this.style.inputBG,
        color: this._firstColorFromRaw(this.style.inputTextRaw),
        fontFamily: this.style.fontInput
      });

      this.inputOverlay.appendChild(input);
      this.inputField = input;

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this._handleInput(input.value);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this._history(1);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          this._history(-1);
        }
      });
      input.addEventListener('input', () => {
        this._inputCache = input.value;
      });
      this._updateInputFontSize();
    }

    _history (direction) {
      if (this._inputHistory.length === 0) return;

      if (this._inputHistoryIndex === -1) {
        // Cache current input before starting history navigation
        this._inputCache = this.inputField.value;
      }

      let newIndex = this._inputHistoryIndex + direction;

      // Wrap-around logic
      if (newIndex >= this._inputHistory.length) {
        newIndex = -1; // back to live input
      } else if (newIndex < -1) {
        newIndex = this._inputHistory.length - 1;
      }

      this._inputHistoryIndex = newIndex;

      if (newIndex === -1) {
        this.inputField.value = this._inputCache;
      } else {
        this.inputField.value = this._inputHistory[newIndex];
      }
      this.inputField.dispatchEvent(new Event('input')); // Update VM variable
    }

    _handleInput (text) {
      const trimmedText = text.trim();

      if (trimmedText.length > 0) {
        // Add to history if not duplicate of last history entry
        if (this._inputHistory.length === 0 || this._inputHistory[0] !== trimmedText) {
          this._inputHistory.unshift(trimmedText);
        }
        // Limit history size (e.g., 50 entries)
        if (this._inputHistory.length > 50) {
          this._inputHistory.pop();
        }
      }

      // Clear input and reset index
      this.inputField.value = '';
      this._inputCache = '';
      this._inputHistoryIndex = -1;

      // Dispatch event
      this._dispatchInput(text, true);
    }

    _createOverlays () {
      const container = this._getStageContainer();
      if (!container) {
        console.error('[Console] Could not find stage container.');
        return;
      }

      // Console Overlay
      const consoleOverlay = document.createElement('div');
      consoleOverlay.className = 'consoleOverlay';
      consoleOverlay.style.background = this.style.inputBG;
      this.consoleOverlay = consoleOverlay;
      container.appendChild(consoleOverlay);

      this._createLogArea();

      // Input Overlay
      const inputOverlay = document.createElement('div');
      inputOverlay.className = 'inputOverlay';
      this.inputOverlay = inputOverlay;
      container.appendChild(inputOverlay);

      this._createInput();

      this._setupIntersectionObserver();
      this._resizeDynamicSizes();
    }

    _setupIntersectionObserver () {
      if (this.observer) this.observer.disconnect();

      this.observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          const line = entry.target;
          if (entry.isIntersecting) {
            // Restore actual content (preventing initial render)
            if (line._logData) {
              this._renderLineContent(line, line._logData);
              delete line._logData; // Data consumed
            }
          } else {
            // Unload content for non-visible elements (optional, depends on performance needs)
            // Not strictly needed since we are using flex-direction: column-reverse, but useful for older lines.
          }
        });
      }, {
        root: this.logArea,
        threshold: 0 // Only check if intersecting at all
      });
    }

    _handleIntersection () {
      if (!this.logArea) return;
      // Re-observe all lines when content or size changes
      Array.from(this.logArea.children).forEach(line => {
        this.observer.unobserve(line);
        this.observer.observe(line);
      });
    }

    _renderLineContent (line, data) {
      if (data.type === 'text' || data.type === 'gradient') {
        const textSpan = document.createElement('span');
        textSpan.className = 'console-line-text';
        textSpan.textContent = data.text;
        line.appendChild(textSpan);
        
        // Apply styling
        if (data.type === 'text') {
            textSpan.style.color = data.color;
        } else if (data.type === 'gradient') {
            textSpan.style.backgroundImage = data.gradient;
            textSpan.style.webkitBackgroundClip = 'text';
            textSpan.style.webkitTextFillColor = 'transparent';
        }
        
        textSpan.style.fontSize = `${data.fontSize}px`;
        textSpan.style.fontFamily = data.font;
        line.style.textAlign = data.align;

      } else if (data.type === 'image') {
        const imgContainer = document.createElement('span');
        imgContainer.className = 'console-line-text image-line'; // For flex alignment
        
        const img = document.createElement('img');
        img.src = data.url;
        img.alt = '[Image]';
        img.style.maxWidth = data.width === 0 ? 'auto' : `${data.width}px`;
        img.style.maxHeight = data.height === 0 ? 'auto' : `${data.height}px`;
        img.style.borderRadius = `${data.roundness}%`;
        
        // Add padding/margin to make space for image
        imgContainer.style.margin = '4px 0'; // Auto-spacing
        
        imgContainer.appendChild(img);
        line.appendChild(imgContainer);
        line.style.textAlign = data.align;
      }

      if (data.timestamp) {
        const timestampSpan = document.createElement('span');
        timestampSpan.className = 'console-timestamp';
        timestampSpan.textContent = data.timestamp;
        line.insertBefore(timestampSpan, line.firstChild);
        line.style.alignItems = 'flex-start'; // Align text/image to start if timestamp exists
      }
    }

    _log (text, color = this._firstColorFromRaw(this.style.inputTextRaw), size = this._computedFontPx, font = this.style.font, align = 'left', gradient = null, isImage = false, imgUrl = null, imgW = 0, imgH = 0, imgR = 0) {
      if (!this.logArea || !this.consoleVisible) return;

      const line = document.createElement('div');
      line.className = 'console-line';
      // Store raw data to be rendered only when visible (IntersectionObserver)
      const data = {
        timestamp: this._getTimestamp(),
        align: align,
      };

      if (isImage) {
          data.type = 'image';
          data.url = imgUrl;
          data.width = imgW;
          data.height = imgH;
          data.roundness = imgR;
      } else if (gradient) {
          data.type = 'gradient';
          data.text = text;
          data.gradient = gradient;
          data.fontSize = size;
          data.font = font;
      } else {
          data.type = 'text';
          data.text = text;
          data.color = color;
          data.fontSize = size;
          data.font = font;
      }
      
      line._logData = data;
      this.logArea.prepend(line); // Add to the top of the column-reverse container
      
      this.observer.observe(line);

      this.currentLog.unshift(data);
      this.lastLog = text;
      
      this._handleScroll(line);
    }
    
    _handleScroll(newLine) {
        // Since we use column-reverse and prepend, the newest line is the first child.
        // Autoscroll logic is now implicitly handled by ensuring the bottom of the container is always visible.
        // We only need to scroll if the user hasn't manually scrolled up.
        // Given that we are using flex-direction: column-reverse, we check if the scroll is at the 'top' (visual bottom)
        const isAtBottom = this.logArea.scrollTop === 0;

        // Force scroll to the top (which is the bottom of the visual log)
        if (isAtBottom) {
            this.logArea.scrollTop = 0;
        }
    }

    _getTimestamp () {
      if (this._timestampMode === 'none') return '';
      const now = new Date();
      if (this._timestampMode === 'absolute') {
        return now.toLocaleTimeString();
      }
      // relative
      if (!this._startTime) this._startTime = Date.now();
      const elapsed = Date.now() - this._startTime;
      const seconds = Math.floor(elapsed / 1000);
      return `[+${seconds}s]`;
    }

    _updateLineStyles (initial = false) {
      if (!this.consoleOverlay) return;

      // Update log line defaults in CSS
      const style = document.getElementById('console-css');
      if (style) {
        let cssText = style.innerHTML;
        // This is complex to update dynamically, so we rely more on inline styles for logs,
        // but update input related styles here.
        
        // Update font size and input styles
        const stageContainer = this._getStageContainer();
        if (stageContainer) {
          const computedStyle = window.getComputedStyle(stageContainer);
          // Assuming 16px is the base for 'font-size' unless specified
          this._computedFontPx = parseFloat(computedStyle.fontSize || 16);
          this._computedInputPx = parseFloat(computedStyle.fontSize || 16);
        }

        // We update input field directly for now
        this._updateInputFontSize();
        
        this._resizeDynamicSizes();
      }
    }

    _updateInputFontSize () {
      if (this.inputField) {
        this.inputField.style.fontSize = `${this._computedInputPx}px`;
      }
    }

    _resizeDynamicSizes () {
      if (this.consoleOverlay && this.inputField && this.inputVisible) {
        // Fix input being higher than previously by ensuring fallback height includes full 10px padding * 2
        const inputHt = this.inputField.getBoundingClientRect().height || (this._computedInputPx + 20); // MODIFIED: was + 16
        this.consoleOverlay.style.paddingBottom = `${inputHt}px`;
      } else if (this.consoleOverlay) {
        this.consoleOverlay.style.paddingBottom = '';
      }
      this._handleIntersection();
    }

    // BLOCK IMPLEMENTATIONS

    show () {
      if (this.consoleOverlay) {
        this.consoleOverlay.classList.add('visible');
        this.consoleVisible = true;
        this._resizeDynamicSizes();
      }
      if (this.inputOverlay && this.inputVisible) {
        this.inputOverlay.classList.add('visible');
      }
    }

    hide () {
      if (this.consoleOverlay) {
        this.consoleOverlay.classList.remove('visible');
        this.consoleVisible = false;
        this._resizeDynamicSizes();
      }
      if (this.inputOverlay) {
        this.inputOverlay.classList.remove('visible');
      }
    }

    clear () {
      this.currentLog = [];
      if (this.logArea) {
        this.logArea.innerHTML = '';
      }
    }

    logText (args) {
      const color = String(args.COLOR || this._firstColorFromRaw(this.style.inputTextRaw));
      const size = Number(args.FONT_SIZE || this._computedFontPx);
      const font = String(args.FONT || this.style.font);
      const align = String(args.ALIGN || 'left');
      this._log(String(args.TEXT || ''), color, size, font, align);
    }

    logGradient (args) {
      const gradient = `linear-gradient(to right, ${args.COLOR1}, ${args.COLOR2})`;
      const size = Number(args.FONT_SIZE || this._computedFontPx);
      const font = String(args.FONT || this.style.font);
      const align = String(args.ALIGN || 'left');
      this._log(String(args.TEXT || ''), null, size, font, align, gradient);
    }
    
    logImage (args) {
        const url = String(args.IMAGE_URL || this.style.logImage);
        const width = Number(args.WIDTH || 0);
        const height = Number(args.HEIGHT || 0);
        const roundness = Number(args.ROUNDNESS || 0);
        this._log('', null, null, null, 'left', null, true, url, width, height, roundness);
    }

    showInput () {
      this.inputVisible = true;
      if (this.inputOverlay) {
        this.inputOverlay.classList.add('visible');
        // If the console is visible, recalculate padding
        if (this.consoleVisible) {
          this._resizeDynamicSizes();
          // Focus input only if console is also visible
          if (this.inputField) this.inputField.focus();
        }
      }
    }

    hideInput () {
      this.inputVisible = false;
      if (this.inputOverlay) {
        this.inputOverlay.classList.remove('visible');
        this._resizeDynamicSizes();
      }
    }

    setInputPlaceholder (args) {
      this.style.inputPlaceholder = String(args.TEXT);
      if (this.inputField) {
        this.inputField.placeholder = this.style.inputPlaceholder;
      }
    }

    getInputText () {
      return (this.inputField ? this.inputField.value : this._inputCache) || '';
    }

    getLastInput () {
      return this.lastInput;
    }

    enableInputLogging (args) {
      this.logInputEnabled = !!args.ENABLED;
    }

    setConsoleStyle (args) {
      const bg = String(args.BG || this.style.inputBG);
      const textColorRaw = String(args.TEXT_COLOR || this.style.inputTextRaw);
      const inputBG = String(args.INPUT_BG || this.style.inputBG);
      const inputTextRaw = String(args.INPUT_TEXT || this.style.inputTextRaw);

      this.style.inputBG = inputBG;
      this.style.inputTextRaw = inputTextRaw;

      if (this.consoleOverlay) {
        this.consoleOverlay.style.background = bg;
        // Note: setting console text color here affects the default for non-specific logs
        // This is complex due to existing inline styles, but we set the base log color
        // The default line style in CSS will inherit if no inline style is applied.
      }
      if (this.inputField) {
        this.inputField.style.background = inputBG;
        this.inputField.style.color = this._firstColorFromRaw(inputTextRaw);
      }
    }

    setFontDefaults (args) {
      this.style.font = String(args.FONT || this._defaults.font);
      this._computedFontPx = Number(args.FONT_SIZE || 16);
      this._computedLineHeight = Number(args.LINE_HEIGHT || 1.25);

      // Re-apply to all existing lines if needed, but primarily update CSS defaults
      // For simplicity, we update the input field explicitly
      if (this.inputField) {
        this.inputField.style.fontFamily = this.style.font;
      }
      // Note: Re-injecting CSS is usually the easiest way to update global styles,
      // but causes flicker. Relying on inline styles for logs is better.
      this._updateLineStyles();
    }

    setTimestampMode (args) {
      this._timestampMode = String(args.MODE || 'none');
      if (this._timestampMode === 'relative') {
        this._startTime = Date.now();
      }
    }
    
    // Internal API for reporters
    getCurrentInput () { return (this.inputField ? this.inputField.value : this._inputCache) || ''; }
    isInputShown () { return !!this.inputVisible; }
    _dispatchInput (text, manual) { 
      const txt = String(text || ''); 
      this.lastInput = txt; 
      if (this.logInputEnabled && txt.trim()) this._log('> ' + txt.trim(), '#FFFFFF'); 
      this._inputEventId = (this._inputEventId || 0) + 1; 
      try { 
        if (typeof vm !== 'undefined' && vm && vm.runtime && typeof vm.runtime.startHats === 'function') 
          vm.runtime.startHats(`${this.id}_whenInput`); 
      } catch (e) {} 
    }
    whenInput (args, util) { 
      try { 
        const tid = util?.target?.id ?? 'global'; 
        if (!this._lastSeenEventIdByTarget) this._lastSeenEventIdByTarget = new Map(); 
        const lastSeen = this._lastSeenEventIdByTarget.get(tid) || 0; 
        if ((this._inputEventId || 0) > lastSeen) { 
          this._lastSeenEventIdByTarget.set(tid, this._inputEventId); 
          return true; 
        } 
        return false; 
      } catch (e) { 
        return false; 
      } 
    }
  }

  // register extension
  try {
    const instance = new ConsoleExtension();
    if (Scratch && Scratch.extensions && typeof Scratch.extensions.register === 'function') {
      Scratch.extensions.register(instance);
    } else {
      window.__consoleExtensionInstance = instance;
      console.warn('[Console extension] instance available at window.__consoleExtensionInstance.');
    }
  } catch (e) {
    console.error('[Console extension] Registration failed:', e);
  }

})(Scratch);
