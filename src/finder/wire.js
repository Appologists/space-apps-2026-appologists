// How a set of rasters travels from the server to the browser: a small JSON header, then each raster's raw
// bytes, each starting on a 4-byte boundary. Shared by both sides: no Node or browser APIs.

const TYPES = { f32: Float32Array, u16: Uint16Array, u8: Uint8Array };
const typeName = (array) => Object.keys(TYPES).find((name) => array instanceof TYPES[name]);
const pad4 = (bytes) => Math.ceil(bytes / 4) * 4;

/**
 * @param {Object} header                         anything JSON can hold
 * @param {Object<string, Float32Array|Uint16Array|Uint8Array>} rasters
 * @returns {Uint8Array}
 */
export function encodeRasters(header, rasters) {
  const directory = [];
  let offset = 0;
  for (const [name, array] of Object.entries(rasters)) {
    const type = typeName(array);
    if (!type) throw new Error(`Raster "${name}" has an unsupported type`);
    directory.push({ name, type, length: array.length, offset });
    offset += pad4(array.byteLength);
  }
  const json = new TextEncoder().encode(JSON.stringify({ header, directory }));
  const headerBytes = pad4(json.length);
  const out = new Uint8Array(4 + headerBytes + offset);
  new DataView(out.buffer).setUint32(0, headerBytes, true);
  out.set(json, 4);
  out.fill(0x20, 4 + json.length, 4 + headerBytes); // pad with spaces, which JSON.parse ignores
  for (const entry of directory) {
    const array = rasters[entry.name];
    out.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), 4 + headerBytes + entry.offset);
  }
  return out;
}

/** @param {ArrayBuffer} buffer  @returns {{header: Object, rasters: Object<string, Float32Array|Uint16Array|Uint8Array>}} */
export function decodeRasters(buffer) {
  const headerBytes = new DataView(buffer).getUint32(0, true);
  const { header, directory } = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerBytes)));
  const rasters = {};
  for (const { name, type, length, offset } of directory) {
    const Type = TYPES[type];
    const start = 4 + headerBytes + offset;
    rasters[name] = new Type(buffer.slice(start, start + length * Type.BYTES_PER_ELEMENT));
  }
  return { header, rasters };
}
