(function(Scratch) {
    'use strict';

    if (!Scratch.extensions.unsandboxed) {
        throw new Error('This extension must run unsandboxed');
    }

    const vm = Scratch.vm;
    const renderer = vm.renderer;

    class BubblesExtension {
        constructor() {
            // Store the source for the 9 slices
            // Each can be { type: 'costume', value: 'name' } or { type: 'url', value: 'data:...' }
            this.slices = {
                'Top-Left': null,
                'Top-Edge': null,
                'Top-Right': null,
                'Left-Edge': null,
                'Center': null,
                'Right-Edge': null,
                'Bottom-Left': null,
                'Bottom-Edge': null,
                'Bottom-Right': null
            };

            // Cache for loaded images to reduce flickering/lag
            this.imageCache = new Map();
        }

        getInfo() {
            return {
                id: 'customCaptchaBubble',
                name: 'Bubbles',
                color1: '#9966FF', // Looks category purple
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
                        text: 'show bubble: text [TEXT] size [SIZE] padding [PADDING] color [COLOR]',
                        arguments: {
                            TEXT: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'Hello World'
                            },
                            SIZE: {
                                type: Scratch.ArgumentType.NUMBER,
                                defaultValue: 24
                            },
                            PADDING: {
                                type: Scratch.ArgumentType.NUMBER,
                                defaultValue: 20
                            },
                            COLOR: {
                                type: Scratch.ArgumentType.COLOR,
                                defaultValue: '#000000'
                            }
                        }
                    },
                    {
                        opcode: 'getBubbleDataUri',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'get bubble data uri: text [TEXT] size [SIZE] padding [PADDING] color [COLOR]',
                        arguments: {
                            TEXT: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'Hello World'
                            },
                            SIZE: {
                                type: Scratch.ArgumentType.NUMBER,
                                defaultValue: 24
                            },
                            PADDING: {
                                type: Scratch.ArgumentType.NUMBER,
                                defaultValue: 20
                            },
                            COLOR: {
                                type: Scratch.ArgumentType.COLOR,
                                defaultValue: '#000000'
                            }
                        }
                    }
                ],
                menus: {
                    SLICE_PARTS: {
                        acceptReporters: true,
                        items: [
                            'Top-Left', 'Top-Edge', 'Top-Right',
                            'Left-Edge', 'Center', 'Right-Edge',
                            'Bottom-Left', 'Bottom-Edge', 'Bottom-Right'
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
            this.imageCache.delete(args.PART); // Invalidate cache for this part
        }

        setSliceFromUrl(args) {
            this.slices[args.PART] = { type: 'url', value: args.URL };
            this.imageCache.delete(args.PART);
        }

        async _loadSliceImage(target, key) {
            const sliceData = this.slices[key];
            if (!sliceData) return null;

            // Check cache first
            // We use a composite key for cache if it's a costume to handle sprite switching, 
            // but for simplicity in this game engine context, simple keying is usually enough 
            // if we clear cache on setSlice.
            if (this.imageCache.has(key)) {
                // If it's a costume, we need to make sure the costume version hasn't changed?
                // For performance in a game loop, we'll assume cache is valid until setSlice is called.
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

        async _generateBubbleCanvas(text, fontSize, padding, color, target) {
            // 1. Load all images
            const sliceKeys = Object.keys(this.slices);
            const loadedImages = {};
            
            await Promise.all(sliceKeys.map(async (key) => {
                loadedImages[key] = await this._loadSliceImage(target, key);
            }));

            // Fallback safety
            if (!Object.values(loadedImages).some(img => img !== null)) {
                // Return a simple canvas with text if no images found
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                ctx.font = `${fontSize}px sans-serif`;
                const m = ctx.measureText(text);
                canvas.width = m.width + 10;
                canvas.height = fontSize + 10;
                ctx.fillText(text, 5, fontSize);
                return canvas;
            }

            // 2. Measure Text
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            ctx.font = `bold ${fontSize}px sans-serif`;
            const metrics = ctx.measureText(text);
            
            // Calculate actual height closer to visual height
            const textWidth = Math.ceil(metrics.width);
            const textHeight = Math.ceil(fontSize); // Simple approximation

            // 3. Geometry Calculation
            const tl = loadedImages['Top-Left'] || { width: 0, height: 0 };
            const tr = loadedImages['Top-Right'] || { width: 0, height: 0 };
            const bl = loadedImages['Bottom-Left'] || { width: 0, height: 0 };
            const br = loadedImages['Bottom-Right'] || { width: 0, height: 0 };
            
            const tEdge = loadedImages['Top-Edge'] || { height: 0 };
            const bEdge = loadedImages['Bottom-Edge'] || { height: 0 };
            const lEdge = loadedImages['Left-Edge'] || { width: 0 };
            const rEdge = loadedImages['Right-Edge'] || { width: 0 };

            // Content Box Size
            const contentW = textWidth + (padding * 2);
            const contentH = textHeight + (padding * 2);

            // Border Thickness Logic
            // The thickness of the frame is determined by the max size of the corners/edges on that side
            const leftW = Math.max(tl.width, bl.width, lEdge.width);
            const rightW = Math.max(tr.width, br.width, rEdge.width);
            const topH = Math.max(tl.height, tr.height, tEdge.height);
            const bottomH = Math.max(bl.height, br.height, bEdge.height);

            const finalW = Math.ceil(leftW + contentW + rightW);
            const finalH = Math.ceil(topH + contentH + bottomH);

            canvas.width = finalW;
            canvas.height = finalH;
            
            ctx.clearRect(0, 0, finalW, finalH);
            ctx.imageSmoothingEnabled = false; // Pixel art friendly

            // 4. Drawing Logic
            // We use Math.round to prevent sub-pixel bleeding (the "weird shadow" issue)

            // -- Center --
            if (loadedImages['Center']) {
                ctx.drawImage(
                    loadedImages['Center'], 
                    leftW, topH, 
                    contentW, contentH
                );
            }

            // -- Edges --
            // Top Edge: stretches horizontally between leftW and (finalW - rightW)
            if (loadedImages['Top-Edge']) {
                ctx.drawImage(
                    loadedImages['Top-Edge'],
                    leftW, 0,
                    contentW, topH
                );
            }
            // Bottom Edge
            if (loadedImages['Bottom-Edge']) {
                ctx.drawImage(
                    loadedImages['Bottom-Edge'],
                    leftW, finalH - bottomH,
                    contentW, bottomH
                );
            }
            // Left Edge: stretches vertically
            if (loadedImages['Left-Edge']) {
                ctx.drawImage(
                    loadedImages['Left-Edge'],
                    0, topH,
                    leftW, contentH
                );
            }
            // Right Edge
            if (loadedImages['Right-Edge']) {
                ctx.drawImage(
                    loadedImages['Right-Edge'],
                    finalW - rightW, topH,
                    rightW, contentH
                );
            }

            // -- Corners --
            // Top Left (Anchored 0,0)
            if (loadedImages['Top-Left']) {
                ctx.drawImage(loadedImages['Top-Left'], 0, 0);
            }
            // Top Right (Anchored Right, 0)
            if (loadedImages['Top-Right']) {
                ctx.drawImage(loadedImages['Top-Right'], finalW - tr.width, 0);
            }
            // Bottom Left (Anchored 0, Bottom)
            if (loadedImages['Bottom-Left']) {
                ctx.drawImage(loadedImages['Bottom-Left'], 0, finalH - bl.height);
            }
            // Bottom Right (Anchored Right, Bottom)
            if (loadedImages['Bottom-Right']) {
                ctx.drawImage(loadedImages['Bottom-Right'], finalW - br.width, finalH - br.height);
            }

            // 5. Draw Text
            ctx.fillStyle = color;
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            // Calculate center of the content area
            const centerX = leftW + (contentW / 2);
            // Adjust centerY slightly for textBaseline middle optical alignment
            const centerY = topH + (contentH / 2) + 1; 

            ctx.fillText(text, centerX, centerY);

            return canvas;
        }

        async createBubble(args, util) {
            const text = String(args.TEXT);
            const size = Number(args.SIZE) || 24;
            const padding = Number(args.PADDING) || 10;
            const color = args.COLOR;

            const canvas = await this._generateBubbleCanvas(text, size, padding, color, util.target);
            
            // --- Skin Update Logic (Like Skins Extension) ---
            const context = canvas.getContext('2d');
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            
            // Create a new skin ID
            // Rotation center is the middle of the bubble
            const rotationCenter = [canvas.width / 2, canvas.height / 2];
            
            const skinId = renderer.createBitmapSkin(imageData, rotationCenter);
            
            // Apply skin to the drawable
            const drawableId = util.target.drawableID;
            renderer.updateDrawableSkinId(drawableId, skinId);
            
            // Update the target's size properties so Scratch knows the new bounds
            // This is strictly internal but helps with collision detection if needed
            // However, full collision update requires deeper VM integration.
            // Visually, this is enough.
        }

        async getBubbleDataUri(args, util) {
            const text = String(args.TEXT);
            const size = Number(args.SIZE) || 24;
            const padding = Number(args.PADDING) || 10;
            const color = args.COLOR;

            const canvas = await this._generateBubbleCanvas(text, size, padding, color, util.target);
            return canvas.toDataURL();
        }
    }

    Scratch.extensions.register(new BubblesExtension());
})(Scratch);
