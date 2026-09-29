import { Mp3Encoder } from "@breezystack/lamejs";

type WavData = { samples: Int16Array; sampleRate: number };

function readWav(buffer: ArrayBuffer): WavData {
  const view = new DataView(buffer);
  let sampleRate = 24000;
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") sampleRate = view.getUint32(offset + 12, true);
    if (id === "data") {
      const samples = new Int16Array(size / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(offset + 8 + i * 2, true);
      return { samples, sampleRate };
    }
    offset += 8 + size + (size % 2);
  }
  return { samples: new Int16Array(0), sampleRate };
}

export function wavToMp3Blob(buffer: ArrayBuffer): Blob {
  const { samples, sampleRate } = readWav(buffer);
  const encoder = new Mp3Encoder(1, sampleRate, 128);
  const chunks: Uint8Array[] = [];
  const blockSize = 1152;
  for (let i = 0; i < samples.length; i += blockSize) {
    const block = samples.subarray(i, i + blockSize);
    const encoded = encoder.encodeBuffer(block);
    if (encoded.length > 0) chunks.push(new Uint8Array(encoded));
  }
  const flushed = encoder.flush();
  if (flushed.length > 0) chunks.push(new Uint8Array(flushed));
  return new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFileName(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[^\w\-]+/g, "-").slice(0, 60) || "leitura";
}
