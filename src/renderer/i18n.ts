/**
 * Lightweight i18n system — zero dependencies, maximum performance.
 * Simple dictionary lookup with fallback to English.
 */

import { useSessionStore } from './stores/sessionStore'

export type AppLanguage = 'en' | 'pt-BR'

const translations: Record<AppLanguage, Record<string, string>> = {
  'en': {
    // ─── General ───
    'app.name': 'Clui CC',
    'general.copy': 'Copy',
    'general.close': 'Close',
    'general.cancel': 'Cancel',
    'general.save': 'Save',
    'general.saved': 'Saved!',
    'general.error': 'Error',
    'general.remove': 'Remove',
    'general.installed': 'Installed',
    'general.install': 'Install',
    'general.download': 'Download',
    'general.downloading': 'Downloading...',
    'general.search': 'Search...',
    'general.none': 'None',

    // ─── Tab Strip ───
    'tabs.new': 'New tab',
    'tabs.rc.show': 'Show Remote Control URL',

    // ─── Input Bar ───
    'input.placeholder': 'Type a message...',
    'input.placeholder.busy': 'Running...',
    'input.placeholder.connecting': 'Connecting...',
    'input.placeholder.plan': 'Describe your plan...',
    'input.send': 'Send',
    'input.stop': 'Stop',
    'input.voice.start': 'Start voice recording',
    'input.voice.stop': 'Stop recording',

    // ─── Conversation View ───
    'chat.empty.title': 'What can I help you with?',
    'chat.empty.subtitle': 'Ask me anything or use / for commands',
    'chat.copy': 'Copy response',
    'chat.tool.running': 'Running...',
    'chat.tool.completed': 'Completed',
    'chat.tool.error': 'Error',
    'chat.session.ended': 'Session ended unexpectedly',
    'chat.session.exit': 'Process exited',
    'chat.permission.title': 'Permission Request',
    'chat.permission.denied': 'Permission denied',
    'chat.rate.limit': 'Rate limited',

    // ─── Status Bar ───
    'status.dir.choose': 'Using home directory by default — click to choose a folder',
    'status.dir.add': 'Add directory...',
    'status.terminal': 'Open in CLI',
    'status.terminal.title': 'Open this session in Terminal',
    'status.context': 'Context window',

    // ─── Settings ───
    'settings.title': 'Settings',
    'settings.about': 'About & Updates',
    'settings.shortcuts': 'Shortcuts',
    'settings.shortcuts.global': 'Global shortcut',
    'settings.shortcuts.secondary': 'Secondary shortcut',
    'settings.shortcuts.transcription': 'Transcription shortcut',
    'settings.shortcuts.press': 'Press keys...',
    'settings.shortcuts.clear': 'Clear',
    'settings.appearance': 'Appearance',
    'settings.appearance.theme': 'Theme',
    'settings.appearance.theme.system': 'System',
    'settings.appearance.theme.dark': 'Dark',
    'settings.appearance.theme.light': 'Light',
    'settings.appearance.zoom': 'Zoom',
    'settings.appearance.sound': 'Sound effects',
    'settings.appearance.expanded': 'Expanded UI',
    'settings.startup': 'Startup',
    'settings.startup.auto': 'Start with Windows',
    'settings.startup.hidden': 'Start hidden',
    'settings.language': 'Language',
    'settings.language.app': 'App language',
    'settings.language.responses': 'Response language',
    'settings.language.responses.auto': 'Auto (match input)',
    'settings.whisper': 'Transcription',
    'settings.whisper.model': 'Model',
    'settings.whisper.language': 'Language',
    'settings.whisper.device': 'Device',
    'settings.whisper.device.auto': 'Auto (GPU if available)',
    'settings.whisper.device.gpu.detected': 'GPU',
    'settings.whisper.device.gpu.none': 'GPU (no NVIDIA detected)',
    'settings.whisper.device.cpu': 'CPU',
    'settings.whisper.gpu.title': 'GPU Acceleration',
    'settings.whisper.gpu.download': 'Download CUDA (~700MB)',
    'settings.whisper.gpu.downloading': 'Downloading (~700MB)...',
    'settings.rules': 'Global Rules (CLAUDE.md)',
    'settings.rules.placeholder': 'Add custom instructions for Claude...',
    'settings.mic': 'Microphone',
    'settings.mic.default': 'Default microphone',
    'settings.update.check': 'Check for update',
    'settings.update.checking': 'Checking...',
    'settings.update.upToDate': 'Up to date',
    'settings.update.available': 'Update available',
    'settings.update.download': 'Download update',
    'settings.update.downloading': 'Downloading...',
    'settings.update.install': 'Install & restart',
    'settings.update.error': 'Update error',

    // ─── History ───
    'history.title': 'Recent Sessions',
    'history.empty': 'No recent sessions',
    'history.resume': 'Resume session',

    // ─── Marketplace ───
    'marketplace.title': 'Marketplace',
    'marketplace.search': 'Search skills, tags, authors...',
    'marketplace.tab.all': 'All',
    'marketplace.tab.installed': 'Installed',
    'marketplace.installing': 'Installing...',
    'marketplace.failed': 'Failed',

    // ─── Usage Panel ───
    'usage.title': 'Usage',
    'usage.cost': 'Cost',
    'usage.duration': 'Duration',
    'usage.turns': 'Turns',
    'usage.tokens.input': 'Input tokens',
    'usage.tokens.output': 'Output tokens',
    'usage.session': 'Session usage',
    'usage.cumulative': 'Cumulative',

    // ─── Slash Commands ───
    'cmd.clear': 'Clear conversation history',
    'cmd.cost': 'Show token usage and cost',
    'cmd.model': 'Show current model info',
    'cmd.mcp': 'Show MCP server status',
    'cmd.skills': 'Show available skills',
    'cmd.help': 'Show available commands',
    'cmd.config': 'Open settings',
    'cmd.compact': 'Compact conversation context',
    'cmd.memory': 'Edit CLAUDE.md rules',
    'cmd.status': 'Show session status',
    'cmd.permissions': 'Change permission mode',
    'cmd.init': 'Generate CLAUDE.md for project',
    'cmd.login': 'Authenticate with Anthropic',
    'cmd.logout': 'Sign out',
    'cmd.doctor': 'Run diagnostics',
    'cmd.bug': 'Report a bug',

    // ─── Remote Control ───
    'rc.title': 'Remote Control',
    'rc.subtitle': 'Access this session from another device:',
    'rc.copy': 'Copy URL',
    'rc.on': 'Remote control ON — click to stop',
    'rc.connecting': 'Remote control connecting...',
    'rc.start': 'Start remote control',
    'rc.noSession': 'Send a message first to start a session',
    'rc.failed': 'Remote Control failed to start',

    // ─── Setup / Onboarding ───
    'setup.cli.missing.title': 'Claude Code CLI not found',
    'setup.cli.missing.subtitle': 'Clui CC requires Claude Code CLI to work. Install it with npm:',
    'setup.cli.missing.command': 'npm install -g @anthropic-ai/claude-code',
    'setup.cli.missing.copy': 'Copy command',
    'setup.cli.missing.docs': 'View documentation',
    'setup.cli.missing.retry': 'Retry detection',
    'setup.cli.missing.prereq': 'Requires Node.js 18+',
    'setup.auth.missing.title': 'Authentication required',
    'setup.auth.missing.subtitle': 'Sign in to your Anthropic account to start using Claude.',
    'setup.auth.login': 'Sign in with Anthropic',
    'setup.auth.apikey': 'Or set ANTHROPIC_API_KEY environment variable',
    'setup.auth.retry': 'Retry',

    // ─── Permission Modes ───
    'mode.plan': 'Plan',
    'mode.ask': 'Ask',
    'mode.acceptEdits': 'Accept Edits',
    'mode.auto': 'Auto',
    'mode.dontAsk': "Don't Ask",
    'mode.bypass': 'Bypass',
  },

  'pt-BR': {
    // ─── Geral ───
    'app.name': 'Clui CC',
    'general.copy': 'Copiar',
    'general.close': 'Fechar',
    'general.cancel': 'Cancelar',
    'general.save': 'Salvar',
    'general.saved': 'Salvo!',
    'general.error': 'Erro',
    'general.remove': 'Remover',
    'general.installed': 'Instalado',
    'general.install': 'Instalar',
    'general.download': 'Baixar',
    'general.downloading': 'Baixando...',
    'general.search': 'Buscar...',
    'general.none': 'Nenhum',

    // ─── Abas ───
    'tabs.new': 'Nova aba',
    'tabs.rc.show': 'Mostrar URL do Controle Remoto',

    // ─── Barra de Entrada ───
    'input.placeholder': 'Digite uma mensagem...',
    'input.placeholder.busy': 'Executando...',
    'input.placeholder.connecting': 'Conectando...',
    'input.placeholder.plan': 'Descreva seu plano...',
    'input.send': 'Enviar',
    'input.stop': 'Parar',
    'input.voice.start': 'Iniciar gravação de voz',
    'input.voice.stop': 'Parar gravação',

    // ─── Conversa ───
    'chat.empty.title': 'Como posso ajudar?',
    'chat.empty.subtitle': 'Pergunte qualquer coisa ou use / para comandos',
    'chat.copy': 'Copiar resposta',
    'chat.tool.running': 'Executando...',
    'chat.tool.completed': 'Concluído',
    'chat.tool.error': 'Erro',
    'chat.session.ended': 'Sessão encerrada inesperadamente',
    'chat.session.exit': 'Processo encerrado',
    'chat.permission.title': 'Solicitação de Permissão',
    'chat.permission.denied': 'Permissão negada',
    'chat.rate.limit': 'Limite de requisições atingido',

    // ─── Barra de Status ───
    'status.dir.choose': 'Usando diretório padrão — clique para escolher uma pasta',
    'status.dir.add': 'Adicionar diretório...',
    'status.terminal': 'Abrir no CLI',
    'status.terminal.title': 'Abrir esta sessão no Terminal',
    'status.context': 'Janela de contexto',

    // ─── Configurações ───
    'settings.title': 'Configurações',
    'settings.about': 'Sobre e Atualizações',
    'settings.shortcuts': 'Atalhos',
    'settings.shortcuts.global': 'Atalho global',
    'settings.shortcuts.secondary': 'Atalho secundário',
    'settings.shortcuts.transcription': 'Atalho de transcrição',
    'settings.shortcuts.press': 'Pressione as teclas...',
    'settings.shortcuts.clear': 'Limpar',
    'settings.appearance': 'Aparência',
    'settings.appearance.theme': 'Tema',
    'settings.appearance.theme.system': 'Sistema',
    'settings.appearance.theme.dark': 'Escuro',
    'settings.appearance.theme.light': 'Claro',
    'settings.appearance.zoom': 'Zoom',
    'settings.appearance.sound': 'Efeitos sonoros',
    'settings.appearance.expanded': 'Interface expandida',
    'settings.startup': 'Inicialização',
    'settings.startup.auto': 'Iniciar com o Windows',
    'settings.startup.hidden': 'Iniciar minimizado',
    'settings.language': 'Idioma',
    'settings.language.app': 'Idioma do app',
    'settings.language.responses': 'Idioma das respostas',
    'settings.language.responses.auto': 'Automático (seguir entrada)',
    'settings.whisper': 'Transcrição',
    'settings.whisper.model': 'Modelo',
    'settings.whisper.language': 'Idioma',
    'settings.whisper.device': 'Dispositivo',
    'settings.whisper.device.auto': 'Automático (GPU se disponível)',
    'settings.whisper.device.gpu.detected': 'GPU',
    'settings.whisper.device.gpu.none': 'GPU (NVIDIA não detectada)',
    'settings.whisper.device.cpu': 'CPU',
    'settings.whisper.gpu.title': 'Aceleração GPU',
    'settings.whisper.gpu.download': 'Baixar CUDA (~700MB)',
    'settings.whisper.gpu.downloading': 'Baixando (~700MB)...',
    'settings.rules': 'Regras Globais (CLAUDE.md)',
    'settings.rules.placeholder': 'Adicione instruções personalizadas para o Claude...',
    'settings.mic': 'Microfone',
    'settings.mic.default': 'Microfone padrão',
    'settings.update.check': 'Verificar atualização',
    'settings.update.checking': 'Verificando...',
    'settings.update.upToDate': 'Atualizado',
    'settings.update.available': 'Atualização disponível',
    'settings.update.download': 'Baixar atualização',
    'settings.update.downloading': 'Baixando...',
    'settings.update.install': 'Instalar e reiniciar',
    'settings.update.error': 'Erro na atualização',

    // ─── Histórico ───
    'history.title': 'Sessões Recentes',
    'history.empty': 'Nenhuma sessão recente',
    'history.resume': 'Retomar sessão',

    // ─── Marketplace ───
    'marketplace.title': 'Marketplace',
    'marketplace.search': 'Buscar skills, tags, autores...',
    'marketplace.tab.all': 'Todos',
    'marketplace.tab.installed': 'Instalados',
    'marketplace.installing': 'Instalando...',
    'marketplace.failed': 'Falhou',

    // ─── Painel de Uso ───
    'usage.title': 'Uso',
    'usage.cost': 'Custo',
    'usage.duration': 'Duração',
    'usage.turns': 'Turnos',
    'usage.tokens.input': 'Tokens de entrada',
    'usage.tokens.output': 'Tokens de saída',
    'usage.session': 'Uso da sessão',
    'usage.cumulative': 'Acumulado',

    // ─── Comandos Slash ───
    'cmd.clear': 'Limpar histórico da conversa',
    'cmd.cost': 'Mostrar uso de tokens e custo',
    'cmd.model': 'Mostrar informações do modelo',
    'cmd.mcp': 'Mostrar status dos servidores MCP',
    'cmd.skills': 'Mostrar skills disponíveis',
    'cmd.help': 'Mostrar comandos disponíveis',
    'cmd.config': 'Abrir configurações',
    'cmd.compact': 'Compactar contexto da conversa',
    'cmd.memory': 'Editar regras CLAUDE.md',
    'cmd.status': 'Mostrar status da sessão',
    'cmd.permissions': 'Alterar modo de permissão',
    'cmd.init': 'Gerar CLAUDE.md para o projeto',
    'cmd.login': 'Autenticar com a Anthropic',
    'cmd.logout': 'Sair da conta',
    'cmd.doctor': 'Executar diagnósticos',
    'cmd.bug': 'Reportar um bug',

    // ─── Controle Remoto ───
    'rc.title': 'Controle Remoto',
    'rc.subtitle': 'Acesse esta sessão de outro dispositivo:',
    'rc.copy': 'Copiar URL',
    'rc.on': 'Controle remoto ATIVO — clique para parar',
    'rc.connecting': 'Controle remoto conectando...',
    'rc.start': 'Iniciar controle remoto',
    'rc.noSession': 'Envie uma mensagem primeiro para iniciar uma sessão',
    'rc.failed': 'Falha ao iniciar o Controle Remoto',

    // ─── Setup / Onboarding ───
    'setup.cli.missing.title': 'Claude Code CLI não encontrado',
    'setup.cli.missing.subtitle': 'O Clui CC precisa do Claude Code CLI para funcionar. Instale via npm:',
    'setup.cli.missing.command': 'npm install -g @anthropic-ai/claude-code',
    'setup.cli.missing.copy': 'Copiar comando',
    'setup.cli.missing.docs': 'Ver documentação',
    'setup.cli.missing.retry': 'Tentar novamente',
    'setup.cli.missing.prereq': 'Requer Node.js 18+',
    'setup.auth.missing.title': 'Autenticação necessária',
    'setup.auth.missing.subtitle': 'Entre na sua conta Anthropic para começar a usar o Claude.',
    'setup.auth.login': 'Entrar com a Anthropic',
    'setup.auth.apikey': 'Ou defina a variável de ambiente ANTHROPIC_API_KEY',
    'setup.auth.retry': 'Tentar novamente',

    // ─── Modos de Permissão ───
    'mode.plan': 'Planejar',
    'mode.ask': 'Perguntar',
    'mode.acceptEdits': 'Aceitar Edições',
    'mode.auto': 'Automático',
    'mode.dontAsk': 'Não Perguntar',
    'mode.bypass': 'Ignorar',
  },
}

/**
 * Get translated string by key. Falls back to English, then to the key itself.
 */
export function t(key: string, lang?: AppLanguage): string {
  const language = lang || useSessionStore.getState().appLanguage || 'en'
  return translations[language]?.[key] || translations['en'][key] || key
}

/**
 * React hook for translations — re-renders when language changes.
 */
export function useT(): (key: string) => string {
  const lang = useSessionStore((s) => s.appLanguage)
  return (key: string) => translations[lang]?.[key] || translations['en'][key] || key
}

export const AVAILABLE_LANGUAGES: Array<{ id: AppLanguage; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'pt-BR', label: 'Português (Brasil)' },
]
