# Criar estrutura do projeto
mkdir -p downloads public

# Criar package.json
cat > package.json << 'EOF'
{
  "name": "youtube-downloader",
  "version": "1.0.0",
  "description": "YouTube to MP3 converter",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "socket.io": "^4.7.2",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
EOF

# Instalar dependências (agora deve funcionar sem problemas)
npm install

# Verificar se instalou corretamente
ls node_modules/
