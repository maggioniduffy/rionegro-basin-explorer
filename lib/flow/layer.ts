import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";
import { FLOW_COLOR_STOPS } from "./color";
import {
  FLOW_FADE_ZOOMS,
  FLOW_MIN_ZOOM,
  FLOW_PARTICLES,
  FLOW_TRAIL,
} from "./config";
import { buildTrack, type Track } from "./geometry";
import {
  createParticles,
  fillSegments,
  FLOW_VERTEX_FLOATS,
  hashSeed,
  mulberry32,
  stepParticles,
  type ParticleState,
} from "./particles";
import type { FlowSection } from "./schema";

export const FLOW_LAYER_ID = "flow-particles";
/** Insert before this layer: above reaches-*, below the dams and localities. */
export const FLOW_BEFORE_ID = "dam-walls";

/** Fixed simulation step used by controller.step (e2e), in seconds. */
const FRAME_S = 1 / 60;
/** Seconds over which a respawned particle fades in (matches fillSegments). */
const FADE_IN_S = 0.5;
/** Head dot diameter in CSS pixels. Provisional. */
const POINT_SIZE_PX = 3;

declare global {
  interface Window {
    /** E2E only (NEXT_PUBLIC_E2E=1): advances the flow simulation by n fixed frames. */
    __flowStep?: (n: number) => void;
  }
}

export interface FlowController {
  /** Builds the track and seeds the particles from the section id; null clears the layer. */
  setSection(section: FlowSection | null): void;
  setPlaying(playing: boolean): void;
  setSpeed(multiplier: number): void;
  /** Advances n fixed 1/60 s steps whether or not playing, then repaints (e2e). */
  step(frames: number): void;
  /** True while the layer asks the map for continuous repaints. */
  isAnimating(): boolean;
}

const VERTEX = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform float u_opacity;
uniform float u_point_size;
uniform vec3 u_colors[5];
uniform float u_at[5];
in vec2 a_pos;
in float a_speed;
in float a_alpha;
out vec3 v_color;
out float v_alpha;

// Same piecewise-linear ramp as speedColor in color.ts.
vec3 ramp(float v) {
  float c = clamp(v, 0.0, 1.0);
  vec3 col = u_colors[4];
  for (int k = 0; k < 4; k++) {
    if (c <= u_at[k + 1]) {
      col = mix(u_colors[k], u_colors[k + 1], (c - u_at[k]) / (u_at[k + 1] - u_at[k]));
      break;
    }
  }
  return col;
}

void main() {
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
  gl_PointSize = u_point_size;
  v_color = ramp(a_speed);
  v_alpha = a_alpha * u_opacity;
}
`;

const FRAGMENT = `#version 300 es
precision mediump float;
uniform bool u_round;
in vec3 v_color;
in float v_alpha;
out vec4 outColor;

void main() {
  if (u_round && length(gl_PointCoord - vec2(0.5)) > 0.5) discard;
  outColor = vec4(v_color * v_alpha, v_alpha); // premultiplied
}
`;

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`flow layer shader: ${log}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`flow layer program: ${log}`);
  }
  return program;
}

/** u = a x translate(tx, ty, 0), column-major; only the last column changes. Float64 throughout. */
function translatedMatrix(
  a: ArrayLike<number>,
  tx: number,
  ty: number,
  out: Float64Array,
): void {
  for (let i = 0; i < 12; i++) out[i] = a[i]!;
  for (let r = 0; r < 4; r++)
    out[12 + r] = a[r]! * tx + a[4 + r]! * ty + a[12 + r]!;
}

interface GlState {
  program: WebGLProgram;
  lineVao: WebGLVertexArrayObject;
  lineBuf: WebGLBuffer;
  pointVao: WebGLVertexArrayObject;
  pointBuf: WebGLBuffer;
  uMatrix: WebGLUniformLocation | null;
  uOpacity: WebGLUniformLocation | null;
  uPointSize: WebGLUniformLocation | null;
  uRound: WebGLUniformLocation | null;
}

export function createFlowLayer(): {
  layer: CustomLayerInterface;
  controller: FlowController;
} {
  let map: MapLibreMap | null = null;
  let glState: GlState | null = null;
  let track: Track | null = null;
  let particles: ParticleState | null = null;
  let rng: (() => number) | null = null;
  let playing = false;
  let multiplier = 1;
  let animating = false;
  let lastT: number | null = null;

  const maxLineVerts = FLOW_PARTICLES * (FLOW_TRAIL - 1) * 2;
  const lineData = new Float32Array(maxLineVerts * FLOW_VERTEX_FLOATS);
  const pointData = new Float32Array(FLOW_PARTICLES * FLOW_VERTEX_FLOATS);
  const matrix64 = new Float64Array(16);
  const matrix32 = new Float32Array(16);
  const colors = new Float32Array(
    FLOW_COLOR_STOPS.flatMap((s) => {
      const n = parseInt(s.hex.slice(1), 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }),
  );
  const stopAt = new Float32Array(FLOW_COLOR_STOPS.map((s) => s.at));

  const repaint = () => map?.triggerRepaint();

  const onVisibility = () => {
    lastT = null;
    if (!document.hidden && playing) repaint();
  };

  function advance(dt: number) {
    if (track && particles && rng)
      stepParticles(particles, track, dt, multiplier, rng);
  }

  const controller: FlowController = {
    setSection(section) {
      lastT = null;
      if (!section) {
        track = null;
        particles = null;
        rng = null;
      } else {
        track = buildTrack(section);
        rng = mulberry32(hashSeed(section.id));
        particles = createParticles(track, FLOW_PARTICLES, rng);
      }
      repaint();
    },
    setPlaying(value) {
      playing = value;
      lastT = null;
      if (value) repaint();
    },
    setSpeed(value) {
      multiplier = value;
    },
    step(frames) {
      for (let i = 0; i < frames; i++) advance(FRAME_S);
      repaint();
    },
    isAnimating: () => animating,
  };

  function bindAttribs(gl: WebGL2RenderingContext, program: WebGLProgram) {
    const stride = FLOW_VERTEX_FLOATS * 4;
    const pos = gl.getAttribLocation(program, "a_pos");
    const speed = gl.getAttribLocation(program, "a_speed");
    const alpha = gl.getAttribLocation(program, "a_alpha");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(speed);
    gl.vertexAttribPointer(speed, 1, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(alpha);
    gl.vertexAttribPointer(alpha, 1, gl.FLOAT, false, stride, 12);
  }

  function makeStream(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    bytes: number,
  ) {
    const vao = gl.createVertexArray()!;
    const buf = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW);
    bindAttribs(gl, program);
    gl.bindVertexArray(null);
    return { vao, buf };
  }

  const layer: CustomLayerInterface = {
    id: FLOW_LAYER_ID,
    type: "custom",
    renderingMode: "2d",

    onAdd(m, gl) {
      map = m;
      const program = link(gl);
      const lines = makeStream(gl, program, lineData.byteLength);
      const points = makeStream(gl, program, pointData.byteLength);
      glState = {
        program,
        lineVao: lines.vao,
        lineBuf: lines.buf,
        pointVao: points.vao,
        pointBuf: points.buf,
        uMatrix: gl.getUniformLocation(program, "u_matrix"),
        uOpacity: gl.getUniformLocation(program, "u_opacity"),
        uPointSize: gl.getUniformLocation(program, "u_point_size"),
        uRound: gl.getUniformLocation(program, "u_round"),
      };
      document.addEventListener("visibilitychange", onVisibility);
      if (process.env.NEXT_PUBLIC_E2E === "1")
        window.__flowStep = (n) => controller.step(n);
    },

    onRemove(_m, gl) {
      document.removeEventListener("visibilitychange", onVisibility);
      if (process.env.NEXT_PUBLIC_E2E === "1") delete window.__flowStep;
      if (glState) {
        gl.deleteProgram(glState.program);
        gl.deleteVertexArray(glState.lineVao);
        gl.deleteVertexArray(glState.pointVao);
        gl.deleteBuffer(glState.lineBuf);
        gl.deleteBuffer(glState.pointBuf);
        glState = null;
      }
      animating = false;
      map = null;
    },

    render(gl, options) {
      const g = glState;
      if (!g || !map) return;
      const now = performance.now();
      const dt = lastT === null ? 0 : (now - lastT) / 1000;
      lastT = now;

      const opacity = Math.min(
        1,
        Math.max(
          0,
          (map.getZoom() - (FLOW_MIN_ZOOM - FLOW_FADE_ZOOMS)) / FLOW_FADE_ZOOMS,
        ),
      );
      // Animate only while it is visible and on screen, so a paused or zoomed-out map idles.
      animating = playing && opacity > 0 && !document.hidden;
      if (animating) advance(dt);
      if (!track || !particles || opacity <= 0) {
        if (animating) map.triggerRepaint();
        return;
      }

      // Positions are relative to the track origin (float32); the origin is added in float64.
      translatedMatrix(
        options.modelViewProjectionMatrix,
        track.originX,
        track.originY,
        matrix64,
      );
      matrix32.set(matrix64);

      const lineVerts = fillSegments(particles, lineData);
      const slot = particles.head;
      let w = 0;
      for (let p = 0; p < particles.count; p++) {
        const o = (p * FLOW_TRAIL + slot) * 2;
        pointData[w++] = particles.trail[o]!;
        pointData[w++] = particles.trail[o + 1]!;
        pointData[w++] = particles.v[p]!;
        pointData[w++] = Math.min(1, particles.age[p]! / FADE_IN_S);
      }

      gl.useProgram(g.program);
      gl.uniformMatrix4fv(g.uMatrix, false, matrix32);
      gl.uniform1f(g.uOpacity, opacity);
      gl.uniform3fv(gl.getUniformLocation(g.program, "u_colors"), colors);
      gl.uniform1fv(gl.getUniformLocation(g.program, "u_at"), stopAt);
      // Depth state is not ours; the particles sit on top of the map layers drawn before.
      gl.disable(gl.DEPTH_TEST);

      gl.uniform1f(g.uPointSize, 1);
      gl.uniform1i(g.uRound, 0);
      gl.bindVertexArray(g.lineVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.lineBuf);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        lineData,
        0,
        lineVerts * FLOW_VERTEX_FLOATS,
      );
      gl.drawArrays(gl.LINES, 0, lineVerts);

      gl.uniform1f(
        g.uPointSize,
        POINT_SIZE_PX * (window.devicePixelRatio || 1),
      );
      gl.uniform1i(g.uRound, 1);
      gl.bindVertexArray(g.pointVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.pointBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pointData);
      gl.drawArrays(gl.POINTS, 0, particles.count);
      gl.bindVertexArray(null);

      if (animating) map.triggerRepaint();
    },
  };

  return { layer, controller };
}
