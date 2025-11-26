(function(Scratch) {
    'use strict';

    if (!Scratch.extensions.unsandboxed) {
        throw new Error('Images Extension must run unsandboxed');
    }

    const vm = Scratch.vm;
    const renderer = vm.renderer;

    class ImagesExtension {
        constructor() {
            this.imageCache = new Map();
            // Reusable canvas to reduce GC pressure
            this._helperCanvas = document.createElement('canvas');
            this._helperCtx = this._helperCanvas.getContext('2d', { willReadFrequently: true });
        }

        getInfo() {
            return {
                id: 'imagesExtension',
                name: 'Images',
                color1: '#9966FF',
                color2: '#774DCB',
                blocks: [
                    {
                        opcode: 'showImage',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'show image [URL]',
                        arguments: {
                            URL: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'https://extensions.penguinmod.com/assets/img/extension.png'
                            }
                        }
                    },
                    {
                        opcode: 'resetImage',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'clear temporary image'
                    },
                    '---',
                    {
                        opcode: 'getCostumeDataUri',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'get image data from costume [COSTUME]',
                        arguments: {
                            COSTUME: {
                                type: Scratch.ArgumentType.STRING,
                                menu: 'COSTUMES'
                            }
                        }
                    },
                    {
                        opcode: 'createColorImage',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'create image width: [W] height: [H] color: [COLOR]',
                        arguments: {
                            W: { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 },
                            H: { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 },
                            COLOR: { type: Scratch.ArgumentType.COLOR, defaultValue: '#9966FF' }
                        }
                    },
                    {
                        opcode: 'createTextImage',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'create text image: [TEXT] size: [SIZE] font: [FONT] color: [COLOR]',
                        arguments: {
                            TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello World' },
                            SIZE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 48 },
                            FONT: { type: Scratch.ArgumentType.STRING, defaultValue: 'Sans Serif' },
                            COLOR: { type: Scratch.ArgumentType.COLOR, defaultValue: '#000000' }
                        }
                    },
                    '---',
                    {
                        opcode: 'flipImage',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'flip image [URL] [DIRECTION]',
                        arguments: {
                            URL: { type: Scratch.ArgumentType.STRING, defaultValue: '' },
                            DIRECTION: { type: Scratch.ArgumentType.STRING, menu: 'FLIP_DIR' }
                        }
                    },
                    {
                        opcode: 'invertImage',
                        blockType: Scratch.BlockType.REPORTER,
                        text: '[EFFECT_TYPE] of image [URL]',
                        arguments: {
                            EFFECT_TYPE: { type: Scratch.ArgumentType.STRING, menu: 'NON_NUMERIC_EFFECTS' },
                            URL: { type: Scratch.ArgumentType.STRING, defaultValue: '' }
                        }
                    },
                    {
                        opcode: 'tintImage',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'tint image [URL] with color [COLOR]',
                        arguments: {
                            URL: { type: Scratch.ArgumentType.STRING, defaultValue: '' },
                            COLOR: { type: Scratch.ArgumentType.COLOR, defaultValue: '#FF0000' }
                        }
                    },
                    {
                        opcode: 'applyEffect',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'apply [EFFECT] [VALUE] to image [URL]',
                        arguments: {
                            EFFECT: { type: Scratch.ArgumentType.STRING, menu: 'EFFECTS' },
                            VALUE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 50 },
                            URL: { type: Scratch.ArgumentType.STRING, defaultValue: '' }
                        }
                    }
                ],
                menus: {
                    COSTUMES: {
                        acceptReporters: true,
                        items: '_getCostumes'
                    },
                    FLIP_DIR: {
                        items: ['horizontally', 'vertically']
                    },
                    EFFECTS: {
                        items: ['color', 'brightness', 'ghost', 'blur', 'contrast', 'saturation']
                    },
                    NON_NUMERIC_EFFECTS: {
                        items: [
                            { text: 'invert colors', value: 'invert(1)' },
                            { text: 'grayscale', value: 'grayscale(1)' },
                            { text: 'sepia', value: 'sepia(1)' }
                        ]
                    }
                }
            };
        }

        _getCostumes() {
            const target = vm.runtime.getEditingTarget();
            if (!target) return [];
            return target.getCostumes().map(c => c.name);
        }

        _loadImage(url) {
            return new Promise((resolve) => {
                if (!url) return resolve(null);
                if (this.imageCache.has(url)) {
                    return resolve(this.imageCache.get(url));
                }
                const img = new Image();
                img.crossOrigin = 'Anonymous';
                img.onload = () => {
                    this.imageCache.set(url, img);
                    resolve(img);
                };
                img.onerror = () => {
                    resolve(null);
                };
                img.src = url;
            });
        }

        _patchTargetCostumeSwitch(target) {
            if (target._imagesExtensionPatch) return;
            target._imagesExtensionPatch = true;

            const originalSetCostume = target.setCostume;
            
            target.setCostume = function(index, ...args) {
                const currentCostumeIndex = this.currentCostume;
                if (this.sprite && this.sprite.costumes && this.sprite.costumes[currentCostumeIndex]) {
                    const currentCostume = this.sprite.costumes[currentCostumeIndex];
                    // Clean up temp skin before switching away
                    if (currentCostume && currentCostume._originalSkinId) {
                        if (currentCostume._tempSkinId) {
                            renderer.destroySkin(currentCostume._tempSkinId);
                        }
                        currentCostume.skinId = currentCostume._originalSkinId;
                        delete currentCostume._originalSkinId;
                        delete currentCostume._tempSkinId;
                    }
                }
                return originalSetCostume.call(this, index, ...args);
            };
        }

        async showImage(args, util) {
            const url = String(args.URL);
            
            const img = await this._loadImage(url);
            if (!img) return;

            const target = util.target;
            const costumeIndex = target.currentCostume;
            const costume = target.sprite.costumes[costumeIndex];
            if (!costume) return;

            this._patchTargetCostumeSwitch(target);

            // Prepare Helper Canvas
            const cvs = this._helperCanvas;
            cvs.width = img.width;
            cvs.height = img.height;
            const ctx = this._helperCtx;
            
            ctx.clearRect(0, 0, cvs.width, cvs.height);
            ctx.imageSmoothingEnabled = true; // Ensure quality
            ctx.drawImage(img, 0, 0);

            // Calculate rotation center (center of image)
            const rotationCenter = [img.width / 2, img.height / 2];

            // RENDERER LOGIC:
            // 1. If we already have a temporary bitmap skin, UPDATE it. (Fast, Smooth)
            // 2. If not, CREATE a new one and save the original skin ID.
            
            if (costume._tempSkinId) {
                // Update existing skin with new image data and rotation center
                renderer.updateBitmapSkin(costume._tempSkinId, cvs, 1, rotationCenter);
            } else {
                // First time using show image on this costume
                if (!costume._originalSkinId) {
                    costume._originalSkinId = costume.skinId;
                }
                
                // Create new Bitmap Skin
                const skinId = renderer.createBitmapSkin(cvs, 1, rotationCenter);
                costume._tempSkinId = skinId;
                costume.skinId = skinId;
            }

            // Sync sprite properties
            costume.rotationCenterX = rotationCenter[0];
            costume.rotationCenterY = rotationCenter[1];

            target.updateAllDrawableProperties();
            target.emit('TARGET_WAS_DRAGGED');
        }

        resetImage(args, util) {
            const target = util.target;
            const costumeIndex = target.currentCostume;
            const costume = target.sprite.costumes[costumeIndex];

            if (costume && costume._originalSkinId) {
                if (costume._tempSkinId) {
                    renderer.destroySkin(costume._tempSkinId);
                }
                costume.skinId = costume._originalSkinId;
                delete costume._originalSkinId;
                delete costume._tempSkinId;
                target.updateAllDrawableProperties();
            }
        }

        async getCostumeDataUri(args, util) {
            const costumeName = args.COSTUME;
            const target = util.target;
            const costume = target.getCostumes().find(c => c.name === costumeName);
            if (!costume) return '';
            
            const asset = costume.asset;

            // If it's SVG, we MUST rasterize it to canvas to get a PNG
            if (asset.assetType.contentType === 'image/svg+xml') {
                const svgUrl = asset.encodeDataURI();
                const img = await this._loadImage(svgUrl);
                if (!img) return '';

                this._helperCanvas.width = img.width;
                this._helperCanvas.height = img.height;
                const ctx = this._helperCtx;
                
                ctx.clearRect(0, 0, img.width, img.height);
                ctx.drawImage(img, 0, 0);
                
                return this._helperCanvas.toDataURL('image/png');
            } else {
                // If it's already a bitmap, ensure consistent PNG output via canvas
                const rawUrl = asset.encodeDataURI();
                const img = await this._loadImage(rawUrl);
                if (!img) return rawUrl; // Fallback

                this._helperCanvas.width = img.width;
                this._helperCanvas.height = img.height;
                this._helperCtx.clearRect(0, 0, img.width, img.height);
                this._helperCtx.drawImage(img, 0, 0);
                
                return this._helperCanvas.toDataURL('image/png');
            }
        }

        async _applyCanvasEffect(url, operationCallback) {
            const img = await this._loadImage(url);
            if (!img) return '';

            this._helperCanvas.width = img.width;
            this._helperCanvas.height = img.height;
            const ctx = this._helperCtx;
            ctx.clearRect(0, 0, img.width, img.height);
            
            operationCallback(ctx, img);

            return this._helperCanvas.toDataURL('image/png');
        }

        createTextImage(args) {
            const text = String(args.TEXT);
            const size = Number(args.SIZE) || 24;
            const fontName = String(args.FONT) || 'Sans Serif';
            const color = args.COLOR;

            const ctx = this._helperCtx;
            const fontString = `${size}px "${fontName}", sans-serif`;
            ctx.font = fontString;
            
            const metrics = ctx.measureText(text);
            const textWidth = metrics.width;
            
            const paddingX = size * 0.5; 
            const canvasWidth = Math.ceil(textWidth + paddingX);
            const canvasHeight = Math.ceil(size * 1.5);

            this._helperCanvas.width = canvasWidth;
            this._helperCanvas.height = canvasHeight;

            // Context resets on resize, set again
            ctx.font = fontString;
            ctx.fillStyle = color;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'center';

            ctx.fillText(text, canvasWidth / 2, canvasHeight / 2);

            return this._helperCanvas.toDataURL('image/png');
        }

        createColorImage(args) {
            const w = Math.max(1, Number(args.W));
            const h = Math.max(1, Number(args.H));
            const color = args.COLOR;

            this._helperCanvas.width = w;
            this._helperCanvas.height = h;
            const ctx = this._helperCtx;

            ctx.fillStyle = color;
            ctx.fillRect(0, 0, w, h);

            return this._helperCanvas.toDataURL('image/png');
        }

        flipImage(args) {
            const dir = args.DIRECTION;
            return this._applyCanvasEffect(args.URL, (ctx, img) => {
                ctx.save();
                if (dir === 'horizontally') {
                    ctx.translate(img.width, 0);
                    ctx.scale(-1, 1);
                } else {
                    ctx.translate(0, img.height);
                    ctx.scale(1, -1);
                }
                ctx.drawImage(img, 0, 0);
                ctx.restore();
            });
        }

        tintImage(args) {
            const color = args.COLOR;
            return this._applyCanvasEffect(args.URL, (ctx, img) => {
                // 1. Draw base image
                ctx.drawImage(img, 0, 0);

                // 2. Multiply blend mode for proper tinting
                ctx.globalCompositeOperation = 'multiply';
                ctx.fillStyle = color;
                ctx.fillRect(0, 0, img.width, img.height);

                // 3. Mask to original alpha
                ctx.globalCompositeOperation = 'destination-in';
                ctx.drawImage(img, 0, 0);
                
                // Reset
                ctx.globalCompositeOperation = 'source-over';
            });
        }

        invertImage(args) {
            const filterVal = args.EFFECT_TYPE;
            return this._applyCanvasEffect(args.URL, (ctx, img) => {
                ctx.save();
                ctx.filter = filterVal;
                ctx.drawImage(img, 0, 0);
                ctx.restore();
            });
        }

        applyEffect(args) {
            const effect = args.EFFECT;
            const value = Number(args.VALUE);
            
            let filterStr = 'none';
            switch (effect) {
                case 'color': filterStr = `hue-rotate(${(value * 3.6)}deg)`; break;
                case 'brightness': filterStr = `brightness(${100 + value}%)`; break;
                case 'ghost': filterStr = `opacity(${Math.max(0, 100 - value)}%)`; break;
                case 'blur': filterStr = `blur(${value / 5}px)`; break;
                case 'contrast': filterStr = `contrast(${100 + value}%)`; break;
                case 'saturation': filterStr = `saturate(${100 + value}%)`; break;
            }

            return this._applyCanvasEffect(args.URL, (ctx, img) => {
                ctx.save();
                ctx.filter = filterStr;
                ctx.drawImage(img, 0, 0);
                ctx.restore();
            });
        }
    }

    Scratch.extensions.register(new ImagesExtension());
})(Scratch);
