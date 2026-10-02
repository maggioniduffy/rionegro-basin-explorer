import type { Map as MapLibreMap } from "maplibre-gl";

/** "rio-negro-basin-2026-10-02.png", from the local date. */
export function snapshotFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `rio-negro-basin-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.png`;
}

/** Greedy word wrap; a word longer than the width gets a line of its own. */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The map's pixels, read during a render: the WebGL drawing buffer is only valid
 * until the frame is presented, so it is copied from the "render" event.
 */
function captureCanvas(map: MapLibreMap): Promise<HTMLCanvasElement> {
  return new Promise((resolve) => {
    map.once("render", () => {
      const src = map.getCanvas();
      const copy = document.createElement("canvas");
      copy.width = src.width;
      copy.height = src.height;
      copy.getContext("2d")?.drawImage(src, 0, 0);
      resolve(copy);
    });
    map.triggerRepaint();
  });
}

/**
 * The current view as a PNG, with the attribution (every source's credit, as the map
 * shows it) stamped in a strip along the bottom: the imagery licence asks for it.
 */
export async function renderSnapshot(
  map: MapLibreMap,
  o: { attribution: string; background: string; foreground: string },
): Promise<Blob> {
  if (!map.loaded()) await map.once("idle");
  const shot = await captureCanvas(map);
  const scale = shot.width / map.getCanvas().clientWidth || 1;
  const fontPx = 12 * scale;
  const pad = 8 * scale;
  const lineHeight = fontPx * 1.35;

  const out = document.createElement("canvas");
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2D canvas not available");
  const font = `${fontPx}px system-ui, sans-serif`;
  ctx.font = font;
  const lines = wrapText(
    o.attribution,
    shot.width - 2 * pad,
    (s) => ctx.measureText(s).width,
  );
  out.width = shot.width;
  out.height = shot.height + lines.length * lineHeight + 2 * pad;

  ctx.drawImage(shot, 0, 0);
  ctx.fillStyle = o.background;
  ctx.fillRect(0, shot.height, out.width, out.height - shot.height);
  // Resizing the canvas reset the context, so set the font again.
  ctx.font = font;
  ctx.fillStyle = o.foreground;
  ctx.textBaseline = "top";
  lines.forEach((line, i) =>
    ctx.fillText(line, pad, shot.height + pad + i * lineHeight),
  );

  return new Promise((resolve, reject) =>
    out.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("PNG encoding failed")),
      "image/png",
    ),
  );
}
