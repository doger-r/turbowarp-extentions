(function (Scratch) {
  'use strict';

  /**
   * Console Extension v8.3 (Alignment Tweaks)
   * * Changes:
   * - Adjusted default line spacing to 1.2 for both Console and Input.
   * - Increased negative margin on Console container (-6px) to align items higher.
   * - Unified line-height calculation (pixel-based) persists.
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
      
      // Input Specifics
      this.inputWrapper = null; 
      this.inputHighlight = null; 
      this.inputField = null; 
      
      this.suggestionBox = null;
      this.stage = null;

      // data
      this._consoleCache = []; 
      this._nextId = 1;
      this._inputCache = '';
      this.lastInput = '';
      this._autocorrectEnabled = false;
      
      // Selection Tracking
      this._currentSelection = { start: 0, end: 0 };
      this._lastSelection = { start: 0, end: 0 };
      
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
        // Split Spacing - Updated defaults to 1.2
        consoleLineSpacing: 1.2, 
        inputLineSpacing: 1.2,
        
        minInputHeightPct: 10,  
        maxInputHeightPct: 40, 
        consoleWrapping: 'wrap', 
        inputWrapping: 'wrap',
        inputPosition: 'bottom',
        enterBehavior: 'submit',
        textStyle: 'default',   
        gradientMode: 'normal',
        
        // --- Padding defaults ---
        consolePadding: 10,
        inputPadding: 10
      };
      this.style = Object.assign({}, this._defaults);

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
        'styleLine', 'resetLineStyle',
        'getConsoleAsArray','setConsoleFromArray','getConsoleLineCount','isConsoleShown','setSelectable',
        'setTimestampFormat','toggleInput','showInput','hideInput','setInputText','runInput','clearInput','setLogInput',
        'whenInput','getLastInput','getCurrentInput','isInputShown',
        'setAutocorrect', 'getSelectionPosition', 'setInputPosition', 'setEnterBehavior',
        'addCommand', 'removeCommand', 'clearCommands',
        'setColorPicker','gradientReporter','gradient3Reporter','gradient4Reporter','setFont','setTextSizeMultiplier','setAlignment',
        'setLineSpacing', 
        'setPadding',
        'setInputPlaceholder','setInputHeightRange','setTextWrapping',
        'setTextStyle', 'setGradientMode', 
        'resetStyling',
        'setScrollTo','getMaxScroll','getCurrentScroll','setAutoScroll','isAutoScroll'
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
          
          { opcode: 'logImage', blockType: BlockType.COMMAND, text: 'log image [SRC] size [W] x [H] roundness [R]', arguments: { SRC: { type: ArgumentType.STRING, defaultValue: 'https://extensions.turbowarp.org/dango.png' }, W: { type: ArgumentType.NUMBER, defaultValue: 0 }, H: { type: ArgumentType.NUMBER, defaultValue: 0 }, R: { type: ArgumentType.NUMBER, defaultValue: 4 } } },
          
          { opcode: 'logDots', blockType: BlockType.COMMAND, text: 'log dots in color [COLOR]', arguments: { COLOR: { type: ArgumentType.COLOR, defaultValue: '#FFFFFF' } } },
          
          { opcode: 'removeLine', blockType: BlockType.COMMAND, text: 'remove console line [INDEX]', arguments: { INDEX: { type: ArgumentType.NUMBER, defaultValue: 1 } } },

          { opcode: 'styleLine', blockType: BlockType.COMMAND, text: 'style line [INDEX] font [FONT] size [SIZE] align [ALIGN]', arguments: { INDEX: { type: ArgumentType.NUMBER, defaultValue: 1 }, FONT: { type: ArgumentType.STRING, defaultValue: 'Sans Serif' }, SIZE: { type: ArgumentType.NUMBER, defaultValue: 1 }, ALIGN: { type: ArgumentType.STRING, menu: 'alignmentMenu', defaultValue: 'left' } } },
          
          { opcode: 'resetLineStyle', blockType: BlockType.COMMAND, text: 'reset style on line [INDEX]', arguments: { INDEX: { type: ArgumentType.NUMBER, defaultValue: 1 } } },

          { opcode: 'getConsoleAsArray', blockType: BlockType.REPORTER, text: 'get console JSON' },
          { opcode: 'setConsoleFromArray', blockType: BlockType.COMMAND, text: 'load console from JSON [ARRAY]', arguments: { ARRAY: { type: ArgumentType.STRING, defaultValue: '[]' } } },
          { opcode: 'getConsoleLineCount', blockType: BlockType.REPORTER, text: 'console line count' },
          { opcode: 'isConsoleShown', blockType: BlockType.BOOLEAN, text: 'console shown?' },

          { blockType: BlockType.LABEL, text: 'Scroll & View' },
          { opcode: 'setScrollTo', blockType: BlockType.COMMAND, text: 'set [TARGET] scroll to [Y]', arguments: { TARGET: { type: ArgumentType.STRING, menu: 'scrollTargetMenu', defaultValue: 'console' }, Y: { type: ArgumentType.NUMBER, defaultValue: 0 } } },
          { opcode: 'getMaxScroll', blockType: BlockType.REPORTER, text: '[TARGET] max scroll', arguments: { TARGET: { type: ArgumentType.STRING, menu: 'scrollTargetMenu', defaultValue: 'console' } } },
          { opcode: 'getCurrentScroll', blockType: BlockType.REPORTER, text: '[TARGET] current scroll', arguments: { TARGET: { type: ArgumentType.STRING, menu: 'scrollTargetMenu', defaultValue: 'console' } } },
          
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

          { opcode: 'setInputPosition', blockType: BlockType.COMMAND, text: 'set input position to [POS]', arguments: { POS: { type: ArgumentType.STRING, menu: 'positionMenu', defaultValue: 'bottom' } } },
          { opcode: 'setEnterBehavior', blockType: BlockType.COMMAND, text: 'set enter key behavior to [BEHAVIOR]', arguments: { BEHAVIOR: { type: ArgumentType.STRING, menu: 'enterMenu', defaultValue: 'submit' } } },

          { opcode: 'setAutocorrect', blockType: BlockType.COMMAND, text: 'set browser autocorrect to [ENABLED]', arguments: { ENABLED: { type: ArgumentType.BOOLEAN, defaultValue: false } } },
          { opcode: 'getSelectionPosition', blockType: BlockType.REPORTER, text: 'input [SOURCE] selection [POSITION]', arguments: { 
              SOURCE: { type: ArgumentType.STRING, menu: 'inputSourceMenu', defaultValue: 'current' }, 
              POSITION: { type: ArgumentType.STRING, menu: 'selectionPositionMenu', defaultValue: 'start' } 
          } },

          { blockType: BlockType.LABEL, text: 'Global Styling' },
          { opcode: 'setColorPicker', blockType: BlockType.COMMAND, text: 'set [PART] color to [COLOR]', arguments: { PART: { type: ArgumentType.STRING, menu: 'colorParts', defaultValue: 'console background' }, COLOR: { type: ArgumentType.COLOR, defaultValue: '#000000' } } },
          
          { opcode: 'gradientReporter', blockType: BlockType.REPORTER, text: 'gradient [COLOR1] to [COLOR2] angle [ANGLE]', arguments: { COLOR1: { type: ArgumentType.COLOR, defaultValue: '#000000' }, COLOR2: { type: ArgumentType.COLOR, defaultValue: '#333333' }, ANGLE: { type: ArgumentType.NUMBER, defaultValue: 180 } } },
          { opcode: 'gradient3Reporter', blockType: BlockType.REPORTER, text: 'gradient [COLOR1] to [COLOR2] to [COLOR3] angle [ANGLE]', arguments: { COLOR1: { type: ArgumentType.COLOR, defaultValue: '#000000' }, COLOR2: { type: ArgumentType.COLOR, defaultValue: '#555555' }, COLOR3: { type: ArgumentType.COLOR, defaultValue: '#999999' }, ANGLE: { type: ArgumentType.NUMBER, defaultValue: 180 } } },
          { opcode: 'gradient4Reporter', blockType: BlockType.REPORTER, text: 'gradient [COLOR1] to [COLOR2] to [COLOR3] to [COLOR4] angle [ANGLE]', arguments: { COLOR1: { type: ArgumentType.COLOR, defaultValue: '#000000' }, COLOR2: { type: ArgumentType.COLOR, defaultValue: '#444444' }, COLOR3: { type: ArgumentType.COLOR, defaultValue: '#888888' }, COLOR4: { type: ArgumentType.COLOR, defaultValue: '#CCCCCC' }, ANGLE: { type: ArgumentType.NUMBER, defaultValue: 180 } } },

          { opcode: 'setFont', blockType: BlockType.COMMAND, text: 'set [PART] font to [FONT]', arguments: { PART: { type: ArgumentType.STRING, menu: 'fontParts', defaultValue: 'text' }, FONT: { type: ArgumentType.STRING, defaultValue: 'Sans Serif' } } },
          { opcode: 'setTextStyle', blockType: BlockType.COMMAND, text: 'set [PART] text style to [STYLE]', arguments: { PART: { type: ArgumentType.STRING, menu: 'styleParts', defaultValue: 'text' }, STYLE: { type: ArgumentType.STRING, menu: 'styleMenu', defaultValue: 'default' } } },
          { opcode: 'setGradientMode', blockType: BlockType.COMMAND, text: 'set gradient mode to [MODE]', arguments: { MODE: { type: ArgumentType.STRING, menu: 'gradientModeMenu', defaultValue: 'normal' } } },

          { opcode: 'setTextSizeMultiplier', blockType: BlockType.COMMAND, text: 'set [PART] text size multiplier to [MULTIPLIER]', arguments: { PART: { type: ArgumentType.STRING, menu: 'sizeParts', defaultValue: 'text' }, MULTIPLIER: { type: ArgumentType.NUMBER, defaultValue: 1 } } },
          { opcode: 'setAlignment', blockType: BlockType.COMMAND, text: 'set [PART] alignment to [ALIGN]', arguments: { PART: { type: ArgumentType.STRING, menu: 'alignmentParts', defaultValue: 'text' }, ALIGN: { type: ArgumentType.STRING, menu: 'alignmentMenu', defaultValue: 'left' } } },
          { opcode: 'setTextWrapping', blockType: BlockType.COMMAND, text: 'set [PART] text wrapping to [MODE]', arguments: { PART: { type: ArgumentType.STRING, menu: 'wrappingParts', defaultValue: 'console' }, MODE: { type: ArgumentType.STRING, menu: 'wrappingMode', defaultValue: 'wrap' } } },

          // --- Updated setLineSpacing block ---
          { opcode: 'setLineSpacing', blockType: BlockType.COMMAND, text: 'set [PART] line spacing to [SPACING]', arguments: { PART: { type: ArgumentType.STRING, menu: 'wrappingParts', defaultValue: 'console' }, SPACING: { type: ArgumentType.NUMBER, defaultValue: 1.0 } } },
          
          { opcode: 'setPadding', blockType: BlockType.COMMAND, text: 'set [PART] padding to [PADDING] px', arguments: { PART: { type: ArgumentType.STRING, menu: 'wrappingParts', defaultValue: 'console' }, PADDING: { type: ArgumentType.NUMBER, defaultValue: 10 } } },

          { opcode: 'setInputPlaceholder', blockType: BlockType.COMMAND, text: 'set input placeholder to [TEXT]', arguments: { TEXT: { type: ArgumentType.STRING, defaultValue: 'Type command...' } } },
          { opcode: 'setInputHeightRange', blockType: BlockType.COMMAND, text: 'set input height min [MIN]% max [MAX]%', arguments: { MIN: { type: ArgumentType.NUMBER, defaultValue: 10 }, MAX: { type: ArgumentType.NUMBER, defaultValue: 40 } } },

          { opcode: 'setTimestampFormat', blockType: BlockType.COMMAND, text: 'set timestamp format to [FORMAT]', arguments: { FORMAT: { type: ArgumentType.STRING, menu: 'timeFormat', defaultValue: 'off' } } },
          { opcode: 'resetStyling', blockType: BlockType.COMMAND, text: 'reset styling' }
        ],
        menus: {
          toggleMenu: ['show', 'hide', 'toggle'],
          timeFormat: ['off', '24h', '12h', 'relative'],
          colorParts: ['console background', 'input background', 'input text', 'timestamp text', 'input placeholder'],
          fontParts: ['text', 'timestamp', 'input'],
          styleParts: ['text', 'input'],
          styleMenu: ['default', 'javascript'],
          gradientModeMenu: ['normal', 'split'],
          sizeParts: ['text', 'timestamp', 'input'],
          alignmentParts: ['text', 'input'],
          alignmentMenu: ['left', 'center', 'right'],
          wrappingParts: ['console', 'input'],
          wrappingMode: ['wrap', 'scroll'],
          scrollTargetMenu: ['console', 'input'],
          inputSourceMenu: ['current', 'last'],
          selectionPositionMenu: ['start', 'end'],
          positionMenu: ['top', 'bottom'],
          enterMenu: ['submit', 'newline', 'disabled']
        }
      };
    }

    // ---- CSS ----
    _injectBaseCSS () {
      const style = document.createElement('style');
      style.textContent = `
        /* BASE SCROLLBAR HIDING (Default) */
        .console-scroller { scrollbar-width: none; -ms-overflow-style: none; overflow: auto; cursor: default; }
        .console-scroller::-webkit-scrollbar { display: none; }
        .console-scroller::-webkit-scrollbar-corner { background: transparent; }

        /* SCROLLBAR VISIBILITY */
        .console-scroller.sb-show-y { 
            overflow-y: auto !important; 
            scrollbar-width: thin !important; 
            scrollbar-color: rgba(255,255,255,0.3) transparent !important; 
        }
        .console-scroller.sb-show-y::-webkit-scrollbar { 
            display: block !important; 
            width: 10px; 
        }
        .console-scroller.sb-show-y::-webkit-scrollbar-track { 
            background: transparent; 
        }
        .console-scroller.sb-show-y::-webkit-scrollbar-thumb { 
            background: rgba(255,255,255,0.3); 
            border-radius: 5px; 
            border: 2px solid transparent; 
            background-clip: content-box; 
        }
        .console-scroller.sb-show-y::-webkit-scrollbar-thumb:hover { 
            background: rgba(255,255,255,0.5); 
        }
        .console-scroller.sb-show-y::-webkit-scrollbar-corner { 
            background: transparent !important; 
        }
        
        .console-scroller.sb-show-x { 
            overflow-x: auto !important; 
            scrollbar-width: thin !important; 
            scrollbar-color: rgba(255,255,255,0.3) transparent !important; 
        }
        .console-scroller.sb-show-x::-webkit-scrollbar { 
            display: block !important; 
            height: 10px; 
        }
        .console-scroller.sb-show-x::-webkit-scrollbar-track { 
            background: transparent;
        }
        .console-scroller.sb-show-x::-webkit-scrollbar-thumb { 
            background: rgba(255,255,255,0.3); 
            border-radius: 5px; 
            border: 2px solid transparent; 
            background-clip: content-box; 
        }
        .console-scroller.sb-show-x::-webkit-scrollbar-thumb:hover { 
            background: rgba(255,255,255,0.5); 
        }
        .console-scroller.sb-show-x::-webkit-scrollbar-corner { 
            background: transparent !important; 
        }

        .console-line { 
          display: block; 
          width: fit-content; 
          min-width: 100%;
          cursor: text;
          margin: 0;
          padding: 0;
          /* Important: Ensure line height is strictly respected */
          vertical-align: top;
        }
        .console-spacing { width: 100%; display: block; } 

        /* INPUT STRUCTURE CSS */
        .console-input-wrapper {
          position: relative;
          display: block;
          margin: 0;
          width: 100%;
          overflow: hidden; 
          background: transparent;
          box-sizing: border-box;
        }

        .console-input-highlight {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          z-index: 1;
          pointer-events: none; 
          color: transparent; 
          white-space: pre-wrap;
          word-break: break-word;
          overflow: hidden;
          margin: 0;
          padding: 0;
          border: none;
          background: transparent;
          box-sizing: border-box;
        }

        .console-input { 
          position: relative;
          z-index: 2;
          width: 100%; 
          height: 100%;
          border: none !important; 
          outline: none !important; 
          box-shadow: none !important; 
          background-color: transparent !important; 
          resize: none !important;
          overflow: auto;
          display: block; 
          margin: 0; 
          padding: 0;
          box-sizing: border-box;
          color: inherit; 
          font-family: inherit;
          cursor: text !important;
        }
        
        .console-input::placeholder { color: var(--console-input-placeholder-color, ${this._defaults.inputPlaceholderColorRaw}) !important; opacity: 1 !important; }
        
        /* Syntax Highlighting Classes */
        .console-syntax-keyword { color: #569cd6 !important; font-weight: bold; }
        .console-syntax-string { color: #ce9178 !important; }
        .console-syntax-comment { color: #6a9955 !important; font-style: italic; }
        .console-syntax-number { color: #b5cea8 !important; }
        .console-syntax-built-in { color: #4ec9b0 !important; }

        .console-suggestions {
          position: absolute;
          left: 0; right: 0;
          max-height: 150px;
          overflow-y: auto;
          display: none;
          z-index: 100;
          box-shadow: 0px 2px 10px rgba(0,0,0,0.3);
          border-radius: 4px;
        }
        .console-suggestions.sb-show-y { scrollbar-width: auto; }
        
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
        this.inputWrapper = null;
        this.inputHighlight = null;
        this.suggestionBox = null;
        this._createInput();
        // Restore input state
        if (this.inputField && this._inputCache) {
             this.inputField.value = this._inputCache;
             this._updateInputSyntax(); 
             this._updateInputHeight();
        }
        // Restore styling logic that might have been lost
        this._applyInputTextColor(this.style.inputTextRaw);
      }
      if (Date.now() - (this._lastUserScroll || 0) > this._userScrollGrace) this._applyCachedScroll();
    }

    // ---- DYNAMIC SIZING LOGIC (Separated Spacing) ----
    _resizeDynamicSizes () {
      const stageH = (typeof vm !== 'undefined' && vm && vm.runtime && vm.runtime.renderer && vm.runtime.renderer.canvas)
        ? vm.runtime.renderer.canvas.clientHeight
        : 360;
      const scale = stageH / 360;
      const base = 14;

      this._computedTsPx = Math.max(0.1, base * scale * (this.style.sizeTimestamp || 1));
      this._computedInputPx = Math.max(0.1, base * scale * (this.style.sizeInput || 1));
      
      const conSpacing = this.style.consoleLineSpacing || 1.0;
      const inpSpacing = this.style.inputLineSpacing || 1.5;

      if (this.logArea) {
        this.logArea.style.padding = `${this.style.consolePadding}px`;
        // --- Correction for Console alignment ---
        // Shift up slightly (negative margin) to match Input baseline quirk
        this.logArea.style.marginTop = '-6px'; 

        for (const line of Array.from(this.logArea.children)) {
          if (line.classList.contains('console-spacing')) continue; 
          
          const lineMult = line.dataset.sizeMult ? Number(line.dataset.sizeMult) : (this.style.sizeText || 1);
          const linePx = Math.max(0.1, base * scale * lineMult);

          // STRICT CALCULATION: Font Size * Spacing
          const dynamicLineHeight = linePx * conSpacing;
          
          line.style.lineHeight = `${dynamicLineHeight}px`;
          line.style.fontSize = `${linePx}px`; 
          
          line.style.marginTop = '0px';
          line.style.paddingBottom = '0px'; 
          line.style.marginBottom = '0px';

          const spans = line.querySelectorAll('span');
          if (spans[0]) spans[0].style.fontSize = `${this._computedTsPx}px`;
          
          for (let i = 1; i < spans.length; i++) {
             spans[i].style.fontSize = `${linePx}px`;
          }
        }
      }

      if (this.inputField && this.inputHighlight) {
        // MATCH CONSOLE LOGIC: Calculate strict pixel line height (FontSize * Spacing)
        const dynamicInputLineHeight = this._computedInputPx * inpSpacing;
        
        const props = {
            fontSize: `${this._computedInputPx}px`,
            fontFamily: this.style.fontInput,
            textAlign: this.style.inputAlign,
            lineHeight: `${dynamicInputLineHeight}px`, // Explicit pixels, matching console logic
            letterSpacing: 'normal'
        };
        
        Object.assign(this.inputField.style, props);
        Object.assign(this.inputHighlight.style, props);
        
        this._updateInputHeight();
      }
      if (this.suggestionBox) {
        this.suggestionBox.style.fontSize = `${this._computedInputPx}px`;
        this.suggestionBox.style.fontFamily = this.style.fontInput;
      }

      if (this.consoleOverlay) {
          if (this.inputField && this.inputVisible) {
              const inputHt = this.inputWrapper ? this.inputWrapper.offsetHeight : (this._computedInputPx + 36);
              if (this.style.inputPosition === 'top') {
                  this.consoleOverlay.style.paddingTop = `${inputHt}px`;
                  this.consoleOverlay.style.paddingBottom = '';
              } else {
                  this.consoleOverlay.style.paddingTop = '';
                  this.consoleOverlay.style.paddingBottom = `${inputHt}px`;
              }
          } else {
              this.consoleOverlay.style.paddingTop = '';
              this.consoleOverlay.style.paddingBottom = '';
          }
      }
    }

    _updateInputHeight() {
        if (!this.inputField || !this.inputWrapper || !this.stage) return;
        
        this.inputField.style.height = 'auto'; 
        
        const contentHeight = this.inputField.scrollHeight;
        const stageH = this.stage.clientHeight || 360;
        
        const wrapperPadding = this.style.inputPadding * 2;
        const desiredWrapperHeight = contentHeight + wrapperPadding; 
        
        const maxPct = this.style.maxInputHeightPct || 40; 
        const minPct = this.style.minInputHeightPct || 10;
        const maxWrapperHeightPx = stageH * (maxPct / 100);
        
        const minFontHeight = (this._computedInputPx || 14) * (this.style.inputLineSpacing || 1.5);
        const minWrapperHeightFromFont = minFontHeight + wrapperPadding;
        const minWrapperHeightFromPct = stageH * (minPct / 100);
        
        const minWrapperHeightPx = Math.max(minWrapperHeightFromFont, minWrapperHeightFromPct);

        const clampedWrapperHeight = Math.min(
            Math.max(desiredWrapperHeight, minWrapperHeightPx), 
            maxWrapperHeightPx
        );
        
        this.inputWrapper.style.height = `${clampedWrapperHeight}px`;
        this.inputField.style.height = '100%'; 

        if (this.consoleOverlay && this.inputVisible) {
            if (this.style.inputPosition === 'top') {
                this.consoleOverlay.style.paddingTop = `${clampedWrapperHeight}px`;
                this.consoleOverlay.style.paddingBottom = '';
            } else {
                this.consoleOverlay.style.paddingTop = '';
                this.consoleOverlay.style.paddingBottom = `${clampedWrapperHeight}px`;
            }
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
        zIndex: '50', 
        padding: '0',
        boxSizing: 'border-box',
        userSelect: this.textSelectable ? 'text' : 'none',
        pointerEvents: 'none'
      });
      
      this._updateBackgrounds('console', overlay, null);

      const logArea = document.createElement('div');
      logArea.className = 'console-scroller';
      Object.assign(logArea.style, {
        flex: '1',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        background: 'transparent',
        pointerEvents: 'auto',
        padding: `${this.style.consolePadding}px`,
        boxSizing: 'border-box',
        // --- Negative top margin to align text baseline with input text ---
        marginTop: '-6px' 
      });
      
      this._applyConsoleWrappingToContainer(logArea, this.style.consoleWrapping);
      this._updateBackgrounds('console', overlay, logArea);

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
      if (this.style.inputPosition === 'top') {
          Object.assign(overlay.style, { 
              position: 'absolute', left: '0', right: '0', top: '0', bottom: 'auto', 
              zIndex: '60', boxSizing: 'border-box', display: 'block' 
          });
      } else {
          Object.assign(overlay.style, { 
              position: 'absolute', left: '0', right: '0', bottom: '0', top: 'auto',
              zIndex: '60', boxSizing: 'border-box', display: 'block' 
          });
      }

      const suggestionBox = document.createElement('div');
      suggestionBox.className = 'console-suggestions console-scroller';
      suggestionBox.style.background = this.style.inputBG; 
      suggestionBox.style.color = this._firstColorFromRaw(this.style.inputTextRaw);
      
      if (this.style.inputPosition === 'top') {
          suggestionBox.style.top = '100%';
          suggestionBox.style.bottom = 'auto';
          suggestionBox.style.flexDirection = 'column'; 
          suggestionBox.style.borderTopLeftRadius = '0';
          suggestionBox.style.borderTopRightRadius = '0';
          suggestionBox.style.borderBottomLeftRadius = '4px';
          suggestionBox.style.borderBottomRightRadius = '4px';
      } else {
          suggestionBox.style.bottom = '100%';
          suggestionBox.style.top = 'auto';
          suggestionBox.style.flexDirection = 'column-reverse'; 
          suggestionBox.style.borderBottomLeftRadius = '0';
          suggestionBox.style.borderBottomRightRadius = '0';
          suggestionBox.style.borderTopLeftRadius = '4px';
          suggestionBox.style.borderTopRightRadius = '4px';
      }
      
      suggestionBox.classList.add('sb-show-y');

      overlay.appendChild(suggestionBox);
      this.suggestionBox = suggestionBox;

      const inputWrapper = document.createElement('div');
      inputWrapper.className = 'console-input-wrapper';
      // --- Apply dynamic padding ---
      inputWrapper.style.padding = `${this.style.inputPadding}px`;
      this._updateBackgrounds('input', inputWrapper, null); 

      const highlight = document.createElement('div');
      highlight.className = 'console-input-highlight console-scroller';
      // --- Apply dynamic padding offsets ---
      const p = `${this.style.inputPadding}px`;
      highlight.style.top = p;
      highlight.style.left = p;
      highlight.style.right = p;
      highlight.style.bottom = p;
      this._applyWrappingStyle(highlight, this.style.inputWrapping);
      
      const input = document.createElement('textarea');
      input.className = 'console-input console-scroller';
      input.setAttribute('rows', '1'); 
      input.setAttribute('autocomplete', 'off'); 
      input.setAttribute('autocorrect', this._autocorrectEnabled ? 'on' : 'off'); 
      input.setAttribute('spellcheck', this._autocorrectEnabled ? 'true' : 'false'); 
      
      this._applyWrappingStyle(input, this.style.inputWrapping);

      input.placeholder = this.style.inputPlaceholder != null ? this.style.inputPlaceholder : this._defaults.inputPlaceholder;
      this._updatePlaceholderCSS(this.style.inputPlaceholderColorRaw || this._defaults.inputPlaceholderColorRaw);

      if (this._inputCache) {
          input.style.webkitTextFillColor = 'transparent';
      } else {
          input.style.webkitTextFillColor = 'inherit';
      }
      
      this._updateBackgrounds('input', inputWrapper, input);

      const syncScroll = () => { highlight.scrollTop = input.scrollTop; highlight.scrollLeft = input.scrollLeft; };
      input.addEventListener('scroll', syncScroll);

      const updateSelection = () => {
          this._currentSelection = {
              start: input.selectionStart || 0,
              end: input.selectionEnd || 0
          };
      };
      input.addEventListener('keyup', updateSelection);
      input.addEventListener('click', updateSelection);
      input.addEventListener('select', updateSelection);
      input.addEventListener('focus', updateSelection);
      input.addEventListener('blur', updateSelection);

      input.addEventListener('keydown', (e) => {
        updateSelection(); 
        if (e.key === 'Tab') {
          e.preventDefault();
          if (this._activeSuggestions.length > 0) {
            const idx = this._suggestionIndex >= 0 ? this._suggestionIndex : 0;
            const chosen = this._activeSuggestions[idx];
            input.value = chosen;
            this._inputCache = chosen;
            input.style.webkitTextFillColor = 'transparent';
            this._updateInputSyntax();
            this._hideSuggestions();
            this._updateInputHeight(); 
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
            const behavior = this.style.enterBehavior;
            if (behavior === 'disabled') {
                e.preventDefault();
                return;
            }
            if (behavior === 'newline') {
                input.style.webkitTextFillColor = 'transparent'; 
                setTimeout(() => { this._updateInputHeight(); this._updateInputSyntax(); syncScroll(); }, 0);
                return;
            }
            if (behavior === 'submit') {
                if (e.shiftKey) {
                    input.style.webkitTextFillColor = 'transparent';
                    this._inputCache = input.value; 
                    setTimeout(() => { 
                        this._inputCache = input.value;
                        this._updateInputHeight(); 
                        this._updateInputSyntax(); 
                        syncScroll(); 
                    }, 0);
                    e.stopPropagation();
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                if (this.suggestionBox.style.display === 'flex' && this._suggestionIndex !== -1) {
                    const chosen = this._activeSuggestions[this._suggestionIndex];
                    input.value = chosen;
                    this._inputCache = chosen;
                    input.style.webkitTextFillColor = 'transparent';
                    this._updateInputSyntax();
                    this._hideSuggestions();
                    this._updateInputHeight(); 
                } else {
                    const txt = input.value;
                    input.value = '';
                    input.style.webkitTextFillColor = 'inherit';
                    this._inputCache = '';
                    this._updateInputSyntax();
                    this._hideSuggestions();
                    this._dispatchInput(txt);
                    this._updateInputHeight(); 
                }
            }
        }
      });

      input.addEventListener('input', () => { 
          this._inputCache = input.value; 
          updateSelection();
          
          if (input.value) {
              input.style.webkitTextFillColor = 'transparent';
          } else {
              input.style.webkitTextFillColor = 'inherit';
          }
          
          this._updateSuggestions(input.value);
          this._updateInputHeight(); 
          this._updateInputSyntax();
          syncScroll();
      });
      input.addEventListener('blur', () => { 
        this._inputCache = input.value; 
        updateSelection();
        setTimeout(() => this._hideSuggestions(), 200);
      });
      
      input.addEventListener('focus', () => { 
          updateSelection();
          this._updateSuggestions(input.value); 
      });

      inputWrapper.appendChild(highlight);
      inputWrapper.appendChild(input);
      overlay.appendChild(inputWrapper);
      
      try { this.stage.appendChild(overlay); } catch (e) { document.body.appendChild(overlay); }

      this.inputOverlay = overlay;
      this.inputField = input;
      this.inputHighlight = highlight;
      this.inputWrapper = inputWrapper;

      this._applyInputTextColor(this.style.inputTextRaw);
      
      requestAnimationFrame(() => {
          this._resizeDynamicSizes();
          this._updateInputHeight();
      });
    }

    // ---- Syntax Highlighting For Input ----
    _updateInputSyntax() {
        if (!this.inputField || !this.inputHighlight) return;
        const text = this.inputField.value;
        this.inputHighlight.innerHTML = ''; 

        if (this.style.textStyle === 'javascript') {
            this._renderJavascriptSyntax(this.inputHighlight, text, this.style.fontInput);
            if (text.endsWith('\n')) {
                this.inputHighlight.appendChild(document.createTextNode('\u200B'));
            }
        } else {
             this.inputHighlight.textContent = text;
             if (text.endsWith('\n')) {
                this.inputHighlight.appendChild(document.createTextNode('\u200B'));
            }
        }
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
        const lines = text.split('\n');
        const currentLine = lines[lines.length - 1].trim();
        
        if (!currentLine) {
             this._hideSuggestions();
             return;
        }

        this._activeSuggestions = Array.from(this._commandRegistry)
            .filter(cmd => cmd.toLowerCase().includes(currentLine.toLowerCase()))
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
                    this.inputField.style.webkitTextFillColor = 'transparent';
                    this.inputField.focus();
                    this._updateInputSyntax();
                    this._hideSuggestions();
                    this._updateInputHeight();
                }
            };
            this.suggestionBox.appendChild(div);
        });
        
        this._applyBackgroundStyle(this.suggestionBox, this.style.inputBG);
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
      if (!raw) return { isGradient: false, color: '#FFFFFF', gradientCSS: '', colors: [] };
      if (/^linear-gradient\(/i.test(raw)) {
        const firstMatch = raw.match(/rgba?\([^\)]+\)|#[0-9A-Fa-f]+|[a-zA-Z\-]+/);
        return { isGradient: true, color: firstMatch ? firstMatch[0] : '#FFFFFF', gradientCSS: raw, colors: [], angle: 180 };
      }
      const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length <= 1) return { isGradient: false, color: parts[0] || '#FFFFFF', gradientCSS: '', colors: [parts[0] || '#FFFFFF'] };
      let angle = 180;
      let colors = parts.slice(0);
      const last = parts[parts.length - 1];
      if (/^-?\d+(\.\d+)?$/.test(last)) { angle = Number(last); colors = parts.slice(0, -1); }
      const gradientCSS = `linear-gradient(${angle}deg, ${colors.join(', ')})`;
      return { isGradient: true, color: colors[0] || '#FFFFFF', gradientCSS, colors, angle };
    }

    _firstColorFromRaw (raw) { try { return this._parseColorArg(raw).color || '#FFFFFF'; } catch (e) { return '#FFFFFF'; } }

    _updateBackgrounds (part, container, scroller) {
        if (!container) return;
        
        let color;
        
        if (part === 'console') {
            color = this.style.consoleBG;
        } else {
            color = this.style.inputBG;
        }
        
        container.style.background = 'transparent';
        if (scroller) scroller.style.background = 'transparent';
        
        if (part === 'console' && scroller) {
            container.style.background = 'transparent';
            this._applyBackgroundStyle(scroller, color);
        } else if (part === 'input') {
            this._applyBackgroundStyle(container, color);
            if (scroller) {
                this._applyBackgroundStyle(scroller, color);
            }
        } else {
            this._applyBackgroundStyle(container, color);
        }
    }

    _applyBackgroundStyle (el, colorRaw) {
      if (!el) return;
      const parsed = this._parseColorArg(colorRaw);
      const bgCSS = parsed.isGradient ? parsed.gradientCSS : (parsed.color || 'transparent');
      
      if (parsed.isGradient) {
          el.style.background = bgCSS;
      } else {
          el.style.background = 'none';
          el.style.backgroundColor = bgCSS;
      }
    }

    _applyInputTextColor (rawColor) {
      if (!this.inputField) return;
      
      if (this.style.textStyle === 'javascript') {
          this.inputField.style.caretColor = '#FFFFFF'; 
          
          if (this.inputHighlight) {
             this.inputHighlight.style.color = '#FFFFFF'; 
             this.inputHighlight.style.background = 'none'; 
             this.inputHighlight.style.webkitTextFillColor = '';
          }
          return;
      }

      const parsedText = this._parseColorArg(rawColor);
      const textColor = parsedText.color || '#FFFFFF';
      this.inputField.style.caretColor = textColor;
      
      if (this.inputHighlight) {
          if (parsedText.isGradient && parsedText.gradientCSS && this._supportsBackgroundClipText) {
            this.inputHighlight.style.background = parsedText.gradientCSS;
            this.inputHighlight.style.webkitBackgroundClip = 'text';
            this.inputHighlight.style.backgroundClip = 'text';
            this.inputHighlight.style.webkitTextFillColor = 'transparent';
            this.inputHighlight.style.color = 'transparent';
          } else {
            this.inputHighlight.style.background = 'none';
            this.inputHighlight.style.webkitBackgroundClip = '';
            this.inputHighlight.style.backgroundClip = '';
            this.inputHighlight.style.webkitTextFillColor = '';
            this.inputHighlight.style.color = textColor;
          }
      }
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
          el.textContent = `.console-input::placeholder { color: ${placeholderSolid} !important; opacity: 1 !important; }` + 
                           `.console-input::placeholder { background-image: ${parsed.gradientCSS}; -webkit-background-clip: text; background-clip: text; color: transparent !important; }`;
        } else {
          el.textContent = `.console-input::placeholder { color: ${placeholderSolid} !important; opacity: 1 !important; }`;
        }
        this._placeholderStyleEl = el;
      } catch (e) {}
    }

    // ---- DOM Element Creation & Styling ----
    _createLineElement (entry) {
      if (entry.type === 'spacing') {
        const spacer = document.createElement('div');
        spacer.className = 'console-spacing';
        spacer.style.marginTop = `${Math.max(0, Number(entry.spacingHeight) || 0)}px`;
        spacer.dataset.id = String(entry.id);
        return spacer;
      }

      const container = document.createElement('div');
      container.className = 'console-line';
      // Initial spacing, will be overridden by dynamic resize for accuracy
      const currentSpacing = this.style.consoleLineSpacing || 1.0;
      container.style.lineHeight = String(currentSpacing);

      if (this.style.consoleWrapping === 'scroll') {
        container.style.whiteSpace = 'pre';
        container.style.wordBreak = 'normal';
      } else {
        container.style.whiteSpace = 'pre-wrap';
        container.style.wordBreak = 'break-word';
      }

      container.dataset.id = String(entry.id);
      container.dataset.ts = String(entry.ts || Date.now());

      const tsSpan = document.createElement('span');
      tsSpan.className = 'console-timestamp';
      this._applyInlineTextColor(tsSpan, this.style.timestampTextRaw || this._defaults.timestampTextRaw);

      const formatted = (this._timestampFormat === 'off') ? '' : this._formatTimestamp(Number(container.dataset.ts));
      tsSpan.textContent = formatted ? `[${formatted}] ` : '';
      container.appendChild(tsSpan);

      if (entry.type === 'image') {
        const img = document.createElement('img');
        img.className = 'console-img';
        img.src = entry.src || '';
        img.referrerPolicy = 'no-referrer'; 
        
        const valW = Number(entry.width) || 0;
        const valH = Number(entry.height) || 0;
        const roundness = Number(entry.roundness) || 4;

        if (valW === 0 && valH === 0) {
          img.style.width = 'auto'; 
          img.style.maxWidth = '100%';
          img.style.height = 'auto';
        } else if (valW === 0) {
          img.style.height = `${valH}px`;
          img.style.width = 'auto';
        } else if (valH === 0) {
          img.style.width = `${valW}px`;
          img.style.height = 'auto';
        } else {
          img.style.width = `${valW}px`;
          img.style.height = `${valH}px`;
        }
        
        img.style.borderRadius = `${Math.max(0, roundness)}px`;
        img.style.display = 'block'; 

        img.onload = () => {
          if (this._autoScrollEnabled && this.logArea) {
            this._instantScrollToBottom();
          }
        };

        container.appendChild(img);
      } else {
        // --- TEXT RENDERING LOGIC ---
        if (this.style.textStyle === 'javascript') {
            this._renderJavascriptSyntax(container, entry.text, this.style.fontText);
        } else {
            const parsed = this._parseColorArg(entry.colorRaw || '#FFFFFF');
            if (this.style.gradientMode === 'split' && parsed.isGradient) {
                this._renderSplitGradient(container, entry.text, parsed, this.style.fontText);
            } else {
                const msgSpan = document.createElement('span');
                msgSpan.textContent = entry.text;
                msgSpan.style.fontFamily = this.style.fontText; 
                msgSpan.style.display = 'inline';
                this._applyInlineTextColor(msgSpan, entry.colorRaw || '#FFFFFF');
                container.appendChild(msgSpan);
            }
        }
      }

      this._applyLineStyle(container, entry);

      return container;
    }

    // --- Helper: Javascript Syntax Highlighting ---
    _renderJavascriptSyntax(container, text, font) {
        const tokenRegex = /(\/\/.*)|(".*?")|('.*?')|(`.*?`)|(\b(const|let|var|if|else|function|return|true|false|null|undefined|class|new|this|await|async|try|catch|while|for|switch|case|break|continue)\b)|(\b\d+\b)/g;

        let lastIndex = 0;
        let match;
        let html = '';
        
        const escapeHTML = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        container.style.fontFamily = font;

        while ((match = tokenRegex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                html += escapeHTML(text.substring(lastIndex, match.index));
            }

            const val = escapeHTML(match[0]);
            let cls = '';
            
            if (match[1]) cls = 'console-syntax-comment';
            else if (match[2] || match[3] || match[4]) cls = 'console-syntax-string';
            else if (match[5]) cls = 'console-syntax-keyword';
            else if (match[7]) cls = 'console-syntax-number';
            
            if (cls) html += `<span class="${cls}">${val}</span>`;
            else html += val;

            lastIndex = tokenRegex.lastIndex;
        }

        if (lastIndex < text.length) {
            html += escapeHTML(text.substring(lastIndex));
        }
        
        container.innerHTML = html;
        if (text.endsWith('\n')) {
             container.appendChild(document.createTextNode('\u200B'));
        }
    }

    // --- Helper: Split Gradient per Letter ---
    _renderSplitGradient(container, text, parsedColor, font) {
        const getRGB = (c) => {
            const d = document.createElement('div');
            d.style.color = c;
            document.body.appendChild(d);
            const col = window.getComputedStyle(d).color;
            document.body.removeChild(d);
            const m = col.match(/\d+/g);
            return m ? m.map(Number) : [255, 255, 255];
        }
        
        const colors = parsedColor.colors.length > 0 ? parsedColor.colors : [parsedColor.color];
        const rgbStops = colors.map(getRGB);
        
        const chars = text.split('');
        const len = chars.length;
        
        chars.forEach((char, i) => {
            const span = document.createElement('span');
            span.textContent = char;
            span.style.fontFamily = font;
            
            if (len <= 1 || rgbStops.length <= 1) {
                span.style.color = colors[0];
            } else {
                const t = i / (len - 1);
                const segmentCount = rgbStops.length - 1;
                const segmentPos = t * segmentCount;
                const index = Math.floor(segmentPos);
                const localT = segmentPos - index;
                
                const c1 = rgbStops[Math.min(index, segmentCount)];
                const c2 = rgbStops[Math.min(index + 1, segmentCount)];
                
                const r = Math.round(c1[0] + (c2[0] - c1[0]) * localT);
                const g = Math.round(c1[1] + (c2[1] - c1[1]) * localT);
                const b = Math.round(c1[2] + (c2[2] - c1[2]) * localT);
                
                span.style.color = `rgb(${r},${g},${b})`;
            }
            container.appendChild(span);
        });
    }

    _applyLineStyle (el, entry) {
      if (!el) return;
      el.style.textAlign = entry.customAlign ? entry.customAlign : this.style.textAlign;
      const msgSpans = Array.from(el.children).filter(c => !c.classList.contains('console-timestamp'));
      if (entry.customFont) {
          msgSpans.forEach(s => s.style.fontFamily = entry.customFont);
      }
      if (entry.customSize) {
        el.dataset.sizeMult = String(entry.customSize);
      } else {
        delete el.dataset.sizeMult;
      }
    }

    _applyWrappingStyle (el, mode) {
      if (!el) return;
      if (mode === 'scroll') {
        el.style.whiteSpace = 'pre';
        el.style.wordBreak = 'normal';
      } else { 
        el.style.whiteSpace = 'pre-wrap';
        el.style.wordBreak = 'break-word';
      }
    }

    _applyConsoleWrappingToContainer (el, mode) {
      if (!el) return;
      if (mode === 'scroll') {
        el.style.overflowX = 'auto';
      } else { 
        el.style.overflowX = 'hidden';
      }
    }

    _applyInlineTextColor (el, colorRaw) {
      if (!el) return;
      const parsed = this._parseColorArg(colorRaw || '#FFFFFF');
      if (parsed.isGradient && parsed.gradientCSS && this._supportsBackgroundClipText) {
        el.style.backgroundImage = parsed.gradientCSS;
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
        if (entry.type !== 'spacing') {
          try { this._io.observe(el); } catch (e) {}
        }
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

      if (this._timestampFormat === 'relative' && this._io) this._observeAllLines();
      this._resizeDynamicSizes();

      if (wasAtBottom) {
        this.logArea.scrollTop = this.logArea.scrollHeight;
        this._scrollCache = this.logArea.scrollTop;
      } else {
        const newMax = this.logArea.scrollHeight || 0;
        const clamped = Math.min(Math.max(0, prevScroll), Math.max(0, newMax - this.logArea.clientHeight));
        this.logArea.scrollTop = clamped;
        this._scrollCache = clamped;
      }
    }

    // ---- logging & message methods ----
    _log (text, color, type = 'text', entryOverride = {}) {
      if (!text && type === 'text') return; 

      const entry = Object.assign({
        id: this._nextId++,
        type: type,
        ts: Date.now(),
        text: String(text),
        colorRaw: String(color || '#FFFFFF')
      }, entryOverride);

      this._consoleCache.push(entry);
      if (this._dotsInterval) this._stopDots();
      this._addLineToDOM(entry);

      if (type === 'image' && (entry.width > 0 || entry.height > 0)) {
        this._addSpacing(10, true);
      }
    }

    logMessage (args) { this._log(args.TEXT, args.COLOR); }
    
    logImage (args) {
      this._log('', null, 'image', {
        src: String(args.SRC || ''),
        width: Number(args.W) || 0,
        height: Number(args.H) || 0,
        roundness: Number(args.R) || 4,
        colorRaw: String('#FFFFFF')
      });
    }

    // --- Dots animation ---
    _dotsInterval = null;
    logDots (args) {
      const text = '...';
      const color = args.COLOR || '#FFFFFF'; 
      
      const lastEntry = this._consoleCache[this._consoleCache.length - 1];

      if (lastEntry && lastEntry.type === 'dots') {
        lastEntry.ts = Date.now();
        lastEntry.colorRaw = color; 
        if (this.logArea) {
          const el = this.logArea.querySelector(`[data-id="${lastEntry.id}"]`);
          if (el) {
             el.dataset.ts = String(lastEntry.ts);
             const msgSpan = el.querySelectorAll('span')[1];
             if(msgSpan) this._applyInlineTextColor(msgSpan, color);
          }
        }
      } else {
        this._log(text, color, 'dots');
      }

      if (this._dotsInterval) return;

      this._dotsInterval = setInterval(() => {
        const dotsEntry = this._consoleCache.find(e => e.type === 'dots');
        if (!dotsEntry) {
          this._stopDots();
          return;
        }

        const maxDots = 3;
        let currentDots = (dotsEntry.text.match(/\./g) || []).length;
        currentDots = (currentDots % maxDots) + 1;
        
        dotsEntry.text = '.'.repeat(currentDots);
        
        if (this.logArea) {
          const el = this.logArea.querySelector(`[data-id="${dotsEntry.id}"]`);
          if (el) {
            const msgSpan = el.querySelectorAll('span')[1];
            if (msgSpan) msgSpan.textContent = dotsEntry.text;
          }
        }
      }, 500);
    }
    
    _stopDots () {
      if (this._dotsInterval) clearInterval(this._dotsInterval);
      this._dotsInterval = null;

      const idx = this._consoleCache.findIndex(e => e.type === 'dots');
      if (idx !== -1) {
        this.removeLine({ INDEX: this._getVisualIndex(idx) });
      }
    }

    removeLine (args) {
      const visibleIndex = Math.floor(Number(args.INDEX) || 1);
      const idx = this._getRealIndex(visibleIndex);
      if (idx === -1) return;

      if (this.logArea) {
        const prevScroll = this.logArea.scrollTop || 0;
        const entry = this._consoleCache[idx];
        const el = this.logArea.querySelector(`[data-id="${entry.id}"]`);

        if (el) {
          if (this._io) try { this._io.unobserve(el); } catch (e) {}
          this._visibleSet.delete(el);
          el.remove();
        }
        
        if (this._consoleCache[idx+1] && this._consoleCache[idx+1].type === 'spacing' && this._consoleCache[idx+1].isAutoSpacing) {
           const spacingEntry = this._consoleCache[idx+1];
           const spacingEl = this.logArea.querySelector(`[data-id="${spacingEntry.id}"]`);
           if (spacingEl) spacingEl.remove();
           this._consoleCache.splice(idx+1, 1);
        }
        
        this._consoleCache.splice(idx, 1);
        
        if (this.logArea.scrollHeight) this.logArea.scrollTop = prevScroll; 
      } else {
        if (this._consoleCache[idx+1] && this._consoleCache[idx+1].type === 'spacing' && this._consoleCache[idx+1].isAutoSpacing) {
            this._consoleCache.splice(idx+1, 1);
        }
        this._consoleCache.splice(idx, 1);
      }
    }

    _getVisualIndex(cacheIndex) {
        let count = 0;
        for (let i = 0; i <= cacheIndex; i++) {
            if (this._consoleCache[i].type !== 'spacing') {
                count++;
            }
        }
        return count;
    }

    _addSpacing (h, isAuto = false) {
      const lastEntry = this._consoleCache[this._consoleCache.length - 1];
      if (lastEntry && lastEntry.type === 'spacing' && lastEntry.isAutoSpacing) {
        lastEntry.spacingHeight = h; 
        if (this.logArea) {
            const el = this.logArea.querySelector(`[data-id="${lastEntry.id}"]`);
            if (el) el.style.marginTop = `${h}px`;
        }
        return;
      }
      if (h === 0) return; 
      const entry = { id: this._nextId++, type: 'spacing', spacingHeight: h, isAutoSpacing: isAuto };
      this._consoleCache.push(entry);
      if (this._dotsInterval) this._stopDots();
      this._addLineToDOM(entry);
    }

    _getRealIndex(visualIndex) {
      let count = 0;
      for (let i = 0; i < this._consoleCache.length; i++) {
        if (this._consoleCache[i].type !== 'spacing') {
          count++;
          if (count === visualIndex) return i;
        }
      }
      return -1;
    }

    styleLine (args) {
      const visibleIndex = Math.floor(Number(args.INDEX) || 1);
      const idx = this._getRealIndex(visibleIndex);
      if (idx === -1) return;

      const entry = this._consoleCache[idx];
      entry.customFont = String(args.FONT || '');
      entry.customSize = Number(args.SIZE) || 1;
      entry.customAlign = String(args.ALIGN || '').toLowerCase();

      if (this.logArea) {
        const el = this.logArea.querySelector(`[data-id="${entry.id}"]`);
        if (el) {
          this._applyLineStyle(el, entry);
          this._resizeDynamicSizes();
        }
      }
    }

    resetLineStyle (args) {
      const visibleIndex = Math.floor(Number(args.INDEX) || 1);
      const idx = this._getRealIndex(visibleIndex);
      if (idx === -1) return;

      const entry = this._consoleCache[idx];
      delete entry.customFont;
      delete entry.customSize;
      delete entry.customAlign;

      if (this.logArea) {
        const el = this.logArea.querySelector(`[data-id="${entry.id}"]`);
        if (el) {
          this._applyLineStyle(el, entry);
          this._resizeDynamicSizes();
        }
      }
    }

    getConsoleAsArray () {
      try {
        const savable = this._consoleCache.filter(e => !e.isAutoSpacing);
        return JSON.stringify(savable);
      } catch (e) { return '[]'; }
    }

    setConsoleFromArray (args) {
      try {
        const arr = JSON.parse(String(args.ARRAY || '[]'));
        if (!Array.isArray(arr)) return;

        this._consoleCache = [];
        this._nextId = 1;
        
        for (const e of arr) {
          const base = {
            id: this._nextId++, 
            type: e.type || 'text',
            ts: e.ts ? Number(e.ts) : Date.now(),
          };

          if (base.type === 'spacing') {
            this._consoleCache.push(Object.assign(base, {
              spacingHeight: Number(e.spacingHeight) || 0,
              isAutoSpacing: false 
            }));
          } else {
            const entry = Object.assign(base, {
              text: String(e.text || ''),
              src: e.src,
              width: e.width,
              height: e.height,
              roundness: e.roundness,
              colorRaw: String(e.colorRaw || '#FFFFFF'),
              customFont: e.customFont,
              customSize: e.customSize,
              customAlign: e.customAlign
            });
            this._consoleCache.push(entry);

            if (entry.type === 'image' && (entry.width > 0 || entry.height > 0)) {
                this._consoleCache.push({ id: this._nextId++, type: 'spacing', spacingHeight: 10, isAutoSpacing: true });
            }
          }
        }
        if (this._dotsInterval) this._stopDots();
        this._restoreConsoleCache();
      } catch (e) {}
    }

    getConsoleLineCount () { 
      return this._consoleCache.filter(e => e.type !== 'spacing').length;
    }

    isConsoleShown () { return !!this.consoleVisible; }
    
    setSelectable (args) {
        this.textSelectable = !!args.ENABLED;
        if (this.consoleOverlay) {
            this.consoleOverlay.style.userSelect = this.textSelectable ? 'text' : 'none';
        }
    }

    // ---- timestamp management ----
    setTimestampFormat (args) {
      const format = String(args.FORMAT || 'off').toLowerCase();
      const valid = ['off', '24h', '12h', 'relative'];
      this._timestampFormat = valid.includes(format) ? format : 'off';
      
      this._disconnectObserverAndLoop();

      if (this._timestampFormat === 'relative') {
        this._setupObserverForRelative();
      } 
      this._refreshTimestamps();
      this._resizeDynamicSizes(); 
    }

    _formatTimestamp (ms) {
      if (this._timestampFormat === 'relative') {
        const s = Math.floor((Date.now() - ms) / 1000);
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
      const d = new Date(ms);
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
        if (c.classList.contains('console-spacing')) continue;
        const ts = Number(c.dataset.ts || 0);
        const formatted = (this._timestampFormat === 'off') ? '' : this._formatTimestamp(ts);
        const spans = c.querySelectorAll('span');
        if (spans[0] && spans[0].classList.contains('console-timestamp')) spans[0].textContent = formatted ? `[${formatted}] ` : '';
      }
    }

    _updateTimestampForElement (el) {
        if (this._timestampFormat !== 'relative' || !el || !el.dataset.ts) return;
        const ts = Number(el.dataset.ts);
        const formatted = this._formatTimestamp(ts);
        const spans = el.querySelectorAll('span');
        if (spans[0] && spans[0].classList.contains('console-timestamp')) spans[0].textContent = formatted ? `[${formatted}] ` : '';
    }

    _observeAllLines () {
      if (!this._io || !this.logArea) return;
      for (const c of Array.from(this.logArea.children)) {
        if (c.classList.contains('console-spacing')) continue;
        try { this._io.observe(c); } catch (e) {}
      }
    }

    _setupObserverForRelative () {
      this._disconnectObserverAndLoop();
      if (!this.logArea) return;

      const callback = (entries) => {
        for (const entry of entries) {
          const el = entry.target;
          if (entry.isIntersecting) {
            this._visibleSet.add(el);
            this._updateTimestampForElement(el);
          } else {
            this._visibleSet.delete(el);
          }
        }
      };

      try {
        const options = Object.assign({}, this._ioOptions, { root: this.logArea });
        this._io = new IntersectionObserver(callback, options);
        this._observeAllLines();
        this._startVisibleUpdateLoop();
      } catch (e) {
        this._io = null;
        if (this.logArea) this.logArea.addEventListener('scroll', () => this._updateVisibleLinesNow(), { passive: true });
        this._startVisibleUpdateLoop();
      }
    }

    _disconnectObserverAndLoop () {
      if (this._io) { try { this._io.disconnect(); } catch (e) {} }
      this._io = null;
      this._stopVisibleUpdateLoop();
      this._visibleSet.clear();
    }

    _startVisibleUpdateLoop () {
      if (this._visibleUpdateInterval) return;
      this._visibleUpdateInterval = setInterval(() => {
        if (this._timestampFormat === 'relative') {
          for (const el of this._visibleSet) this._updateTimestampForElement(el);
        } else {
          this._stopVisibleUpdateLoop();
        }
      }, this._visibleIntervalMs);
    }

    _stopVisibleUpdateLoop () {
      if (this._visibleUpdateInterval) {
        clearInterval(this._visibleUpdateInterval);
        this._visibleUpdateInterval = null;
      }
    }

    _updateVisibleLinesNow () {
      if (!this.logArea) return;
      const areaRect = this.logArea.getBoundingClientRect();
      for (const c of Array.from(this.logArea.children)) {
        if (c.classList.contains('console-spacing')) continue;
        try {
          const r = c.getBoundingClientRect();
          const intersects = !(r.bottom < areaRect.top || r.top > areaRect.bottom);
          if (intersects) {
            if (this._io) {
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

    // ---- styling blocks & helpers ----
    setColorPicker (args) {
      const part = String(args.PART || '').toLowerCase();
      const colorArg = String(args.COLOR || '').trim();
      const parsed = this._parseColorArg(colorArg);

      if (part.includes('console background')) {
        this.style.consoleBG = parsed.isGradient ? parsed.gradientCSS : parsed.color;
        if (this.consoleOverlay) this._updateBackgrounds('console', this.consoleOverlay, this.logArea);
      } else if (part.includes('input background')) {
        this.style.inputBG = parsed.isGradient ? parsed.gradientCSS : parsed.color;
        if (this.inputWrapper) this._updateBackgrounds('input', this.inputWrapper, this.inputField);
        if (this.suggestionBox) this._applyBackgroundStyle(this.suggestionBox, this.style.inputBG);
      } else if (part.includes('input text')) {
        this.style.inputTextRaw = colorArg || parsed.color;
        this._applyInputTextColor(this.style.inputTextRaw);
      } else if (part.includes('timestamp text')) {
        this.style.timestampTextRaw = colorArg || parsed.color;
        if (this.logArea) {
          for (const ch of Array.from(this.logArea.children)) {
            if (ch.classList.contains('console-spacing')) continue;
            const tsSpan = ch.querySelector('.console-timestamp');
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
      const font = String(args.FONT || 'Sans Serif');
      
      if (part === 'text') this.style.fontText = font;
      else if (part === 'timestamp') this.style.fontTimestamp = font;
      else if (part === 'input') this.style.fontInput = font;

      if (this.logArea) {
        for (const ch of Array.from(this.logArea.children)) {
          if (ch.classList.contains('console-spacing')) continue;
          const tsSpan = ch.querySelector('.console-timestamp');
          const msgSpans = Array.from(ch.children).filter(c => !c.classList.contains('console-timestamp'));
          const entry = this._consoleCache.find(e => String(e.id) === ch.dataset.id);
          
          if (part === 'timestamp' && tsSpan) tsSpan.style.fontFamily = this.style.fontTimestamp;
          if (part === 'text') {
            if (!entry || !entry.customFont) msgSpans.forEach(s => s.style.fontFamily = this.style.fontText);
          }
        }
      }

      if (part === 'input') this._resizeDynamicSizes();
      if (this.suggestionBox && part === 'input') this.suggestionBox.style.fontFamily = this.style.fontInput;
    }

    setTextSizeMultiplier (args) {
      const part = String(args.PART || 'text').toLowerCase();
      const m = Number(args.MULTIPLIER) || 1;
      
      if (part === 'text') this.style.sizeText = Math.max(0.01, m);
      else if (part === 'timestamp') this.style.sizeTimestamp = Math.max(0.01, m);
      else if (part === 'input') this.style.sizeInput = Math.max(0.01, m);

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
          if (ch.classList.contains('console-spacing')) continue;
          const entry = this._consoleCache.find(e => String(e.id) === ch.dataset.id);
          if (!entry || !entry.customAlign) ch.style.textAlign = this.style.textAlign;
        }
      }

      if (this.inputField && part === 'input') {
          this.inputField.style.textAlign = this.style.inputAlign;
          if (this.inputHighlight) this.inputHighlight.style.textAlign = this.style.inputAlign;
      }
    }

    setLineSpacing (args) {
      const part = String(args.PART || 'console').toLowerCase();
      const val = Number(args.SPACING);
      
      if (part === 'input') {
          this.style.inputLineSpacing = val;
      } else {
          this.style.consoleLineSpacing = val;
      }
      this._resizeDynamicSizes(); 
    }

    // --- setPadding function ---
    setPadding(args) {
        const part = String(args.PART || 'console').toLowerCase();
        const padding = Math.max(0, Number(args.PADDING) || 0);

        if (part === 'console') {
            this.style.consolePadding = padding;
            if (this.logArea) {
                this.logArea.style.padding = `${padding}px`;
            }
        } else if (part === 'input') {
            this.style.inputPadding = padding;
            if (this.inputWrapper) {
                this.inputWrapper.style.padding = `${padding}px`;
            }
            if (this.inputHighlight) {
                const p = `${padding}px`;
                this.inputHighlight.style.top = p;
                this.inputHighlight.style.left = p;
                this.inputHighlight.style.right = p;
                this.inputHighlight.style.bottom = p;
            }
            this._updateInputHeight(); // Padding affects height
        }
    }

    setInputPlaceholder (args) {
      const txt = String(args.TEXT || '');
      this.style.inputPlaceholder = txt;
      if (this.inputField) this.inputField.placeholder = this.style.inputPlaceholder;
    }

    setInputHeightRange (args) {
      this.style.minInputHeightPct = Math.max(0, Math.min(100, Number(args.MIN) || 10));
      this.style.maxInputHeightPct = Math.max(this.style.minInputHeightPct, Math.min(100, Number(args.MAX) || 40));
      this._updateInputHeight();
    }

    setTextWrapping (args) {
      const part = String(args.PART || 'console').toLowerCase();
      const mode = String(args.MODE || 'wrap').toLowerCase() === 'scroll' ? 'scroll' : 'wrap';

      if (part === 'console') {
        this.style.consoleWrapping = mode;
        if (this.logArea) {
          this._applyConsoleWrappingToContainer(this.logArea, mode); 
          for (const line of Array.from(this.logArea.children)) {
            if (line.classList.contains('console-line')) {
              if (mode === 'scroll') {
                line.style.whiteSpace = 'pre';
                line.style.wordBreak = 'normal';
              } else {
                line.style.whiteSpace = 'pre-wrap';
                line.style.wordBreak = 'break-word';
              }
            }
          }
        }
      } else if (part === 'input') {
        this.style.inputWrapping = mode;
        if (this.inputField) {
          this._applyWrappingStyle(this.inputField, mode);
          if (this.inputHighlight) this._applyWrappingStyle(this.inputHighlight, mode);
          this._updateInputHeight(); 
        }
      }
    }

    setTextStyle(args) {
        const style = String(args.STYLE || 'default').toLowerCase();
        this.style.textStyle = (style === 'javascript') ? 'javascript' : 'default';
        this._restoreConsoleCache(); // For Console
        this._updateInputSyntax(); // For Input
        this._applyInputTextColor(this.style.inputTextRaw); // Refreshes color logic
    }

    setGradientMode(args) {
        const mode = String(args.MODE || 'normal').toLowerCase();
        this.style.gradientMode = (mode === 'split') ? 'split' : 'normal';
        this._restoreConsoleCache();
    }

    resetStyling () {
      this.style = Object.assign({}, this._defaults);
      this._disconnectObserverAndLoop(); 
      this._timestampFormat = 'off';
      this._refreshTimestamps();
      // --- Reset padding ---
      this.setPadding({ PART: 'console', PADDING: this._defaults.consolePadding });
      this.setPadding({ PART: 'input', PADDING: this._defaults.inputPadding });
      this.setInputPlaceholder({ TEXT: this.style.inputPlaceholder });
      this.setInputHeightRange({ MIN: this.style.minInputHeightPct, MAX: this.style.maxInputHeightPct });
      this.setTextWrapping({ PART: 'console', MODE: this.style.consoleWrapping });
      this.setTextWrapping({ PART: 'input', MODE: this.style.inputWrapping });
      this.setColorPicker({ PART: 'console background', COLOR: this.style.consoleBG });
      this.setColorPicker({ PART: 'input background', COLOR: this.style.inputBG });
      this.setColorPicker({ PART: 'input placeholder', COLOR: this.style.inputPlaceholderColorRaw });
      this.setColorPicker({ PART: 'input text', COLOR: this.style.inputTextRaw });
      
      this._autocorrectEnabled = false; 
      this.setAutocorrect({ ENABLED: false });
      this.setInputPosition({ POS: 'bottom' });
      this.setEnterBehavior({ BEHAVIOR: 'submit' });
      this.setTextStyle({ STYLE: 'default' });
      this.setGradientMode({ MODE: 'normal' });
      
      this._resizeDynamicSizes();
    }
    
    // ---- console management ----
    toggleConsole (args) {
      const action = String(args.ACTION || 'toggle').toLowerCase();
      if (action === 'show') this.showConsole();
      else if (action === 'hide') this.hideConsole();
      else this.consoleVisible ? this.hideConsole() : this.showConsole();
    }

    showConsole () {
      if (!this.consoleVisible) {
        this.consoleVisible = true;
        this._createConsole();
        this._restoreConsoleCache(); 
        if (this.inputVisible) { 
            this.hideInput();
            this.showInput();
        }
        this._resizeDynamicSizes();
        if (this.logArea) this.logArea.scrollTop = this.logArea.scrollHeight; 
      }
    }

    hideConsole () {
      if (this.consoleOverlay) {
        try { this.consoleOverlay.remove(); } catch (e) {}
        this.consoleOverlay = null;
        this.logArea = null;
      }
      this.consoleVisible = false;
      this._disconnectObserverAndLoop();
    }

    clearConsole () {
      if (this._dotsInterval) this._stopDots();
      this._consoleCache = [];
      this._nextId = 1;
      this._scrollCache = 0; 
      if (this.logArea) this.logArea.innerHTML = '';
      this._visibleSet.clear();
    }

    // ---- input management ----
    toggleInput (args) {
      const action = String(args.ACTION || 'toggle').toLowerCase();
      if (action === 'show') this.showInput();
      else if (action === 'hide') this.hideInput();
      else this.inputVisible ? this.hideInput() : this.showInput();
    }

    showInput () {
      if (!this.inputVisible) {
        this.inputVisible = true;
        this._createInput();
        if (this.inputField) {
            this.inputField.value = this._inputCache;
            this.inputField.focus(); 
            this._updateInputSyntax();
            this._updateInputHeight();
        }
        this._resizeDynamicSizes();
      }
    }

    hideInput () {
      let priorAtBottom = false;
      try { priorAtBottom = this.logArea && (this.logArea.scrollTop + this.logArea.clientHeight) >= (this.logArea.scrollHeight - 5); } catch (e) { priorAtBottom = false; }
      
      if (this.inputField) this._inputCache = this.inputField.value; 
      if (this.inputOverlay) {
          this.inputOverlay.remove();
          this.inputOverlay = null;
          this.inputField = null;
          this.inputHighlight = null;
          this.inputWrapper = null;
          this.suggestionBox = null;
      }
      
      this.inputVisible = false;
      this._activeSuggestions = []; 
      
      if (this.consoleOverlay) {
          this.consoleOverlay.style.paddingBottom = ''; 
          this.consoleOverlay.style.paddingTop = '';
      }
      
      if (this.logArea && priorAtBottom) this._instantScrollToBottom(); 
    }

    setInputText (args) {
      const v = String(args.DATA || '');
      this._inputCache = v;
      if (this.inputField) {
          this.inputField.value = v;
          if (v) {
              this.inputField.style.webkitTextFillColor = 'transparent';
          } else {
              this.inputField.style.webkitTextFillColor = 'inherit';
          }
          this._updateInputSyntax();
      }
      this._updateInputHeight();
    }

    runInput (args) {
      this._dispatchInput(String(args.TEXT ?? ''));
    }

    clearInput () {
      this._inputCache = '';
      if (this.inputField) {
          this.inputField.value = '';
          this.inputField.style.webkitTextFillColor = 'inherit';
          this._updateInputSyntax();
      }
      this._updateInputHeight();
    }

    setLogInput (args) {
      this.logInputEnabled = !!args.ENABLED;
    }

    getLastInput () { return this.lastInput || ''; }
    getCurrentInput () { return (this.inputField ? this.inputField.value : this._inputCache) || ''; }
    isInputShown () { return !!this.inputVisible; }

    setAutocorrect (args) {
        const enabled = !!args.ENABLED;
        this._autocorrectEnabled = enabled;
        if (this.inputField) {
            this.inputField.setAttribute('autocorrect', enabled ? 'on' : 'off');
            this.inputField.setAttribute('spellcheck', enabled ? 'true' : 'false');
        }
    }

    getSelectionPosition (args) {
        const source = String(args.SOURCE || 'current').toLowerCase();
        const position = String(args.POSITION || 'start').toLowerCase();

        let selectionObj = this._currentSelection;
        if (source === 'last') {
            selectionObj = this._lastSelection;
        } else if (this.inputField) {
            selectionObj = {
                start: this.inputField.selectionStart || 0,
                end: this.inputField.selectionEnd || 0
            };
        }

        if (position === 'start') return selectionObj.start;
        if (position === 'end') return selectionObj.end;
        return 0;
    }

    setInputPosition (args) {
        const pos = String(args.POS || 'bottom').toLowerCase();
        this.style.inputPosition = (pos === 'top') ? 'top' : 'bottom';
        
        if (this.inputVisible) {
            this.hideInput();
            this.showInput();
        }
    }

    setEnterBehavior (args) {
        const b = String(args.BEHAVIOR || 'submit').toLowerCase();
        const valid = ['submit', 'newline', 'disabled'];
        this.style.enterBehavior = valid.includes(b) ? b : 'submit';
    }

    _dispatchInput (text) {
      const txt = String(text ?? '');
      this.lastInput = txt;
      this._lastSelection = { ...this._currentSelection };
      
      if (this.logInputEnabled && txt.trim()) this._log('> ' + txt.trim(), '#FFFFFF');
      
      this._inputEventId = (this._inputEventId || 0) + 1;
      try {
        if (typeof vm !== 'undefined' && vm && vm.runtime && typeof vm.runtime.startHats === 'function') {
          vm.runtime.startHats(`${this.id}_whenInput`);
        }
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

    _getScrollTarget(targetString) {
        const target = String(targetString || 'console').toLowerCase();
        if (target === 'input') {
            return this.inputField;
        }
        return this.logArea;
    }

    // ---- scroll ---- 
    setScrollTo (args) {
        const targetEl = this._getScrollTarget(args.TARGET);
        const y = Number(args.Y || 0);
        
        if (targetEl) {
            const max = Math.max(0, targetEl.scrollHeight - targetEl.clientHeight);
            targetEl.scrollTop = Math.min(max, Math.max(0, y));
            
            if (targetEl === this.logArea) {
                 this._scrollCache = targetEl.scrollTop;
            }
        } else if (args.TARGET.toLowerCase() === 'console') {
            this._scrollCache = Math.max(0, y);
        }
    }

    getMaxScroll (args) {
        const targetEl = this._getScrollTarget(args.TARGET);
        if (targetEl) {
            return Math.max(0, targetEl.scrollHeight - targetEl.clientHeight);
        }
        return 0; 
    }

    getCurrentScroll (args) {
        const targetEl = this._getScrollTarget(args.TARGET);
        if (targetEl) {
            return targetEl.scrollTop;
        }
        if (args.TARGET.toLowerCase() === 'console') {
            return (this._scrollCache || 0);
        }
        return 0;
    }

    setAutoScroll (args) {
        this._autoScrollEnabled = !!args.ENABLED;
    }

    isAutoScroll () {
        return !!this._autoScrollEnabled;
    }

    _applyCachedScroll () { 
        if (!this.logArea) return; 
        const max = Math.max(0, this.logArea.scrollHeight - this.logArea.clientHeight); 
        this.logArea.scrollTop = Math.min(max, Math.max(0, this._scrollCache || 0)); 
    } 

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

        this.logArea.style.scrollBehavior = prevBehavior;
        this.logArea.style.overflowY = prevOverflow;

        if (hadObserver) try { this._observer.observe(this.stage); } catch (e) {}
        if (hadRecovery) this._startRecovery();
    }
  }

  try {
    const instance = new ConsoleExtension();
    if (Scratch && Scratch.extensions && typeof Scratch.extensions.register === 'function') {
      Scratch.extensions.register(instance);
    } else {
      window.__consoleExtensionInstance = instance;
      console.warn('[Console extension] instance available at window.__consoleExtensionInstance');
    }
  } catch (e) {
    console.error('Failed to register ConsoleExtension:', e);
  }
})(Scratch);
