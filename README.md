# Whats Edit

Extensão do Chrome que adiciona um botão flutuante ao WhatsApp Web com várias ações.

## Instalar (modo desenvolvedor)

1. Abra `chrome://extensions`
2. Ative **Modo do desenvolvedor** (canto superior direito)
3. Clique em **Carregar sem compactação** e selecione esta pasta
4. Abra ou recarregue https://web.whatsapp.com

Depois de editar algum arquivo, clique em ↻ na extensão em `chrome://extensions` e recarregue o WhatsApp.

## Ações

| Ação | Atalho |
|---|---|
| Esconder/mostrar a lista de conversas | Alt+S |
| Só fotos (hover mostra os dados da conversa) | Alt+A |
| Desfocar textos (aparecem ao passar o mouse) | Alt+B |

O botão ⚙ pode ser arrastado para qualquer lugar; a posição e o estado ficam salvos.

## Adicionar novas ações

Em `content.js`, adicione um item ao array `actions`:

```js
{
  id: "minha-acao",
  label: () => "Minha ação",
  shortcut: "",
  run: () => { /* ... */ },
}
```
