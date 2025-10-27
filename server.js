const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = 5000;

// --- Configuração de Diretórios ---
const downloadsDir = path.join(__dirname, 'downloads');
const publicDir = path.join(__dirname, 'public');
const tempDir = path.join(__dirname, 'temp');

// Criar diretórios se não existirem
[downloadsDir, publicDir, tempDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));
app.use('/downloads', express.static(downloadsDir)); // Mantemos para o download do link

// --- Rotas da API ---
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// API para baixar arquivos (ainda necessária)
app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(downloadsDir, filename);
  
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: 'Arquivo não encontrado' });
  }
});

// --- Lógica do Socket.io ---
io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  socket.on('download-video', (data) => {
    const urls = data.urls.split('\n').filter(Boolean); 
    if (urls.length === 0) {
      return socket.emit('process-error', { error: 'Nenhum URL fornecido.' });
    }
    
    console.log(`Iniciando download para ${urls.length} URLs/Playlists...`);
    startDownloadProcess(socket, urls);
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

/**
 * Inicia o processo de download do yt-dlp
 */
function startDownloadProcess(socket, urls) {
  const processId = Date.now().toString();
  const jobDir = path.join(tempDir, processId);
  fs.mkdirSync(jobDir, { recursive: true });

  let totalVideos = 1;
  let currentVideoIndex = 0;
  let isPlaylist = false;
  let currentTitle = '';
  let hasError = false; 
  let lastConversionPath = null; 

  socket.emit('process-started', { 
    processId, 
    message: `🔄 Iniciando... Processando ${urls.length} entrada(s).` 
  });

  const args = [
    '-x', 
    '--audio-format', 'mp3', 
    '--audio-quality', '0',
    '--output', `${jobDir}/%(title).100s.%(ext)s`, 
    '--newline',
    ...urls
  ];

  console.log('Executando: yt-dlp', args.join(' '));
  const ytdlp = spawn('yt-dlp', args);

  ytdlp.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output) console.log('yt-dlp:', output);

    // *** A CORREÇÃO ESTÁ AQUI ***
    // Mudamos o regex para aceitar "video" ou "item"
    const playlistMatch = output.match(/\[download\] Downloading (?:video|item) (\d+) of (\d+)/);
    
    if (playlistMatch) {
      isPlaylist = true;
      currentVideoIndex = parseInt(playlistMatch[1]);
      totalVideos = parseInt(playlistMatch[2]);
      socket.emit('playlist-info', { processId, current: currentVideoIndex, total: totalVideos });
    }
    // *** FIM DA CORREÇÃO ***

    if (output.includes('[download] Destination:')) {
      if (!isPlaylist) {
        currentVideoIndex++;
        totalVideos = urls.length;
      }
      currentTitle = path.basename(output.split('Destination:')[1].trim()).replace(/\.[^/.]+$/, "");
      socket.emit('video-info', { processId, title: currentTitle, current: currentVideoIndex, total: totalVideos });
    }

    if (output.includes('[download]') && output.includes('%')) {
      const percentMatch = output.match(/(\d+\.?\d*)%/);
      if (percentMatch) {
        const progress = parseFloat(percentMatch[1]);
        socket.emit('download-progress', {
          processId,
          progress: progress,
          message: `📥 Baixando [${currentVideoIndex}/${totalVideos}] ${currentTitle}: ${progress.toFixed(1)}%`
        });
      }
    }

    if (output.includes('[ExtractAudio] Destination:')) {
      lastConversionPath = output.split('Destination:')[1].trim(); 
      socket.emit('conversion-started', {
        processId,
        message: `🔄 Convertendo [${currentVideoIndex}/${totalVideos}] ${currentTitle}...`
      });
    }

    if (output.includes('Deleting original file') && lastConversionPath) {
      const finalFilename = path.basename(lastConversionPath);
      const finalDestPath = path.join(downloadsDir, finalFilename);

      try {
        fs.renameSync(lastConversionPath, finalDestPath); 
        console.log(`Arquivo movido para: ${finalDestPath}`);

        socket.emit('conversion-complete', {
          processId,
          message: `✅ Convertido [${currentVideoIndex}/${totalVideos}]: ${finalFilename}`,
          filename: finalFilename, 
          current: currentVideoIndex,
          total: totalVideos
        });

      } catch (moveErr) {
        console.error('Erro ao mover arquivo:', moveErr);
        hasError = true; 
        socket.emit('process-error', { processId, error: 'Erro ao salvar arquivo final.' });
      }
      lastConversionPath = null;
    }
  });

  ytdlp.stderr.on('data', (data) => {
    const errorOutput = data.toString().trim();
    if (errorOutput) console.log('yt-dlp stderr:', errorOutput);
    if (errorOutput.includes('WARNING:')) return; 
    if (errorOutput.includes('ERROR') || errorOutput.includes('FATAL')) {
      hasError = true; 
      socket.emit('process-error', {
        processId,
        error: errorOutput
      });
    }
  });

  ytdlp.on('close', (code) => {
    console.log(`Processo finalizado com código: ${code}`);

    if (hasError) {
      console.log('Processo finalizado, mas um erro interno (ex: mover arquivo) ocorreu.');
      fs.rm(jobDir, { recursive: true, force: true }, () => {}); 
      return; 
    }
    if (code === 0) {
      // Passamos o total real de vídeos, se for playlist, ou o contador
      const finalCount = isPlaylist ? totalVideos : currentVideoIndex;
      handleJobCompletion(socket, processId, jobDir, finalCount);
    } else {
      socket.emit('process-error', {
        processId,
        error: `Processo falhou com código: ${code}`
      });
      fs.rm(jobDir, { recursive: true, force: true }, () => {});
    }
  });

  ytdlp.on('error', (error) => {
    console.error('Erro ao executar yt-dlp:', error);
    hasError = true; 
    socket.emit('process-error', {
      processId,
      error: 'Erro ao iniciar o processo de download: ' + error.message
    });
    fs.rm(jobDir, { recursive: true, force: true }, () => {});
  });
}

/**
 * Lida com a finalização do lote, zippando se necessário
 */
async function handleJobCompletion(socket, processId, jobDir, totalFiles) {
  
  if (totalFiles > 10) {
    socket.emit('zip-started', { processId, message: 'Compressando arquivos... Isso pode demorar.' });
    
    const zipName = `${processId}-Playlist.zip`;
    const zipPath = path.join(downloadsDir, zipName);
    
    try {
      await zipDirectory(jobDir, zipPath);
      
      socket.emit('zip-complete', {
        processId,
        filename: zipName, 
        message: `✅ Lote grande! Arquivo ZIP criado: ${zipName}`
      });
      
    } catch (zipError) {
      console.error('Erro ao criar ZIP:', zipError);
      socket.emit('process-error', { processId, error: 'Falha ao criar arquivo ZIP.' });
    }
    
  } else {
    socket.emit('process-complete', {
      processId,
      message: '🎉 Processo concluído com sucesso!'
    });
  }

  // Limpa o diretório temporário
  fs.rm(jobDir, { recursive: true, force: true }, (err) => {
    if (err) console.error(`Erro ao limpar temp dir ${jobDir}:`, err);
    else console.log(`Temp dir ${jobDir} limpo.`);
  });
}


/**
 * Função utilitária para criar ZIP de um diretório
 */
function zipDirectory(sourceDir, outPath) {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const stream = fs.createWriteStream(outPath);

  return new Promise((resolve, reject) => {
    archive
      .directory(sourceDir, false)
      .on('error', err => reject(err))
      .pipe(stream);

    stream.on('close', () => resolve());
    archive.finalize();
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor YouTube MP3 Converter rodando na porta ${PORT}`);
  console.log(`💡 Acesse em http://localhost:${PORT} ou pela sua rede local.`);
});
