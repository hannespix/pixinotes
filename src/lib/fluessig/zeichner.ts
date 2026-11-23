// Herkunft: Liquid Type von Hannes Pix (github.com/hannespix/liquidtype, src/render.mjs, Stand 02.10.2026).
// Die Shader und die Oberflächenrekonstruktion sind die des Originals. M500-Änderungen für PixiNotes:
//  - EIN WebGL2-Kontext für alle Karten (Browser erlauben nur ~16 Kontexte, jeder kostet Speicher und Startzeit).
//    Jede Karte hat ihr eigenes Ziel (Materialtextur + Dichtefeld); gezeichnet wird reihum in eine gemeinsame,
//    unsichtbare Fläche und von dort in die 2D-Fläche der Karte kopiert.
//  - Durchsichtig statt Papierfarbe: die Oberfläche liefert Tinte mit Deckung (vormultipliert), so liegt die
//    Schrift auf jeder Kartenfarbe, hell wie dunkel.
//  - Kein Mauszeiger-Tropfen (`extra`) und keine Feinstrich-Sonderwege außer `fine`/`calm` wie im Original.

const pointVertex = `#version 300 es
precision highp float;
in vec2 position;
in vec2 home;
in float deformation;
in float size;
uniform vec2 resolution;
uniform float pointScale;
uniform float maxPoint;
uniform vec3 fine;
uniform float fineAmp;
out vec2 materialHome;
out vec2 currentPosition;
out float strain;
out float dropRadius;
out float amplitude;
void main(){
 materialHome=home;currentPosition=position;strain=deformation;
 float f=1.-smoothstep(fine.x,fine.y,size),moving=smoothstep(.02,.3,deformation);
 float grow=mix(1.,fine.z,f*moving);
 dropRadius=size*2.1*grow;amplitude=mix(1.,fineAmp,f*moving);
 gl_Position=vec4(position/resolution*vec2(2.,-2.)+vec2(-1.,1.),0.,1.);gl_PointSize=min(maxPoint,size*pointScale*grow);
}`;
const dropFragment = `#version 300 es
precision highp float;
uniform sampler2D glyphMaterial;
uniform vec2 resolution;
uniform vec2 pixelScale;
uniform float shrink;
in vec2 materialHome;
in vec2 currentPosition;
in float strain;
in float dropRadius;
in float amplitude;
out vec4 color;
void main(){
 vec2 pixel=vec2(gl_FragCoord.x/pixelScale.x,resolution.y-gl_FragCoord.y/pixelScale.y);
 vec2 offset=pixel-currentPosition;
 float shape=smoothstep(.02,.9,strain);
 vec2 q=offset/(dropRadius*mix(1.,shrink,shape));float d=dot(q,q);if(d>1.)discard;
 float ink=texture(glyphMaterial,(materialHome+offset)/resolution).a;
 float kernel=.16*amplitude*pow(max(0.,1.-d),3.);
 color=vec4(kernel*mix(ink,1.,shape),kernel,kernel*shape,0.);
}`;
const screenVertex = `#version 300 es
precision highp float;
out vec2 uv;
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`;
// M500: statt mix(paper, ink, body) die Tinte mit Deckung body (vormultipliert) — durchsichtig auf jeder Karte
const surfaceFragment = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D density;
uniform vec3 ink;
out vec4 color;
void main(){
 vec3 sums=texture(density,uv).rgb;
 float coverage=sums.g;
 float agitation=clamp(sums.b/max(coverage,.0001),0.,1.);
 float v=.9*sums.r/max(mix(coverage,.16,agitation),.0001);
 v*=smoothstep(.006,.024,coverage);
 float aa=max(fwidth(v)*.65,.012);
 float body=smoothstep(.51-aa,.51+aa,v);
 color=vec4(ink*body,body);
}`;

/** Was eine Karte im gemeinsamen Kontext besitzt */
export interface Ziel {
  glyph: WebGLTexture;
  dichte: WebGLTexture;
  fbo: WebGLFramebuffer;
  /** CSS-Pixel */
  w: number; h: number;
  /** Gerätepixel */
  pw: number; ph: number;
}

export interface Look { ink: [number, number, number]; calm: number; fine: { from: number; to: number; grow: number; amp: number }; shrink?: number }

/** Der Ausschnitt eines Teilchenschwarms, den der Zeichner braucht (physik.ts › Fluid) */
interface Schwarm { n: number; spacing: number; x: Float32Array; y: Float32Array; tx: Float32Array; ty: Float32Array; vx: Float32Array; vy: Float32Array }

export class Zeichner {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  floatSurface: boolean;
  maxScale = 2;
  private points: WebGLProgram;
  private surface: WebGLProgram;
  private at: Record<string, WebGLUniformLocation | null>;
  private surfaceAt: Record<string, WebGLUniformLocation | null>;
  private buffer: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private data = new Float32Array(0);
  private maxPointSize: number;
  private geprueft = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 2; this.canvas.height = 2;
    const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'default' });
    if (!gl) throw new Error('WebGL2 ist auf diesem Gerät nicht verfügbar.');
    this.gl = gl;
    this.floatSurface = !!gl.getExtension('EXT_color_buffer_float');
    this.points = this.program(pointVertex, dropFragment);
    this.surface = this.program(screenVertex, surfaceFragment);
    const where = (p: WebGLProgram, names: string[]) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
    this.at = where(this.points, ['resolution', 'pointScale', 'maxPoint', 'glyphMaterial', 'pixelScale', 'shrink', 'fine', 'fineAmp']);
    this.surfaceAt = where(this.surface, ['density', 'ink']);
    this.buffer = gl.createBuffer()!; this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    for (const [name, size, offset] of [['position', 2, 0], ['home', 2, 8], ['deformation', 1, 16], ['size', 1, 20]] as const) {
      const loc = gl.getAttribLocation(this.points, name); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 24, offset);
    }
    gl.bindVertexArray(null);
    this.maxPointSize = (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array)[1];
  }

  private program(vs: string, fs: string): WebGLProgram {
    const gl = this.gl, p = gl.createProgram()!;
    for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
      const s = gl.createShader(type)!; gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'Shader');
      gl.attachShader(p, s); gl.deleteShader(s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'Programm');
    return p;
  }

  private textur(): WebGLTexture {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  neuesZiel(): Ziel {
    const gl = this.gl;
    const glyph = this.textur();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    return { glyph, dichte: this.textur(), fbo: gl.createFramebuffer()!, w: 0, h: 0, pw: 0, ph: 0 };
  }

  freigeben(z: Ziel): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    gl.deleteTexture(z.glyph); gl.deleteTexture(z.dichte); gl.deleteFramebuffer(z.fbo);
  }

  material(z: Ziel, quelle: HTMLCanvasElement): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, z.glyph);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, quelle);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Größe eines Ziels in CSS-Pixeln; liefert die Gerätepixel (für die 2D-Fläche der Karte) */
  groesse(z: Ziel, w: number, h: number): { pw: number; ph: number } {
    const gl = this.gl;
    const scale = Math.min(devicePixelRatio || 1, this.maxScale, 2, 2400 / Math.max(1, w), 2400 / Math.max(1, h));
    const pw = Math.max(1, Math.round(w * scale)), ph = Math.max(1, Math.round(h * scale));
    if (z.pw === pw && z.ph === ph && z.w === w && z.h === h) return { pw, ph };
    z.w = w; z.h = h; z.pw = pw; z.ph = ph;
    gl.bindTexture(gl.TEXTURE_2D, z.dichte);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.floatSurface ? gl.RGBA16F : gl.RGBA8, pw, ph, 0, gl.RGBA, this.floatSurface ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, z.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, z.dichte, 0);
    // Die Vollständigkeitsprüfung hält die Grafik an — nur beim ersten Ziel, danach ändert sich nur die Größe
    if (!this.geprueft) {
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Die Grafikoberfläche konnte nicht angelegt werden.');
      this.geprueft = true;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // Die gemeinsame Fläche wächst nur — kleiner werden hieße bei jedem Kartenwechsel neu anlegen
    if (this.canvas.width < pw || this.canvas.height < ph) {
      this.canvas.width = Math.max(this.canvas.width, pw); this.canvas.height = Math.max(this.canvas.height, ph);
    }
    return { pw, ph };
  }

  /** Zeichnet den Schwarm einer Karte und kopiert ihn in deren 2D-Fläche `aus` (Gerätepixel = z.pw × z.ph) */
  zeichne(z: Ziel, fluid: Schwarm, look: Look, aus: CanvasRenderingContext2D): void {
    const gl = this.gl;
    if (gl.isContextLost() || !z.pw) return;
    const total = fluid.n;
    if (this.data.length < total * 6) this.data = new Float32Array(total * 6);
    const stir = 1 - Math.max(0, Math.min(1, look.calm)), unit = fluid.spacing;
    for (let i = 0; i < total; i++) {
      const k = i * 6;
      this.data[k] = fluid.x[i]; this.data[k + 1] = fluid.y[i]; this.data[k + 2] = fluid.tx[i]; this.data[k + 3] = fluid.ty[i];
      const dx = fluid.x[i] - fluid.tx[i], dy = fluid.y[i] - fluid.ty[i], vx = fluid.vx[i], vy = fluid.vy[i];
      this.data[k + 4] = Math.sqrt(dx * dx + dy * dy) / (unit * (3 - 2 * stir)) + Math.sqrt(vx * vx + vy * vy) / (unit * 12) * stir;
      this.data[k + 5] = unit;
    }
    // 1. Tropfen ins Dichtefeld der Karte
    gl.bindFramebuffer(gl.FRAMEBUFFER, z.fbo);
    gl.viewport(0, 0, z.pw, z.ph);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.points); gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, total * 6), gl.DYNAMIC_DRAW);
    const at = this.at;
    gl.uniform2f(at.resolution, z.w, z.h); gl.uniform1f(at.pointScale, 4.2 * (z.pw / z.w)); gl.uniform1f(at.maxPoint, this.maxPointSize);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, z.glyph); gl.uniform1i(at.glyphMaterial, 1);
    gl.uniform2f(at.pixelScale, z.pw / z.w, z.ph / z.h); gl.uniform1f(at.shrink, look.shrink ?? 1);
    gl.uniform3f(at.fine, look.fine.from, Math.max(look.fine.to, look.fine.from + 0.001), look.fine.grow); gl.uniform1f(at.fineAmp, look.fine.amp);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    if (total) gl.drawArrays(gl.POINTS, 0, total);
    gl.disable(gl.BLEND);
    // 2. Oberfläche in die linke untere Ecke der gemeinsamen Fläche
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, z.pw, z.ph);
    gl.useProgram(this.surface); gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, z.dichte);
    gl.uniform1i(this.surfaceAt.density, 0); gl.uniform3fv(this.surfaceAt.ink, look.ink);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // 3. In die Karte kopieren — im selben Durchlauf, solange der Zeichenpuffer gilt
    aus.clearRect(0, 0, z.pw, z.ph);
    aus.drawImage(this.canvas, 0, this.canvas.height - z.ph, z.pw, z.ph, 0, 0, z.pw, z.ph);
  }
}
