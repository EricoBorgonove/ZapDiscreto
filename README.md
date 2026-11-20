# Zap Discreto

Extensão do Chrome que deixa o WhatsApp Web mais discreto: esconde a lista de conversas, desfoca os textos, tem um botão de pânico e uma janela flutuante para acompanhar e responder uma conversa por cima de outros programas.

Tudo fica num botão verde ⚙ flutuante no canto da tela.

## Instalar (modo desenvolvedor)

1. Abra `chrome://extensions`
2. Ative **Modo do desenvolvedor** (canto superior direito)
3. Clique em **Carregar sem compactação** e selecione esta pasta
4. Abra ou recarregue https://web.whatsapp.com

Depois de editar algum arquivo, clique em ↻ na extensão em `chrome://extensions` e recarregue o WhatsApp.

## Funções

| Função | Atalho |
|---|---|
| Esconder/mostrar a lista de conversas | Alt+S |
| Só fotos: a lista vira uma faixa de fotos (passar o mouse mostra os dados da conversa) | Alt+A |
| Desfocar textos (aparecem ao passar o mouse) | Alt+B |
| Pânico (botão amarelo ⚠): desfoca, esconde ou cobre a tela na hora | Alt+P |
| Janela flutuante da conversa aberta | Alt+J |

### Lista escondida e só fotos

- Passar o mouse no botão de Conversas (barra da esquerda) abre a lista por cima, sem desfazer o modo.
- Ao abrir **Nova conversa** ou **Arquivadas**, o modo pausa; ele volta sozinho quando você escolhe uma conversa.

### Janela flutuante

Abre uma janela pequena que fica por cima de tudo, mesmo com o Chrome minimizado ou atrás de outros programas:

- faixa de fotos à esquerda para trocar de conversa;
- as últimas mensagens da conversa, atualizadas ao vivo;
- barra para digitar: **Enter** envia, **Shift+Enter** quebra a linha.

O WhatsApp continua na aba; a janela mostra uma cópia das mensagens. Por isso não dá para clicar nelas (reagir, abrir fotos, tocar áudios); isso se faz na aba.

Com o desfoque ligado, as mensagens também ficam desfocadas na janela. O pânico fecha a janela.

### Botão de pânico

O que o pânico faz, e se o botão amarelo aparece, se configura no menu ⚙ → **Botão de pânico ›**:

- desfocar os textos;
- esconder as conversas;
- cobrir a tela inteira.

Para voltar ao normal, clique de novo no botão amarelo ou aperte Alt+P.

### Outros ajustes

- O botão ⚙ pode ser arrastado para qualquer lugar.
- **Tamanho dos botões** no menu ⚙ aumenta ou diminui o ⚙ e o ⚠.
- A posição, o tamanho e os modos ligados ficam salvos.

## Privacidade

A extensão roda só em `web.whatsapp.com`, não envia nada para fora e guarda apenas as preferências no próprio Chrome (`chrome.storage.local`).

## Adicionar novas funções

Em `content.js`, adicione um item ao array `actions`:

```js
{
  id: "minha-acao",
  label: () => "Minha ação",
  shortcut: "",
  run: () => { /* ... */ },
}
```
