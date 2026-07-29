/**
 * The handful of browser globals pdf.js expects, for use under Node.
 *
 * `vendor/pdf.mjs` is the browser build, which is the right one to ship: in a
 * browser `DOMMatrix` is native and none of this is needed. Node has no such
 * global, so importing pdf.js in a test throws `DOMMatrix is not defined`
 * before a single assertion runs.
 *
 * This existed silently for a while because a stray `npm install` left a
 * `node_modules` in the directory *above* the repository; pdf.js walks up the
 * tree, found `@napi-rs/canvas` there, and quietly used its DOMMatrix. The
 * tests passed locally and failed on every clean checkout. A shim in the
 * repository is the fix — it removes the dependency on where someone happened
 * to install something.
 *
 * Only the 2-D subset is implemented, which is all that text extraction uses.
 * Import this module before anything that reaches for pdf.js.
 */

/** A 2-D affine matrix: [a c e / b d f / 0 0 1]. */
class Matrix2D {
  constructor(init) {
    let values = [1, 0, 0, 1, 0, 0];

    if (Array.isArray(init) || ArrayBuffer.isView(init)) {
      const numbers = Array.from(init, Number);
      if (numbers.length === 6) {
        values = numbers;
      } else if (numbers.length === 16) {
        // A 4x4 in column-major order, flattened to its 2-D part.
        values = [numbers[0], numbers[1], numbers[4], numbers[5], numbers[12], numbers[13]];
      }
    } else if (init && typeof init === 'object') {
      const { a = 1, b = 0, c = 0, d = 1, e = 0, f = 0 } = init;
      values = [a, b, c, d, e, f];
    }

    [this.a, this.b, this.c, this.d, this.e, this.f] = values;
  }

  /* The m11..m42 spellings of the same six numbers. pdf.js uses both. */
  get m11() { return this.a; } set m11(v) { this.a = v; }
  get m12() { return this.b; } set m12(v) { this.b = v; }
  get m21() { return this.c; } set m21(v) { this.c = v; }
  get m22() { return this.d; } set m22(v) { this.d = v; }
  get m41() { return this.e; } set m41(v) { this.e = v; }
  get m42() { return this.f; } set m42(v) { this.f = v; }

  get isIdentity() {
    return this.a === 1 && this.b === 0 && this.c === 0
      && this.d === 1 && this.e === 0 && this.f === 0;
  }

  multiply(other) {
    const right = other instanceof Matrix2D ? other : new Matrix2D(other);
    return new Matrix2D([
      this.a * right.a + this.c * right.b,
      this.b * right.a + this.d * right.b,
      this.a * right.c + this.c * right.d,
      this.b * right.c + this.d * right.d,
      this.a * right.e + this.c * right.f + this.e,
      this.b * right.e + this.d * right.f + this.f,
    ]);
  }

  multiplySelf(other) {
    Object.assign(this, this.multiply(other));
    return this;
  }

  translate(tx = 0, ty = 0) {
    return this.multiply(new Matrix2D([1, 0, 0, 1, tx, ty]));
  }

  scale(sx = 1, sy = sx) {
    return this.multiply(new Matrix2D([sx, 0, 0, sy, 0, 0]));
  }

  /** A singular matrix inverts to NaNs, which is what the DOM spec asks for. */
  inverse() {
    const determinant = this.a * this.d - this.b * this.c;
    if (!determinant) return new Matrix2D([NaN, NaN, NaN, NaN, NaN, NaN]);
    return new Matrix2D([
      this.d / determinant,
      -this.b / determinant,
      -this.c / determinant,
      this.a / determinant,
      (this.c * this.f - this.d * this.e) / determinant,
      (this.b * this.e - this.a * this.f) / determinant,
    ]);
  }

  invertSelf() {
    Object.assign(this, this.inverse());
    return this;
  }

  transformPoint(point = { x: 0, y: 0 }) {
    const { x = 0, y = 0 } = point;
    return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0, w: 1 };
  }

  toString() {
    return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
  }
}

/** Define a global only when the runtime does not already provide a real one. */
function provide(name, value) {
  if (typeof globalThis[name] === 'undefined') globalThis[name] = value;
}

provide('DOMMatrix', Matrix2D);
provide('DOMMatrixReadOnly', Matrix2D);

// Referenced when pdf.js sets up canvas rendering. Text extraction never draws,
// so these only have to exist.
provide('Path2D', class Path2D {
  addPath() {} moveTo() {} lineTo() {} bezierCurveTo() {}
  quadraticCurveTo() {} closePath() {} rect() {} arc() {}
});

provide('ImageData', class ImageData {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(Math.max(0, width * height * 4));
  }
});

export { Matrix2D };
