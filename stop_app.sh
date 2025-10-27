#!/bin/bash

SESSION_NAME="downloader"

echo "Parando sessão tmux: $SESSION_NAME"
tmux kill-session -t $SESSION_NAME 2>/dev/null
echo "Sessão parada."
