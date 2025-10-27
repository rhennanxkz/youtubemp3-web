#!/bin/bash

SESSION_NAME="downloader"
PROJECT_DIR="~/youtube-downloader" # O diretório do seu projeto

# Verifica se a sessão tmux já existe
tmux has-session -t $SESSION_NAME 2>/dev/null

# $? é o código de saída do último comando. 0 = sucesso (sessão existe), 1 = falha (sessão não existe)
if [ $? != 0 ]; then
  # Sessão NÃO existe, então vamos criá-la
  echo "Criando nova sessão tmux: $SESSION_NAME"

  # 1. Cria a sessão em modo 'detached' (-d) e envia o primeiro comando
  tmux new -s $SESSION_NAME -d
  tmux send-keys -t $SESSION_NAME:0.0 "cd $PROJECT_DIR && npm start" C-m

  # 2. Divide a janela verticalmente (-v) para criar o segundo painel
  tmux split-window -v -t $SESSION_NAME:0.0

  # 3. Envia o segundo comando para o novo painel (0.1)
  tmux send-keys -t $SESSION_NAME:0.1 "cloudflared tunnel --url localhost:5000" C-m
  
  echo "Servidor e túnel iniciados."

else
  echo "Sessão $SESSION_NAME já está rodando."
fi

# 4. Anexa à sessão (seja ela nova ou antiga)
echo "Anexando à sessão... (Pressione Ctrl+b e depois 'd' para sair sem parar os processos)"
tmux attach -t $SESSION_NAME
