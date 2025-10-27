#!/bin/bash
# Script para enviar commits ao GitHub via SSH

# Verifica se o repositório é Git
if [ ! -d .git ]; then
  echo "❌ Este diretório não é um repositório Git."
  exit 1
fi

# Pergunta o comentário do commit
read -p "📝 Digite o comentário do commit: " commit_msg

# Caso o usuário não digite nada
if [ -z "$commit_msg" ]; then
  commit_msg="Atualização automática"
fi

# Adiciona, commita e envia
echo "📦 Adicionando alterações..."
git add .

echo "💬 Criando commit..."
git commit -m "$commit_msg"

echo "🚀 Enviando para o GitHub..."
git push

echo "✅ Envio concluído com sucesso!"

