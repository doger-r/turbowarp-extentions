(function (Scratch) {
  "use strict";

  class LayersPlus {
    constructor() {}

    getInfo() {
      return {
        id: "layersSorted",
        name: "Sorted Layers",
        color1: "#9966FF", // Looks category color
        blocks: [
          {
            opcode: "setLayer",
            blockType: Scratch.BlockType.COMMAND,
            text: "set layer to [LAYER]",
            arguments: {
              LAYER: {
                type: Scratch.ArgumentType.NUMBER,
                defaultValue: "0"
              }
            }
          },
          {
            opcode: "layer",
            blockType: Scratch.BlockType.REPORTER,
            text: "layer",
            disableMonitor: true
          }
        ]
      };
    }

    // Helper: safe access to runtime targets
    _getRuntimeTargets() {
      try {
        if (Scratch && Scratch.vm && Scratch.vm.runtime && Array.isArray(Scratch.vm.runtime.targets)) {
          return Scratch.vm.runtime.targets;
        }
      } catch (e) {
        // fallthrough
      }
      return [];
    }

    // Compare two layer values robustly (supports arbitrarily large integer strings).
    // Each value is either a string (possibly numeric) or a fallback numeric order.
    _compareLayerValues(aVal, bVal, aIdx, bIdx) {
      // If both look like integers, compare using BigInt
      const intRegex = /^-?\d+$/;
      if (typeof aVal === "string" && typeof bVal === "string" && intRegex.test(aVal) && intRegex.test(bVal)) {
        try {
          const aBig = BigInt(aVal);
          const bBig = BigInt(bVal);
          if (aBig < bBig) return -1;
          if (aBig > bBig) return 1;
          // equal -> fall back to original index
          return aIdx - bIdx;
        } catch (e) {
          // If BigInt is not available or fails, fall through to numeric
        }
      }

      // Try numeric comparison
      const aNum = Number(aVal);
      const bNum = Number(bVal);
      const aNumValid = !Number.isNaN(aNum);
      const bNumValid = !Number.isNaN(bNum);
      if (aNumValid && bNumValid) {
        if (aNum < bNum) return -1;
        if (aNum > bNum) return 1;
        return aIdx - bIdx;
      }

      // Last-resort stable ordering: compare as strings, then indices
      const aStr = String(aVal);
      const bStr = String(bVal);
      if (aStr < bStr) return -1;
      if (aStr > bStr) return 1;
      return aIdx - bIdx;
    }

    // Re-apply ordering for all non-stage targets based on stored _layersPlusLayer values.
    _applyLayerOrdering() {
      const runtimeTargets = this._getRuntimeTargets();
      if (!runtimeTargets.length) return;

      // Collect sprite targets only (exclude stage)
      const spriteTargets = runtimeTargets.filter(t => !t.isStage);

      // Build list: prefer stored _layersPlusLayer (string), otherwise use current layer order if available, else index.
      const items = spriteTargets.map((t, idx) => {
        let stored = undefined;
        if (typeof t._layersPlusLayer !== "undefined" && t._layersPlusLayer !== null) {
          stored = String(t._layersPlusLayer);
        } else {
          // try getLayerOrder if available, otherwise fallback to current index
          if (typeof t.getLayerOrder === "function") {
            try {
              const ord = t.getLayerOrder();
              // store numeric fallback as number
              stored = Number.isFinite(Number(ord)) ? Number(ord) : String(ord);
            } catch (e) {
              stored = idx;
            }
          } else if (typeof t.getLayer === "function") {
            // some older VMs
            try {
              const ord = t.getLayer();
              stored = Number.isFinite(Number(ord)) ? Number(ord) : String(ord);
            } catch (e) {
              stored = idx;
            }
          } else {
            stored = idx;
          }
        }
        return { target: t, value: stored, originalIndex: idx };
      });

      // Sort ascending: lower numbers => back; higher numbers => front
      items.sort((A, B) => this._compareLayerValues(A.value, B.value, A.originalIndex, B.originalIndex));

      // Apply order: iterate from lowest to highest and send each to back.
      // That makes the first item become the backmost; last becomes frontmost.
      for (const it of items) {
        try {
          if (typeof it.target.goToBack === "function") {
            it.target.goToBack();
          } else if (typeof it.target.goToFront === "function") {
            // If goToBack isn't available, attempt a conservative fallback:
            // move to front then rely on repeated calls to produce deterministic order.
            it.target.goToFront();
          }
        } catch (e) {
          // swallow per-target errors to avoid breaking ordering entirely
        }
      }
    }

    // REPORTER: layer
    layer(args, util) {
      const t = util.target;
      if (!t) return "";
      if (typeof t._layersPlusLayer !== "undefined") {
        return String(t._layersPlusLayer);
      }
      // fall back to VM-provided layer order if available
      if (typeof t.getLayerOrder === "function") {
        try {
          return String(t.getLayerOrder());
        } catch (e) {}
      } else if (typeof t.getLayer === "function") {
        try {
          return String(t.getLayer());
        } catch (e) {}
      }
      return "0";
    }

    // COMMAND: set layer to [LAYER]
    setLayer(args, util) {
      const t = util.target;
      if (!t) return;
      const raw = typeof args.LAYER === "undefined" ? "" : String(args.LAYER);
      // store as string (preserve large integer precision). Keep any non-digit text as-is.
      t._layersPlusLayer = raw.trim();

      // Re-apply ordering immediately
      this._applyLayerOrdering();
    }
  }

  Scratch.extensions.register(new LayersPlus());
})(Scratch);
