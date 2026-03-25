# Design Completo: 3 Melhorias Críticas do CLUI

**Data:** 2026-03-24
**Versão:** 2.0 (plano definitivo)

---

## Visão Geral

Três frentes de melhoria independentes, cada uma atacando um problema real:

1. **StatusBar** — i18n quebrado, UI mal acabada
2. **Indicador de Contexto** — "0" solto, sem temas, sem tooltip
3. **CLI Passthrough + Marketplace Completo** — comandos não funcionam, marketplace limitado

---

## 1. StatusBar — i18n e UI Polish

### Problema
- `t('status.dir.change')` retorna a chave literal `"status.dir.change"` porque a chave não existe no `i18n.ts`
- O fallback `|| 'Change directory'` nunca executa (string não-vazia = truthy)
- Label "Base directory" hardcoded sem i18n (linha 595)

### Solução

**`src/renderer/i18n.ts`:**
- Adicionar `'status.dir.change': 'Change directory'` (EN)
- Adicionar `'status.dir.change': 'Alterar diretório'` (PT-BR)
- Adicionar `'status.dir.base': 'Base directory'` / `'Diretório base'`
- Adicionar `'status.dir.none': 'None (defaults to claude-default)'` / `'Nenhum (usa claude-default)'`

**`src/renderer/components/StatusBar.tsx`:**
- Linha 595: `"Base directory"` → `{t('status.dir.base')}`
- Linha 598: textos hardcoded → usar chaves i18n
- Linha 611: manter `t('status.dir.change')` (agora a chave existe)

### Estimativa: ~10 min

---

## 2. Indicador de Contexto — Sempre Visível, Tematizado, Informativo

### Problema
- Mostra "0" sem `%`, sem label, sem explicação
- Cores hardcoded (`#ef4444`, `#f59e0b`) ignoram o tema ativo
- Condição `input_tokens > 0` faz o indicador sumir no estado inicial, mas em certos estados mostra "0" solto
- Sem diferença visual entre tema claro e escuro

### Solução

**`src/renderer/theme.ts` — Novos tokens:**
```ts
// Em darkColors:
contextLow: '#8a8a80',      // cinza neutro (0-59%)
contextMedium: '#d4a54a',   // âmbar quente
contextHigh: '#c47060',     // vermelho do tema
contextTrack: 'rgba(138, 138, 128, 0.15)',

// Em lightColors:
contextLow: '#8a8578',
contextMedium: '#b8860b',
contextHigh: '#c0392b',
contextTrack: 'rgba(90, 87, 73, 0.12)',
```

**`src/renderer/components/StatusBar.tsx` — Refatorar bloco (linhas 631-654):**

Comportamento novo:
- **Sempre visível** — mesmo sem mensagens (mostra 0%)
- **Sempre com `%`** — nunca número solto
- **Tooltip humanizado**: "Uso do contexto: 0% — nenhuma mensagem enviada" / "Uso do contexto: 45% (90k de 200k tokens)"
- **Cores do tema** via `colors.contextLow/Medium/High`
- **Barra de progresso** usa `colors.contextTrack` como fundo

```tsx
{(() => {
  const inputTokens = tab.lastResult?.usage?.input_tokens ?? 0
  const contextLimit = 200_000
  const pct = Math.min(100, Math.round((inputTokens / contextLimit) * 100))
  const color = pct >= 80 ? colors.contextHigh
    : pct >= 60 ? colors.contextMedium
    : colors.contextLow

  const tooltipText = inputTokens > 0
    ? `${t('status.context')}: ${pct}% (${formatTokenCount(inputTokens)} / ${formatTokenCount(contextLimit)} tokens)`
    : `${t('status.context')}: 0% — ${t('status.context.empty')}`

  return (
    <span
      className="text-[10px] tabular-nums flex items-center gap-1"
      style={{ color, opacity: pct >= 60 ? 1 : 0.6 }}
      title={tooltipText}
    >
      {!compact && <span className="text-[9px]" style={{ opacity: 0.8 }}>{t('status.context')}</span>}
      <span style={{
        display: 'inline-block', width: 24, height: 4, borderRadius: 2,
        background: colors.contextTrack, overflow: 'hidden', position: 'relative',
      }}>
        <span style={{
          position: 'absolute', left: 0, top: 0, height: '100%',
          width: `${pct}%`, borderRadius: 2, background: color,
        }} />
      </span>
      {pct}%
    </span>
  )
})()}
```

**`src/renderer/i18n.ts`:**
- `'status.context.empty': 'No messages sent yet'` / `'Nenhuma mensagem enviada ainda'`

### Estimativa: ~20 min

---

## 3. CLI Passthrough + Marketplace Universal

### 3A — CLI Passthrough (qualquer comando `/` funciona)

#### Problema
`executeCommand()` em `InputBar.tsx:182-311` tem um `switch` com 15 cases fixos. Qualquer outro comando (como `/plugin marketplace add X`) é silenciosamente ignorado.

#### Solução — 3 camadas

**Camada 1: Default case no switch**

No `InputBar.tsx`, adicionar `default` case que chama o backend:

```tsx
default: {
  // CLI passthrough — executa qualquer comando não reconhecido via claude CLI
  const fullCommand = cmd.command.replace(/^\//, '')
  // Se o input tinha argumentos (ex: "/plugin marketplace add repo"), incluir
  const args = input.trim().replace(/^\/\S+\s*/, '')
  const cliCommand = args ? `${fullCommand} ${args}` : fullCommand

  addSystemMessage(`⏳ Executando: claude ${cliCommand}...`)
  try {
    const result = await window.clui.executeCliCommand(cliCommand)
    addSystemMessage(result.output || 'Comando executado com sucesso.')
  } catch (err: any) {
    addSystemMessage(`❌ Erro: ${err.message || 'Comando falhou'}`)
  }
  break
}
```

**Camada 2: IPC Handler no backend**

**`src/main/index.ts`** — novo handler:
```ts
ipcMain.handle('CLI_EXECUTE_COMMAND', async (_event, { command }: { command: string }) => {
  // Sanitização: bloquear comandos perigosos
  const blocked = ['rm ', 'del ', 'format ', 'shutdown']
  if (blocked.some(b => command.toLowerCase().startsWith(b))) {
    return { ok: false, output: 'Comando bloqueado por segurança.' }
  }

  const claudePath = getCliPath() // já existe no projeto
  const { stdout, stderr } = await execAsync(`"${claudePath}" ${command}`, { timeout: 30_000 })
  return { ok: true, output: stdout || stderr }
})
```

**Camada 3: Preload bridge**

**`src/preload/index.ts`:**
```ts
executeCliCommand: (command: string) => ipcRenderer.invoke('CLI_EXECUTE_COMMAND', { command })
```

#### Comandos interativos
Alguns comandos do CLI requerem input interativo (ex: `claude config` abre editor). Para esses:
- Timeout de 30s
- Se falhar, mostrar: "Este comando requer terminal interativo. Use 'Open in CLI' na barra de status."

### 3B — Comandos com UI Dedicada

Ao digitar `/`, o menu de slash commands já aparece. Expandir para incluir comandos que abrem UIs ricas:

**Novos entries em `SLASH_COMMANDS` (`SlashCommandMenu.tsx`):**

| Comando | Descrição | Ação |
|---------|-----------|------|
| `/plugin` | Gerenciar plugins | Abre MarketplacePanel |
| `/marketplace` | Abrir marketplace | Abre MarketplacePanel |
| `/theme` | Alternar tema | Cicla dark→light→system |

**No `executeCommand` do `InputBar.tsx`:**
```tsx
case '/plugin':
case '/marketplace':
  window.dispatchEvent(new CustomEvent('clui:open-marketplace'))
  break
case '/theme':
  // Cicla entre temas
  const modes = ['dark', 'light', 'system'] as const
  const current = useThemeStore.getState().themeMode
  const idx = modes.indexOf(current)
  useThemeStore.getState().setThemeMode(modes[(idx + 1) % modes.length])
  addSystemMessage(`Tema: ${current} → ${modes[(idx + 1) % modes.length]}`)
  break
```

**Inteligência no handleSend:**
Se o input começa com `/plugin ` seguido de argumentos (ex: `/plugin marketplace add repo/name`), em vez de abrir o painel, executa via CLI passthrough. O painel só abre quando é `/plugin` ou `/marketplace` sem argumentos.

### 3C — Marketplace Universal (todos os plugins/skills disponíveis)

#### Problema atual
`SOURCES` em `catalog.ts:47-51` é hardcoded com apenas 3 repos Anthropic. O marketplace mostra pouquíssimos plugins.

#### Solução — Fontes múltiplas

**Arquitetura de fontes:**

```
┌──────────────────────────────────────────────┐
│              MARKETPLACE ENGINE              │
├──────────────┬───────────────┬───────────────┤
│  Built-in    │  Custom Repos │  GitHub       │
│  Sources     │  (user adds)  │  Discovery    │
│  (3 Anthropic│  via UI/CLI   │  (search API) │
│   repos)     │               │               │
└──────┬───────┴───────┬───────┴───────┬───────┘
       │               │               │
       ▼               ▼               ▼
   marketplace.json  marketplace.json  topic search
   fetch per repo    fetch per repo    ".claude-plugin"
       │               │               │
       └───────────────┴───────────────┘
                       │
                ┌──────▼──────┐
                │  Unified    │
                │  Catalog    │
                │  (deduped)  │
                └─────────────┘
```

**3C.1 — Custom Repos (input do usuário)**

**`src/main/marketplace/catalog.ts`:**
- Novo: `customSources` persistido em `~/.claude/marketplace-sources.json`
- `addCustomSource(repo: string)` — valida formato owner/repo, testa se tem `marketplace.json`, salva
- `removeCustomSource(repo: string)` — remove da lista
- `listCustomSources()` — retorna lista
- `fetchCatalog()` agora itera `[...SOURCES, ...customSources]`

**IPC + Preload:**
- `MARKETPLACE_ADD_SOURCE` / `MARKETPLACE_REMOVE_SOURCE` / `MARKETPLACE_LIST_SOURCES`

**UI — `MarketplacePanel.tsx`:**
- Novo seção "Sources" no topo do painel com chips dos repos ativos
- Botão "+ Add repo" que abre input inline para digitar `owner/repo`
- Cada chip custom tem botão X para remover
- Os 3 repos Anthropic são fixos (sem X)

**3C.2 — GitHub Discovery (busca automática)**

**`src/main/marketplace/catalog.ts`:**
```ts
async function discoverGitHubPlugins(): Promise<CatalogPlugin[]> {
  // Usa GitHub Search API para encontrar repos com marketplace.json
  const searchUrl = 'https://api.github.com/search/repositories?q=filename:marketplace.json+path:.claude-plugin&sort=stars&per_page=50'
  const res = await netFetch(searchUrl)
  if (!res.ok) return []

  const data = JSON.parse(res.body) as { items: Array<{ full_name: string; stargazers_count: number }> }

  // Filtrar repos já nas sources (evitar duplicatas)
  const existingRepos = new Set([...SOURCES.map(s => s.repo), ...customSources.map(s => s.repo)])
  const newRepos = data.items
    .filter(r => !existingRepos.has(r.full_name))
    .slice(0, 20) // Limitar para performance

  // Fetch marketplace.json de cada repo descoberto
  const plugins: CatalogPlugin[] = []
  for (const repo of newRepos) {
    try {
      // Reutilizar a mesma lógica de fetchCatalog para cada repo
      const result = await fetchSourcePlugins(repo.full_name, 'Community')
      plugins.push(...result)
    } catch {}
  }
  return plugins
}
```

- Discovery roda em background a cada 10 min (não bloqueia abertura do painel)
- Resultados são mergeados no catálogo com category "Community"
- Badge de estrelas do GitHub no card do plugin

**3C.3 — Cache e Refresh**

- `CACHE_TTL`: 5 min → **60 segundos** para repos ativos
- Discovery cache: 10 min (busca mais pesada)
- Botão "Refresh" no painel força `forceRefresh=true`
- Auto-refresh ao abrir o painel (já existe)
- Badge "NEW" em plugins descobertos nas últimas 24h

**3C.4 — UI do Marketplace atualizada**

```
┌─────────────────────────────────────────────────┐
│  🔍 Search plugins...                    [↻]   │
├─────────────────────────────────────────────────┤
│  Sources: [anthropics/skills] [anthropics/kw]   │
│           [anthropics/fs] [+ Add repo]          │
├─────────────────────────────────────────────────┤
│  All │ Agent │ Code │ Design │ Finance │ ...    │
├─────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────┐  │
│  │ 📦 xlsx                          ⭐ 142  │  │
│  │ Create and edit spreadsheets              │  │
│  │ anthropics/skills · Agent Skills          │  │
│  │                          [✓ Installed]    │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │ 📦 claude-mem              🌐 Community  │  │
│  │ Persistent memory across sessions         │  │
│  │ thedotmack/claude-mem · ⭐ 89            │  │
│  │                            [Install]      │  │
│  └───────────────────────────────────────────┘  │
│  ...                                            │
│                                                 │
│  💡 Tip: Use /plugin marketplace add owner/repo │
│     to add sources via CLI too                  │
└─────────────────────────────────────────────────┘
```

---

## Ordem de Implementação

| # | Task | Deps | Estimativa |
|---|------|------|------------|
| 1 | i18n keys (Problema 1) | — | 10 min |
| 2 | Theme tokens contexto (Problema 2a) | — | 5 min |
| 3 | Refatorar indicador de contexto (Problema 2b) | 2 | 15 min |
| 4 | IPC + Preload para CLI passthrough (3A backend) | — | 20 min |
| 5 | Default case no switch + handleSend inteligente (3A frontend) | 4 | 15 min |
| 6 | Novos slash commands com UI (/plugin, /marketplace, /theme) (3B) | — | 10 min |
| 7 | Custom sources persist + API (3C.1 backend) | — | 20 min |
| 8 | GitHub Discovery (3C.2) | 7 | 20 min |
| 9 | MarketplacePanel UI renovada (3C.3+3C.4) | 7, 8 | 30 min |
| 10 | Cache TTL + auto-refresh (3C.3) | 7 | 5 min |

**Paralelizáveis:** Tasks 1, 2, 4, 6, 7 podem rodar em paralelo.

---

## Arquivos Impactados

| Arquivo | Mudanças |
|---------|----------|
| `src/renderer/i18n.ts` | +8 chaves i18n |
| `src/renderer/theme.ts` | +8 tokens de cor (4 dark + 4 light) |
| `src/renderer/components/StatusBar.tsx` | Refatorar contexto + i18n labels |
| `src/renderer/components/InputBar.tsx` | Default case + /plugin + /theme + handleSend |
| `src/renderer/components/SlashCommandMenu.tsx` | +3 comandos |
| `src/renderer/components/MarketplacePanel.tsx` | Sources UI + badges + layout |
| `src/main/marketplace/catalog.ts` | Custom sources + discovery + TTL |
| `src/main/index.ts` | +4 IPC handlers |
| `src/preload/index.ts` | +4 bridge methods |
| `src/shared/types.ts` | Atualizar CatalogPlugin (stars field) |

---

## Riscos e Mitigações

| Risco | Mitigação |
|-------|-----------|
| CLI passthrough com comandos interativos | Timeout 30s + mensagem fallback |
| GitHub API rate limit (60/h sem auth) | Cache discovery 10min, limitar a 50 repos |
| Repos maliciosos no discovery | Validação existente (SAFE_REPO, path traversal) + install requer confirmação |
| marketplace.json inexistente em repo custom | Testar antes de salvar, mostrar erro claro |
