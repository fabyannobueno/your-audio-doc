export type DocPage = { text: string };

const PLAIN_CHARS_PER_PAGE = 1800;

export function paginatePlainText(text: string): DocPage[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const pages: DocPage[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && (current + "\n\n" + paragraph).length > PLAIN_CHARS_PER_PAGE) {
      pages.push({ text: current });
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current.trim()) pages.push({ text: current });
  return pages.length ? pages : [{ text: text.trim() }];
}

export async function extractPdf(file: File): Promise<DocPage[]> {
  const pdfjs = await import("pdfjs-dist");
  const workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: DocPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push({ text });
  }
  return pages;
}

export async function extractDocx(file: File): Promise<DocPage[]> {
  const mammoth = await import("mammoth/mammoth.browser.js");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return paginatePlainText(result.value);
}

export async function extractFile(file: File): Promise<DocPage[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return extractPdf(file);
  if (name.endsWith(".docx")) return extractDocx(file);
  if (name.endsWith(".doc")) throw new Error("Arquivos .doc antigos não são suportados. Salve como .docx ou PDF.");
  return paginatePlainText(await file.text());
}

const HINTS: Record<string, string[]> = {
  "pt-BR": ["que", "não", "uma", "para", "com", "são", "está", "você", "também", "ção"],
  en: ["the", "and", "with", "that", "this", "from", "have", "which", "been"],
  es: ["que", "los", "una", "para", "con", "pero", "está", "también", "porque"],
  fr: ["les", "des", "une", "pour", "avec", "dans", "est", "vous", "être"],
  it: ["che", "gli", "una", "per", "con", "sono", "anche", "della"],
  de: ["und", "der", "die", "das", "nicht", "eine", "ist", "mit", "auch"],
};

export function detectLanguage(text: string): string {
  const words = text.toLowerCase().match(/[a-zà-ÿ]+/g)?.slice(0, 600) ?? [];
  if (words.length < 10) return "pt-BR";
  let best = "pt-BR";
  let bestScore = -1;
  for (const [code, hints] of Object.entries(HINTS)) {
    const score = words.filter((w) => hints.includes(w)).length + (code === "pt-BR" && /ção|ãо|ções|ável/.test(text) ? 3 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = code;
    }
  }
  return best;
}
