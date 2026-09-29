<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Leitura em voz alta
- Texto de PDF/DOCX/TXT é extraído no navegador (`src/lib/documents.ts`); o servidor nunca recebe o arquivo, só o texto da página — mantém uploads fora do backend.
- A síntese de voz roda em `src/routes/api/speech.ts`, que junta os trechos em um único WAV; o MP3 é convertido no navegador (`src/lib/audio.ts`) para permitir download nos dois formatos.
