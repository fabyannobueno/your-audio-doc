import { createFileRoute } from "@tanstack/react-router";

const BASE_URL = "https://ai.gateway.lovable.dev";
const MODEL = "google/gemini-3.1-flash-tts-preview";
const MAX_CHUNK = 1100;

const LANGUAGE_NAMES: Record<string, string> = {
  "pt-BR": "português do Brasil",
  "pt-PT": "português europeu",
  en: "inglês",
  es: "espanhol",
  fr: "francês",
  it: "italiano",
  de: "alemão",
};

function chunkText(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?…]+[.!?…]*\s*/g) ?? [clean];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    let piece = sentence;
    while (piece.length > MAX_CHUNK) {
      if (current) {
        chunks.push(current.trim());
        current = "";
      }
      chunks.push(piece.slice(0, MAX_CHUNK).trim());
      piece = piece.slice(MAX_CHUNK);
    }
    if ((current + piece).length > MAX_CHUNK) {
      if (current.trim()) chunks.push(current.trim());
      current = piece;
    } else {
      current += piece;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

/** Extract raw PCM samples from a RIFF/WAVE buffer. */
function pcmFromWav(buffer: ArrayBuffer): Uint8Array {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length < 12 || String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF") {
    return bytes;
  }
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === "data") return bytes.slice(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  return bytes;
}

function wavFromPcm(pcm: Uint8Array, sampleRate = 24000): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const writeStr = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) out[offset + i] = value.charCodeAt(i);
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

export const Route = createFileRoute("/api/speech")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) {
          return Response.json({ error: "Serviço de voz não configurado." }, { status: 401 });
        }

        let payload: { text?: string; voice?: string; language?: string };
        try {
          payload = await request.json();
        } catch {
          return Response.json({ error: "Requisição inválida." }, { status: 400 });
        }

        const voice = payload.voice?.trim() || "Kore";
        const language = payload.language && LANGUAGE_NAMES[payload.language] ? payload.language : "";
        const chunks = chunkText(payload.text ?? "");
        if (chunks.length === 0) {
          return Response.json({ error: "Nenhum texto para ler nesta página." }, { status: 400 });
        }

        const parts: Uint8Array[] = [];
        for (const chunk of chunks) {
          const spoken = language
            ? `Leia o texto a seguir em voz alta em ${LANGUAGE_NAMES[language]}, com ritmo natural e claro: ${chunk}`
            : `Leia o texto a seguir em voz alta no mesmo idioma em que ele está escrito, com ritmo natural e claro: ${chunk}`;

          const upstream = await fetch(`${BASE_URL}/v1/audio/speech`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: MODEL,
              contents: [{ role: "user", parts: [{ text: spoken }] }],
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
              },
              stream_format: "audio",
            }),
          });

          if (!upstream.ok) {
            const body = await upstream.text();
            console.error(`Speech request failed [${upstream.status}]: ${body}`);
            const message =
              upstream.status === 429
                ? "Muitas leituras em pouco tempo. Aguarde alguns segundos e tente de novo."
                : upstream.status === 402
                  ? "Os créditos de voz acabaram. Adicione créditos para continuar ouvindo."
                  : `A geração de áudio falhou (${upstream.status}).`;
            return Response.json({ error: message }, { status: upstream.status });
          }

          parts.push(pcmFromWav(await upstream.arrayBuffer()));
        }

        const total = parts.reduce((sum, part) => sum + part.length, 0);
        const pcm = new Uint8Array(total);
        let offset = 0;
        for (const part of parts) {
          pcm.set(part, offset);
          offset += part.length;
        }

        const wav = wavFromPcm(pcm);
        return new Response(wav.buffer as ArrayBuffer, {
          status: 200,
          headers: { "Content-Type": "audio/wav", "Cache-Control": "no-cache" },
        });
      },
    },
  },
});
