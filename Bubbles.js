(function(Scratch) {
    'use strict';

    if (!Scratch.extensions.unsandboxed) {
        throw new Error('This extension must run unsandboxed');
    }

    const vm = Scratch.vm;
    const renderer = vm.renderer;

    class BubblesExtension {
        constructor() {
            this.slices = {
                'Top Left': null,
                'Top': null,
                'Top Right': null,
                'Left': null,
                'Center': null,
                'Right': null,
                'Bottom Left': null,
                'Bottom': null,
                'Bottom Right': null
            };

            this.imageCache = new Map();
        }

        getInfo() {
            return {
                id: 'customCaptchaBubble',
                name: 'Bubbles',
                color1: '#9966FF',
                color2: '#774DCB',
                blocks: [
                    {
                        opcode: 'setSlice',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'set bubble slice [PART] to costume [COSTUME]',
                        arguments: {
                            PART: {
                                type: Scratch.ArgumentType.STRING,
                                menu: 'SLICE_PARTS',
                                defaultValue: 'Center'
                            },
                            COSTUME: {
                                type: Scratch.ArgumentType.STRING,
                                menu: 'COSTUMES',
                                defaultValue: 'costume1'
                            }
                        }
                    },
                    {
                        opcode: 'setSliceFromUrl',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'set bubble slice [PART] to image [URL]',
                        arguments: {
                            PART: {
                                type: Scratch.ArgumentType.STRING,
                                menu: 'SLICE_PARTS',
                                defaultValue: 'Center'
                            },
                            URL: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'data:image/png;base64,...'
                            }
                        }
                    },
                    {
                        opcode: 'resetSlices',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'reset all bubble slices'
                    },
                    '---',
                    {
                        opcode: 'createBubble',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'show bubble: text [TEXT] font [FONT] size [SIZE] corner size [C_SIZE] padding [PADDING] color [COLOR] bg [BG_COLOR]',
                        arguments: {
                            TEXT: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'Hello World'
                            },
                            FONT: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'Sans Serif'
                            },
                            SIZE: {
                                type: Scratch.ArgumentType.NUMBER,
                                defaultValue: 24
                            },
                            C_SIZE: {
                                type: Scratch.ArgumentType.NUMBER,
                                defaultValue: 0 // 0 means auto-detect from image size
                            },
                            PADDING: {
                                type: Scratch.ArgumentType.NUMBER,
                                defaultValue: 20
                            },
                            COLOR: {
                                type: Scratch.ArgumentType.COLOR,
                                defaultValue: '#000000'
                            },
                            BG_COLOR: {
                                type: Scratch.ArgumentType.COLOR,
                                defaultValue: '#ffffff'
                            }
                        }
                    },
                    {
                        opcode: 'getBubbleDataUri',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'get bubble data uri: text [TEXT] font [FONT] size [SIZE] corner size [C_SIZE] padding [PADDING] color [COLOR] bg [BG_COLOR]',
                        arguments: {
                            TEXT: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'Hello World'
                            },
                            FONT: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'Sans Serif'
                            },
                            SIZE: {
                                type: Scratch.ArgumentType.NUMBER,
                                defaultValue: 24
                            },
                            C_SIZE: {
                                type: Scratch.ArgumentType.NUMBER,
                                defaultValue: 0
                            },
                            PADDING: {
                                type: Scratch.ArgumentType.NUMBER,
                                defaultValue: 20
                            },
                            COLOR: {
                                type: Scratch.ArgumentType.COLOR,
                                defaultValue: '#000000'
                            },
                            BG_COLOR: {
                                type: Scratch.ArgumentType.COLOR,
                                defaultValue: '#ffffff'
                            }
                        }
                    }
                ],
                menus: {
                    SLICE_PARTS: {
                        acceptReporters: true,
                        items: [
                            'Top Left', 'Top', 'Top Right',
                            'Left', 'Center', 'Right',
                            'Bottom Left', 'Bottom', 'Bottom Right'
                        ]
                    },
                    COSTUMES: {
                        acceptReporters: true,
                        items: '_getCostumes'
                    }
                }
            };
        }

        _getCostumes() {
            const target = vm.runtime.getEditingTarget();
            if (!target) return [];
            return target.getCostumes().map(c => c.name);
        }

        resetSlices() {
            for (const key in this.slices) {
                this.slices[key] = null;
            }
            this.imageCache.clear();
        }

        setSlice(args) {
            this.slices[args.PART] = { type: 'costume', value: args.COSTUME };
            this.imageCache.delete(args.PART);
        }

        setSliceFromUrl(args) {
            this.slices[args.PART] = { type: 'url', value: args.URL };
            this.imageCache.delete(args.PART);
        }

        async _loadSliceImage(target, key) {
            const sliceData = this.slices[key];
            if (!sliceData) return null;

            if (this.imageCache.has(key)) {
                return this.imageCache.get(key);
            }

            let url = null;
            if (sliceData.type === 'costume') {
                const costume = target.getCostumes().find(c => c.name === sliceData.value);
                if (costume) {
                    url = await costume.asset.encodeDataURI();
                }
            } else if (sliceData.type === 'url') {
                url = sliceData.value;
            }

            if (!url) return null;

            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    this.imageCache.set(key, img);
                    resolve(img);
                };
                img.onerror = () => {
                    resolve(null);
                };
                img.src = url;
            });
        }

        async _generateBubbleCanvas(text, fontName, fontSize, cornerSize, padding, color, bgColor, target) {
            const sliceKeys = Object.keys(this.slices);
            const loadedImages = {};
            
            await Promise.all(sliceKeys.map(async (key) => {
                loadedImages[key] = await this._loadSliceImage(target, key);
            }));

            const hasImages = Object.values(loadedImages).some(img => img !== null);
            const fontString = `bold ${fontSize}px "${fontName}", sans-serif`;

            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.font = fontString;
            const metrics = tempCtx.measureText(text);
            
            const textWidth = Math.ceil(metrics.width);
            const textHeight = Math.ceil(fontSize); 

            if (!hasImages) {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                const boxW = textWidth + (padding * 2);
                const boxH = textHeight + (padding * 2);

                canvas.width = boxW;
                canvas.height = boxH;

                if (bgColor) {
                    ctx.fillStyle = bgColor;
                    ctx.fillRect(0, 0, boxW, boxH);
                }

                ctx.font = fontString;
                ctx.fillStyle = color;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(text, boxW / 2, boxH / 2);
                
                return canvas;
            }

            const getImageSize = (img, isWidth) => {
                if (!img) return 0;
                if (cornerSize > 0) return cornerSize;
                return isWidth ? img.width : img.height;
            };

            const iTL = loadedImages['Top Left'];
            const iT  = loadedImages['Top'];
            const iTR = loadedImages['Top Right'];
            const iL  = loadedImages['Left'];
            const iC  = loadedImages['Center'];
            const iR  = loadedImages['Right'];
            const iBL = loadedImages['Bottom Left'];
            const iB  = loadedImages['Bottom'];
            const iBR = loadedImages['Bottom Right'];

            const leftW   = Math.max(getImageSize(iTL, true), getImageSize(iBL, true), getImageSize(iL, true));
            const rightW  = Math.max(getImageSize(iTR, true), getImageSize(iBR, true), getImageSize(iR, true));
            const topH    = Math.max(getImageSize(iTL, false), getImageSize(iTR, false), getImageSize(iT, false));
            const bottomH = Math.max(getImageSize(iBL, false), getImageSize(iBR, false), getImageSize(iB, false));

            const contentW = textWidth + (padding * 2);
            const contentH = textHeight + (padding * 2);

            const finalW = Math.ceil(leftW + contentW + rightW);
            const finalH = Math.ceil(topH + contentH + bottomH);

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            canvas.width = finalW;
            canvas.height = finalH;
            
            ctx.clearRect(0, 0, finalW, finalH);
            ctx.imageSmoothingEnabled = false;

            const drawTinted = (img, x, y, w, h) => {
                if (!img) return;
                if (!bgColor || bgColor.toLowerCase() === '#ffffff') {
                    ctx.drawImage(img, 0, 0, img.width, img.height, x, y, w, h);
                    return;
                }
                const tCan = document.createElement('canvas');
                tCan.width = w;
                tCan.height = h;
                const tCtx = tCan.getContext('2d');
                tCtx.imageSmoothingEnabled = false;
                tCtx.drawImage(img, 0, 0, img.width, img.height, 0, 0, w, h);
                tCtx.globalCompositeOperation = 'source-in';
                tCtx.fillStyle = bgColor;
                tCtx.fillRect(0, 0, w, h);
                ctx.drawImage(tCan, x, y);
            };

            if (iC) drawTinted(iC, leftW, topH, contentW, contentH);
            else if (bgColor) {
                ctx.fillStyle = bgColor;
                ctx.fillRect(leftW, topH, contentW, contentH);
            }

            if (iT) drawTinted(iT, leftW, 0, contentW, topH);
            if (iB) drawTinted(iB, leftW, finalH - bottomH, contentW, bottomH);
            if (iL) drawTinted(iL, 0, topH, leftW, contentH);
            if (iR) drawTinted(iR, finalW - rightW, topH, rightW, contentH);

            if (iTL) drawTinted(iTL, 0, 0, leftW, topH);
            if (iTR) drawTinted(iTR, finalW - rightW, 0, rightW, topH);
            if (iBL) drawTinted(iBL, 0, finalH - bottomH, leftW, bottomH);
            if (iBR) drawTinted(iBR, finalW - rightW, finalH - bottomH, rightW, bottomH);

            ctx.fillStyle = color;
            ctx.font = fontString;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            const centerX = leftW + (contentW / 2);
            const centerY = topH + (contentH / 2) + 1; 

            ctx.fillText(text, centerX, centerY);

            return canvas;
        }

        _patchTargetCostumeSwitch(target) {
            // Safety check: If already patched, do not patch again to avoid recursion
            if (target._bubblePatchInstalled) return;
            target._bubblePatchInstalled = true;

            const originalSetCostume = target.setCostume;

            // Override setCostume
            target.setCostume = function(index, ...args) {
                // WRAPPED IN TRY/CATCH: 
                // This ensures that even if the bubble cleanup fails, 
                // the actual costume switch (originalSetCostume) STILL runs.
                try {
                    const currentCostumeIndex = this.currentCostume;
                    
                    // Ensure sprite and costumes exist before accessing
                    if (this.sprite && this.sprite.costumes && this.sprite.costumes[currentCostumeIndex]) {
                        const currentCostume = this.sprite.costumes[currentCostumeIndex];

                        if (currentCostume && currentCostume._originalSkinId) {
                            // It was a bubble! Revert it.
                            if (currentCostume._bubbleSkinId) {
                                // Use the globally captured 'renderer' or vm.renderer to be safe
                                vm.renderer.destroySkin(currentCostume._bubbleSkinId);
                            }
                            
                            // Restore the original skin ID
                            currentCostume.skinId = currentCostume._originalSkinId;
                            
                            // Cleanup properties
                            delete currentCostume._originalSkinId;
                            delete currentCostume._bubbleSkinId;
                        }
                    }
                } catch (e) {
                    console.warn('Bubbles Extension: Failed to cleanup bubble skin, but proceeding with costume switch.', e);
                }

                // Proceed with the actual switch
                return originalSetCostume.call(this, index, ...args);
            };
        }

        async createBubble(args, util) {
            const text = String(args.TEXT);
            const font = String(args.FONT);
            const size = Number(args.SIZE) || 24;
            const cornerSize = Number(args.C_SIZE) || 0;
            const padding = Number(args.PADDING) || 10;
            const color = args.COLOR;
            const bgColor = args.BG_COLOR;

            const canvas = await this._generateBubbleCanvas(text, font, size, cornerSize, padding, color, bgColor, util.target);
            
            const target = util.target;
            const costumeIndex = target.currentCostume;
            const costume = target.sprite.costumes[costumeIndex];
            
            if (!costume) return;

            this._patchTargetCostumeSwitch(target);

            if (costume._bubbleSkinId && costume._originalSkinId) {
                renderer.destroySkin(costume._bubbleSkinId);
            } else if (!costume._originalSkinId) {
                costume._originalSkinId = costume.skinId;
            }

            const bubbleSkinId = renderer.createBitmapSkin(canvas, 1);
            
            costume._bubbleSkinId = bubbleSkinId;
            costume.skinId = bubbleSkinId;
            
            target.updateAllDrawableProperties();
            target.emit('TARGET_WAS_DRAGGED');
        }

        async getBubbleDataUri(args, util) {
            const text = String(args.TEXT);
            const font = String(args.FONT);
            const size = Number(args.SIZE) || 24;
            const cornerSize = Number(args.C_SIZE) || 0;
            const padding = Number(args.PADDING) || 10;
            const color = args.COLOR;
            const bgColor = args.BG_COLOR;

            const canvas = await this._generateBubbleCanvas(text, font, size, cornerSize, padding, color, bgColor, util.target);
            return canvas.toDataURL();
        }
    }

    Scratch.extensions.register(new BubblesExtension());
})(Scratch);
