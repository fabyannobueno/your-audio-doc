import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { detectLanguage, extractFile, paginatePlainText, type DocPage } from "@/lib/documents";
import { downloadBlob, safeFileName, wavToMp3Blob } from "@/lib/audio";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VozLeitor — leia PDFs e documentos em voz alta" },
      {
        name: "description",
        content:
          "Abra PDF, Word, TXT ou texto colado, ouça a leitura em voz natural e baixe o áudio em MP3 ou WAV.",
      },
      { property: "og:title", content: "VozLeitor — leia PDFs e documentos em voz alta" },
      {
        property: "og:description",
        content: "Leitura em voz alta de documentos com controles de página e download em MP3 ou WAV.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const LANGUAGES = [
  { value: "auto", label: "Detectar automaticamente" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "pt-PT", label: "Português (Portugal)" },
  { value: "en", label: "Inglês" },
  { value: "es", label: "Espanhol" },
  { value: "fr", label: "Francês" },
  { value: "it", label: "Italiano" },
  { value: "de", label: "Alemão" },
];

const VOICES = [
  { value: "Kore", label: "Kore — firme" },
  { value: "Puck", label: "Puck — animada" },
  { value: "Charon", label: "Charon — grave" },
  { value: "Aoede", label: "Aoede — suave" },
  { value: "Zephyr", label: "Zephyr — clara" },
];

const LANGUAGE_LABEL: Record<string, string> = Object.fromEntries(
  LANGUAGES.map((l) => [l.value, l.label]),
);

function Index() {
  const [pages, setPages] = useState<DocPage[]>([]);
  const [docName, setDocName] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [pasted, setPasted] = useState("");
  const [language, setLanguage] = useState("auto");
  const [detected, setDetected] = useState("pt-BR");
  const [voice, setVoice] = useState("Kore");
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bufferRef = useRef<ArrayBuffer | null>(null);
  const urlRef = useRef<string | null>(null);
  const cacheKeyRef = useRef<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentPage = pages[pageIndex]?.text ?? "";
  const totalPages = pages.length;
  const cacheKey = `${pageIndex}|${language}|${voice}|${currentPage.slice(0, 40)}|${currentPage.length}`;

  const resetAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    bufferRef.current = null;
    cacheKeyRef.current = "";
    setPlaying(false);
    setProgress(0);
  }, []);

  useEffect(() => () => resetAudio(), [resetAudio]);

  // Trocar de página, idioma ou voz invalida o áudio já gerado.
  useEffect(() => {
    if (cacheKeyRef.current && cacheKeyRef.current !== cacheKey) resetAudio();
  }, [cacheKey, resetAudio]);

  const effectiveLanguage = language === "auto" ? detected : language;

  const loadPages = useCallback((newPages: DocPage[], name: string) => {
    const usable = newPages.filter((p) => p.text.trim().length > 0);
    if (usable.length === 0) {
      toast.error("Não encontrei texto neste arquivo. Ele pode ser um PDF digitalizado (imagem).");
      return;
    }
    setPages(usable);
    setDocName(name);
    setPageIndex(0);
    setDetected(detectLanguage(usable.map((p) => p.text).join(" ").slice(0, 4000)));
  }, []);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    resetAudio();
    setLoadingDoc(true);
    try {
      loadPages(await extractFile(file), file.name);
      toast.success("Documento carregado.");
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Não consegui ler este arquivo.");
    } finally {
      setLoadingDoc(false);
    }
  };

  const usePastedText = () => {
    if (!pasted.trim()) return;
    resetAudio();
    loadPages(paginatePlainText(pasted), "texto-colado");
  };

  const ensureAudio = useCallback(async (): Promise<HTMLAudioElement | null> => {
    if (audioRef.current && cacheKeyRef.current === cacheKey) return audioRef.current;
    if (!currentPage.trim()) {
      toast.error("Esta página não tem texto para ler.");
      return null;
    }

    setGenerating(true);
    try {
      const response = await fetch("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: currentPage,
          voice,
          language: language === "auto" ? detected : language,
        }),
      });

      if (!response.ok) {
        let message = `Não consegui gerar o áudio (${response.status}).`;
        try {
          const data = (await response.json()) as { error?: string };
          if (data.error) message = data.error;
        } catch {
          /* resposta sem JSON */
        }
        toast.error(message);
        return null;
      }

      const buffer = await response.arrayBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
      const audio = new Audio(url);
      audio.addEventListener("timeupdate", () => {
        setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
      });
      audio.addEventListener("ended", () => {
        setPlaying(false);
        setProgress(1);
      });

      bufferRef.current = buffer;
      urlRef.current = url;
      audioRef.current = audio;
      cacheKeyRef.current = cacheKey;
      return audio;
    } catch (error) {
      console.error(error);
      toast.error("Falha de conexão ao gerar o áudio.");
      return null;
    } finally {
      setGenerating(false);
    }
  }, [cacheKey, currentPage, detected, language, voice]);

  const togglePlay = async () => {
    if (audioRef.current && cacheKeyRef.current === cacheKey && playing) {
      audioRef.current.pause();
      setPlaying(false);
      return;
    }
    const audio = await ensureAudio();
    if (!audio) return;
    await audio.play();
    setPlaying(true);
  };

  const restart = async () => {
    const audio = audioRef.current && cacheKeyRef.current === cacheKey ? audioRef.current : await ensureAudio();
    if (!audio) return;
    audio.currentTime = 0;
    await audio.play();
    setPlaying(true);
  };

  const goToPage = (next: number) => {
    if (next < 0 || next >= totalPages) return;
    resetAudio();
    setPageIndex(next);
  };

  const download = async (format: "wav" | "mp3") => {
    const audio = await ensureAudio();
    if (!audio || !bufferRef.current) return;
    const base = `${safeFileName(docName)}-pagina-${pageIndex + 1}`;
    if (format === "wav") {
      downloadBlob(new Blob([bufferRef.current], { type: "audio/wav" }), `${base}.wav`);
    } else {
      downloadBlob(wavToMp3Blob(bufferRef.current), `${base}.mp3`);
    }
    toast.success(`Áudio salvo em ${format.toUpperCase()}.`);
  };

  const busy = generating || loadingDoc;
  const hasDoc = totalPages > 0;
  const languageNote = useMemo(
    () => (language === "auto" ? `detectado: ${LANGUAGE_LABEL[detected] ?? detected}` : ""),
    [language, detected],
  );

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-28 pt-10">
      <Toaster position="top-center" />

      <header className="text-center">
        <h1 className="text-4xl leading-tight text-foreground sm:text-5xl">VozLeitor</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Abra um PDF, Word, TXT ou cole um texto. Ouça em voz natural e salve o áudio em MP3 ou WAV.
        </p>
      </header>

      <section className="surface mt-8 p-5">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,.markdown,.csv,text/plain"
          className="hidden"
          onChange={(event) => onFile(event.target.files?.[0])}
        />
        <Button
          size="lg"
          className="w-full"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          {loadingDoc ? <Loader2 className="animate-spin" /> : <Upload />}
          Escolher documento
        </Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">PDF, DOCX, TXT ou Markdown</p>

        <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-widest text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          ou cole o texto
          <span className="h-px flex-1 bg-border" />
        </div>

        <Textarea
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
          placeholder="Cole aqui qualquer texto que você queira ouvir…"
          className="min-h-28 resize-y bg-background"
        />
        <Button variant="secondary" className="mt-3 w-full" disabled={!pasted.trim()} onClick={usePastedText}>
          <FileText />
          Usar este texto
        </Button>
      </section>

      <section className="surface mt-5 grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Idioma</label>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="mt-1.5 w-full bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {languageNote && <p className="mt-1.5 text-xs text-muted-foreground">{languageNote}</p>}
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Voz</label>
          <Select value={voice} onValueChange={setVoice}>
            <SelectTrigger className="mt-1.5 w-full bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VOICES.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {hasDoc && (
        <section className="surface mt-5 p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-medium text-foreground">{docName}</p>
            <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground">
              Página {pageIndex + 1} de {totalPages}
            </span>
          </div>

          <div className="mt-4 max-h-80 overflow-y-auto whitespace-pre-wrap reading-text">
            {currentPage || "(página sem texto)"}
          </div>

          <div className="mt-5 flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Página anterior"
              disabled={pageIndex === 0}
              onClick={() => goToPage(pageIndex - 1)}
            >
              <ChevronLeft />
            </Button>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" aria-label="Recomeçar" disabled={busy} onClick={restart}>
                <RotateCcw />
              </Button>
              <Button
                size="lg"
                className="h-14 w-14 rounded-full p-0"
                aria-label={playing ? "Pausar" : "Ouvir"}
                disabled={busy}
                onClick={togglePlay}
              >
                {generating ? (
                  <Loader2 className="size-6 animate-spin" />
                ) : playing ? (
                  <Pause className="size-6" />
                ) : (
                  <Play className="size-6" />
                )}
              </Button>
            </div>

            <Button
              variant="outline"
              size="icon"
              aria-label="Próxima página"
              disabled={pageIndex >= totalPages - 1}
              onClick={() => goToPage(pageIndex + 1)}
            >
              <ChevronRight />
            </Button>
          </div>

          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <Button variant="secondary" disabled={busy} onClick={() => download("mp3")}>
              <Download />
              Salvar MP3
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => download("wav")}>
              <Download />
              Salvar WAV
            </Button>
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            O áudio salvo é o da página atual.
          </p>
        </section>
      )}
    </main>
  );
}
