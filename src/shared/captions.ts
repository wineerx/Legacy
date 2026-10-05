export const CAPTION_PRESETS = [
  { id: 'humor', title: 'Humor · identificação', text: 'Quando [situação do vídeo] acontece e você tenta manter a pose 😂\nQual parte mais te representa?' },
  { id: 'curiosity', title: 'Curiosidade · explicação', text: 'Você já tinha reparado em [detalhe]?\nO que acontece aqui é [explicação verificada].\nQual detalhe você acrescentaria?' },
  { id: 'clip', title: 'Corte · contexto', text: '[Pessoa/tema] explica [ideia central] em poucos segundos.\nContexto: [resumo fiel ao vídeo].\nFonte e créditos: [origem autorizada].' },
  { id: 'discussion', title: 'Discussão · opinião', text: '[Pergunta diretamente ligada ao conteúdo]?\nMinha leitura: [seu ponto de vista].\nO que você pensa sobre isso?' },
  { id: 'useful', title: 'Utilidade · resumo', text: '3 pontos para lembrar sobre [tema]:\n1. [ponto]\n2. [ponto]\n3. [ponto]\nSalve se este resumo for útil para você.' },
  { id: 'series', title: 'Série · continuidade', text: '[Nome da série] · episódio [número]\nHoje: [tema do vídeo].\nQual assunto merece o próximo episódio?' },
  { id: 'story', title: 'História · narrativa', text: 'Tudo começou quando [contexto real].\nO detalhe que mudou a história foi [fato verificado].\nVocê imaginava esse desfecho?' },
  { id: 'simple', title: 'Direta · poucas palavras', text: '[Uma frase que descreve o momento].\n[Créditos ou contexto necessário].' }
] as const

export const REFERENCE_PROFILES = ['peter.memes7', 'zanon.boss', 'tvred_hot', 'oindomavelx', 'curioso.dark', 'morroclip'].map((username) => ({ username, url: `https://www.instagram.com/${username}/` }))
