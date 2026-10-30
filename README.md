# Instagram Post Scraper

Extensão para Google Chrome (Manifest V3) que coleta automaticamente os dados dos posts de um perfil do Instagram e exporta o resultado em **CSV**, **JSON** ou **XLSX**.

A extensão abre o primeiro post do perfil, navega de post em post pelo modal do Instagram e extrai, para cada um: link, data de publicação, descrição (legenda) e tipo.

---

## Funcionalidades

- Coleta por **intervalo de posts** (ex.: do post 5 ao 30).
- **Intervalo configurável** entre posts (500 ms a 5 s) para reduzir o risco de bloqueios e dar tempo ao carregamento da página.
- **Pausar, continuar e parar** a coleta a qualquer momento, sem perder o que já foi coletado.
- **Barra de progresso** com contagem de posts coletados e restantes.
- **Detecção do tipo de post**: Reel, Carrossel ou Foto única.
- Navegação resiliente entre posts, com múltiplas estratégias (botão "Próximo" em vários idiomas, posição do botão, teclado e clique na área lateral).
- **Exportação** em CSV (com BOM UTF-8, abre corretamente no Excel), JSON, XLSX e cópia do JSON para a área de transferência.
- O estado fica salvo em `chrome.storage.local`, então o popup pode ser fechado e reaberto durante a coleta.
- Interface em português (pt-BR).

## Dados coletados

| Campo | Descrição |
|---|---|
| `#` | Posição do post na coleta |
| `url` | Link do post |
| `date` | Data de publicação formatada |
| `dateISO` | Data de publicação em formato ISO 8601 |
| `description` | Legenda do post |
| `type` | `Reel`, `Carrossel` ou `Foto única` |
| `collectedAt` | Data e hora em que o post foi coletado |

Exemplo de saída em JSON:

```json
[
  {
    "#": 1,
    "url": "https://www.instagram.com/p/XXXXXXXXXXX/",
    "date": "11 de agosto de 2026",
    "dateISO": "2026-08-11T19:20:47.000Z",
    "description": "Legenda do post...",
    "type": "Foto única",
    "collectedAt": "11/08/2026 19:30:12"
  }
]
```

---

## Instalação

A extensão não está publicada na Chrome Web Store. Instale-a no modo desenvolvedor:

1. Baixe ou clone este projeto e extraia a pasta `Instagram Scraper`.
2. No Chrome, acesse `chrome://extensions`.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação**.
5. Selecione a pasta `Instagram Scraper` (a que contém o `manifest.json`).
6. Fixe a extensão na barra de ferramentas para acesso rápido.

> Também funciona em outros navegadores baseados em Chromium (Edge, Brave, Opera) pelo mesmo procedimento.

## Como usar

1. Acesse o Instagram (`https://www.instagram.com/`) e **faça login**.
2. Abra o perfil que deseja coletar, com a grade de posts visível.
3. Clique no ícone da extensão.
4. Defina o intervalo:
   - **De**: primeiro post a coletar (1 é o mais recente).
   - **Até**: último post a coletar.
   - **Intervalo entre posts**: tempo de espera entre uma navegação e outra.
5. Clique em **Iniciar Coleta** e acompanhe o progresso.
6. Ao terminar, exporte o resultado em **CSV**, **JSON** ou **XLSX**, ou copie o JSON.
7. Use **Nova coleta** para recomeçar.

**Dica:** se o Instagram demorar a carregar ou a coleta falhar com frequência, aumente o intervalo entre posts.

---

## Como funciona

```
┌──────────────┐   mensagens (start/pause/stop)   ┌──────────────────┐
│   popup.js   │ ───────────────────────────────▶ │    content.js    │
│  (interface) │                                  │ (roda no Insta)  │
│              │ ◀─────────────────────────────── │                  │
└──────────────┘   chrome.storage.local (estado)  └──────────────────┘
```

1. O **popup** envia ao content script o intervalo e o delay escolhidos.
2. O **content script** clica no primeiro post da grade, aguarda o modal abrir e, se necessário, avança até o post inicial.
3. Para cada post, ele extrai os dados do modal (data pelo elemento `time[datetime]`, legenda por seletores do DOM, tipo pela URL e pelos elementos do modal) e avança para o próximo, detectando a troca de post pela mudança de URL e de data.
4. Após cada post, o progresso e os dados parciais são gravados em `chrome.storage.local`.
5. O popup consulta o storage a cada 600 ms para atualizar a interface e, no fim, exibe os resultados e as opções de exportação.

## Estrutura do projeto

```
Instagram Scraper/
├── manifest.json      # Configuração da extensão (Manifest V3)
├── popup.html         # Estrutura da interface
├── popup.css          # Estilos da interface
├── popup.js           # Lógica do popup, progresso e exportações
├── content.js         # Script injetado no Instagram: navegação e extração
├── icons/             # Ícones da extensão (16, 48 e 128 px)
└── libs/
    └── xlsx.min.js    # SheetJS 0.20.3, usado na exportação XLSX
```

## Permissões

| Permissão | Motivo |
|---|---|
| `activeTab` | Identificar a aba atual e enviar comandos a ela |
| `scripting` | Interação com a página do Instagram |
| `storage` | Guardar progresso e resultados da coleta |
| `https://www.instagram.com/*` | Rodar o content script somente no Instagram |

Nenhum dado é enviado a servidores externos: tudo é processado localmente no navegador. A única requisição externa é a da fonte *Inter* (Google Fonts), usada apenas na interface do popup.

## Tecnologias

- JavaScript (vanilla), HTML e CSS
- Chrome Extensions API (Manifest V3)
- [SheetJS](https://sheetjs.com/) para gerar arquivos `.xlsx`

---

## Limitações conhecidas

- **Depende da estrutura do Instagram.** A extração usa seletores do DOM (`div[role="dialog"]`, `time[datetime]`, `h1` etc.). Se o Instagram alterar o layout, os seletores em `content.js` podem precisar de ajuste.
- É preciso **estar logado** e ter acesso ao perfil (perfis privados só funcionam se você seguir a conta).
- A **aba do Instagram precisa permanecer aberta e ativa** durante a coleta.
- O popup usa a aba ativa da janela atual; não troque de aba durante o processo.
- A detecção de **Carrossel** e **Reel** é heurística e pode errar em casos incomuns.
- A **legenda coletada** pode, em alguns casos, trazer o texto de outro elemento do modal (como um comentário) caso o layout varie.
- O estilo do cabeçalho no XLSX (negrito e cor) não é aplicado na versão community do SheetJS; os dados são exportados normalmente.

## Uso responsável

Este projeto automatiza a navegação em uma conta real do Instagram. Use por sua conta e risco:

- Respeite os [Termos de Uso do Instagram](https://help.instagram.com/581066165581870) e a legislação aplicável (incluindo a LGPD, ao tratar dados pessoais).
- Coleta automatizada excessiva pode levar a **limitações temporárias ou bloqueio da conta**. Prefira intervalos maiores e lotes pequenos.
- Colete apenas conteúdo público ou ao qual você tem direito de acesso, e não use os dados para fins abusivos.
- Este projeto não tem relação com a Meta ou com o Instagram.

## Possíveis melhorias

- Coleta de métricas (curtidas, comentários, visualizações).
- Coleta de hashtags e menções extraídas da legenda.
- Download das mídias dos posts.
- Retomada de coleta interrompida a partir do último post.
- Suporte a outras línguas na interface.
- Publicação na Chrome Web Store.
