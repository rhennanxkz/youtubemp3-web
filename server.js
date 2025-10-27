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
// Servir 'downloads' como estático permite o link de download <a> funcionar
app.use('/downloads', express.static(downloadsDir)); 
// A rota estática de /api/download foi movida para DEPOIS da rota da API

// --- Rotas da API ---

// ===================================================================
// INÍCIO DA CORREÇÃO
// Esta rota específica DEVE vir ANTES da rota estática app.use('/api/download', ...)
// para garantir que res.download() seja chamado.
app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(downloadsDir, filename);
  
  if (fs.existsSync(filePath)) {
    // res.download() força o download (define Content-Disposition: attachment)
    res.download(filePath, (err) => {
      if (err) {
        console.error("Erro ao enviar arquivo:", err);
        res.status(500).json({ error: 'Falha no download' });
      }
    });
  } else {
    console.warn(`Tentativa de baixar arquivo não existente: ${filename}`);
    res.status(404).json({ error: 'Arquivo não encontrado' });
  }
});
// FIM DA CORREÇÃO
// ===================================================================

// Rota de fallback para /api/download (agora vem DEPOIS da específica)
app.use('/api/download', express.static(downloadsDir)); 

app.get('/', (req, res) => {
  // O express.static já cuida disso, mas mantemos por clareza
  res.sendFile(path.join(publicDir, 'index.html'));
});

// --- Lógica do Socket.io ---
io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  // Listener para YouTube MP3
  socket.on('download-video', (data) => {
    const urls = data.urls.split('\n').filter(Boolean); 
    if (urls.length === 0) {
      return socket.emit('process-error', { error: 'Nenhum URL fornecido (YouTube).' });
    }
    
    console.log(`[MP3] Iniciando download para ${urls.length} URLs...`);
    startDownloadProcess(socket, urls);
  });

  // NOVO Listener para TikTok MP4
  socket.on('download-tiktok', (data) => {
    const urls = data.urls.split('\n').filter(Boolean);
    if (urls.length === 0) {
      return socket.emit('process-error', { error: 'Nenhum URL fornecido (TikTok).' });
    }

    console.log(`[MP4] Iniciando download para ${urls.length} URLs...`);
    startTikTokDownloadProcess(socket, urls);
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

/**
 * Inicia o processo de download do YouTube (MP3)
 */
function startDownloadProcess(socket, urls) {
  const processId = `mp3-${Date.now()}`;
  const jobDir = path.join(tempDir, processId);
  fs.mkdirSync(jobDir, { recursive: true });

  let totalVideos = 1;
  let currentVideoIndex = 0;
  let isPlaylist = false;
  let currentTitle = '';
  let hasError = false; 
  let lastConversionPath = null;
  let generatedFiles = []; // Array para rastrear arquivos finalizados

  socket.emit('process-started', { 
    processId, 
    message: `🔄 [MP3] Iniciando... Processando ${urls.length} entrada(s).` 
  });

  const args = [
    '-x', // Extrair áudio
    '--audio-format', 'mp3', 
    '--audio-quality', '0', // Melhor qualidade
    '--output', `${jobDir}/%(title).100s.%(ext)s`, // Salva no temp dir
    '--newline', // Garante que a saída seja por linha
    ...urls
  ];

  console.log('Executando: yt-dlp', args.join(' '));
  const ytdlp = spawn('yt-dlp', args);

  ytdlp.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output) console.log('[MP3 yt-dlp]:', output);

    const playlistMatch = output.match(/\[download\] Downloading (?:video|item) (\d+) of (\d+)/);
    
    if (playlistMatch) {
      isPlaylist = true;
      currentVideoIndex = parseInt(playlistMatch[1]);
      totalVideos = parseInt(playlistMatch[2]);
      socket.emit('playlist-info', { processId, current: currentVideoIndex, total: totalVideos });
    }

    if (output.includes('[download] Destination:')) {
      if (!isPlaylist) {
        currentVideoIndex++;
        totalVideos = urls.length; // Atualiza total se não for playlist
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
          message: `📥 [MP3] Baixando [${currentVideoIndex}/${totalVideos}] ${currentTitle}: ${progress.toFixed(1)}%`
        });
      }
    }

    if (output.includes('[ExtractAudio] Destination:')) {
      lastConversionPath = output.split('Destination:')[1].trim(); // Caminho do MP3 no temp
      socket.emit('conversion-started', {
        processId,
        message: `🔄 [MP3] Convertendo [${currentVideoIndex}/${totalVideos}] ${currentTitle}...`
      });
    }

    if (output.includes('Deleting original file') && lastConversionPath) {
      const finalFilename = path.basename(lastConversionPath);
      const finalDestPath = path.join(downloadsDir, finalFilename); // Caminho final

      try {
        // Move o arquivo final do temp para downloads
        fs.renameSync(lastConversionPath, finalDestPath); 
        console.log(`[MP3] Arquivo movido para: ${finalDestPath}`);
        generatedFiles.push(finalDestPath); // Adiciona ao array para zippar depois

        socket.emit('conversion-complete', {
          processId,
          message: `✅ [MP3] Convertido: ${finalFilename}`,
          filename: finalFilename, 
          current: currentVideoIndex,
          total: totalVideos
        });

      } catch (moveErr) {
        console.error('[MP3] Erro ao mover arquivo:', moveErr);
        hasError = true; 
        socket.emit('process-error', { processId, error: 'Erro ao salvar arquivo MP3 final.' });
      }
      lastConversionPath = null;
    }
  });

  ytdlp.stderr.on('data', (data) => {
    const errorOutput = data.toString().trim();
    if (errorOutput) console.log('[MP3 yt-dlp stderr]:', errorOutput);
    if (errorOutput.includes('WARNING:')) return; 
    if (errorOutput.includes('ERROR') || errorOutput.includes('FATAL')) {
      hasError = true; 
      socket.emit('process-error', { processId, error: errorOutput });
    }
  });

  ytdlp.on('close', (code) => {
    console.log(`[MP3] Processo finalizado com código: ${code}`);

    if (hasError) { // Se já emitimos um erro (ex: stderr ou mover arquivo), não faz mais nada.
      fs.rm(jobDir, { recursive: true, force: true }, () => {}); 
      return; 
    }
    
    // SUCESSO: Se geramos arquivos, vamos para a conclusão, *mesmo que o código seja 1*.
    if (generatedFiles.length > 0) {
      handleJobCompletion(socket, processId, jobDir, generatedFiles, 'MP3');
    }
    // FALHA REAL: Se o código não é 0 E não geramos arquivos
    else if (code !== 0) {
      socket.emit('process-error', {
        processId,
        error: `[MP3] Processo falhou (código: ${code}). Verifique o link.`
      });
      fs.rm(jobDir, { recursive: true, force: true }, () => {});
    }
    // NADA FEITO: Código 0, mas sem arquivos (link inválido, etc.)
    else {
      handleJobCompletion(socket, processId, jobDir, generatedFiles, 'MP3');
    }
  });
}

/**
 * NOVO - Inicia o processo de download do TikTok (MP4)
 */
function startTikTokDownloadProcess(socket, urls) {
  const processId = `mp4-${Date.now()}`;
  const jobDir = path.join(tempDir, processId);
  fs.mkdirSync(jobDir, { recursive: true });

  let totalVideos = 1;
  let currentVideoIndex = 0;
  let isPlaylist = false;
  let currentTitle = '';
  let hasError = false;
  let generatedFiles = []; // Array para rastrear arquivos finalizados
  let currentFileDestination = null; // Rastreia o arquivo sendo baixado

  socket.emit('process-started', { 
    processId, 
    message: `🔄 [MP4] Iniciando... Processando ${urls.length} entrada(s).` 
  });

  const cookieFilePath = path.join(__dirname, 'www.tiktok.com_cookies.txt');

  const args = [
    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', // Formato MP4
    '--output', `${jobDir}/%(title).100s.%(ext)s`, // Salva no temp dir
    '--newline',
    // --- ATUALIZADO ---
    // Manter User-Agent e Referer
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
    '--referer', 'https://www.tiktok.com/',
    // ...urls serão adicionados depois dos cookies, se existirem
  ];

  // --- NOVO: Adiciona cookies se o arquivo existir ---
  if (fs.existsSync(cookieFilePath)) {
    console.log(`[MP4] Usando arquivo de cookies: ${cookieFilePath}`);
    args.push('--cookies', cookieFilePath);
  } else {
    console.warn(`[MP4] Arquivo de cookies (www.tiktok.com_cookies.txt) não encontrado. Tentando sem cookies.`);
  }
  // --- FIM ---

  // Adiciona as URLs ao final dos argumentos
  args.push(...urls);

  console.log('Executando: yt-dlp', args.join(' '));
  const ytdlp = spawn('yt-dlp', args);

  ytdlp.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output) console.log('[MP4 yt-dlp]:', output);

    const playlistMatch = output.match(/\[download\] Downloading (?:video|item) (\d+) of (\d+)/);
    
    if (playlistMatch) {
      isPlaylist = true;
      currentVideoIndex = parseInt(playlistMatch[1]);
      totalVideos = parseInt(playlistMatch[2]);
      socket.emit('playlist-info', { processId, current: currentVideoIndex, total: totalVideos });
    }

    if (output.includes('[download] Destination:')) {
      if (!isPlaylist) {
        currentVideoIndex++;
        totalVideos = urls.length;
      }
      currentFileDestination = output.split('Destination:')[1].trim(); // Caminho no temp
      currentTitle = path.basename(currentFileDestination).replace(/\.[^/.]+$/, "");
      socket.emit('video-info', { processId, title: currentTitle, current: currentVideoIndex, total: totalVideos });
    }

    if (output.includes('[download]') && output.includes('%')) {
      const percentMatch = output.match(/(\d+\.?\d*)%/);
      if (percentMatch) {
        const progress = parseFloat(percentMatch[1]);
        socket.emit('download-progress', {
          processId,
          progress: progress,
          message: `📥 [MP4] Baixando [${currentVideoIndex}/${totalVideos}] ${currentTitle}: ${progress.toFixed(1)}%`
        });
      }
    }

    // Detecta arquivo final (seja por merge ou download direto)
    let finalFileReadyPath = null;
    
    if (output.includes('[Merger] Merging formats into "')) {
      // O merge terminou, o arquivo final está pronto
      finalFileReadyPath = output.split('[Merger] Merging formats into "')[1].replace(/"$/, '');
    
    } else if (output.includes('[download] 100%') && currentFileDestination) {
      // Download 100%
      // Verifica se NÃO é um arquivo temporário de merge (ex: .f137.mp4)
      if (!/\.f\d+\./.test(currentFileDestination)) {
        finalFileReadyPath = currentFileDestination;
      }
    }

    if (finalFileReadyPath) {
      const finalFilename = path.basename(finalFileReadyPath);
      const finalDestPath = path.join(downloadsDir, finalFilename); // Caminho final

      try {
        fs.renameSync(finalFileReadyPath, finalDestPath);
        console.log(`[MP4] Arquivo movido para: ${finalDestPath}`);
        generatedFiles.push(finalDestPath); // Adiciona ao array para zippar

        socket.emit('tiktok-file-complete', { // Novo evento
          processId,
          message: `✅ [MP4] Baixado: ${finalFilename}`,
          filename: finalFilename, 
          current: currentVideoIndex,
          total: totalVideos
        });

      } catch (moveErr) {
        console.error('[MP4] Erro ao mover arquivo:', moveErr);
        hasError = true; 
        socket.emit('process-error', { processId, error: 'Erro ao salvar arquivo MP4 final.' });
      }
      currentFileDestination = null; // Reseta para o próximo arquivo
    }
  });

  ytdlp.stderr.on('data', (data) => {
    const errorOutput = data.toString().trim();
    if (errorOutput) console.log('[MP4 yt-dlp stderr]:', errorOutput);
    if (errorOutput.includes('WARNING:')) return;
    if (errorOutput.includes('ERROR') || errorOutput.includes('FATAL')) {
      hasError = true;
      socket.emit('process-error', { processId, error: errorOutput });
    }
  });

  ytdlp.on('close', (code) => {
    console.log(`[MP4] Processo finalizado com código: ${code}`);

    if (hasError) { // Se já emitimos um erro (ex: stderr ou mover arquivo), não faz mais nada.
      fs.rm(jobDir, { recursive: true, force: true }, () => {});
      return;
    }
    
    // SUCESSO: Se geramos arquivos, vamos para a conclusão, *mesmo que o código seja 1*.
    if (generatedFiles.length > 0) {
      handleJobCompletion(socket, processId, jobDir, generatedFiles, 'MP4');
    } 
    // FALHA REAL: Se o código não é 0 E não geramos arquivos
    else if (code !== 0) { 
      socket.emit('process-error', {
        processId,
        error: `[MP4] Processo falhou (código: ${code}). Verifique o link.`
      });
      fs.rm(jobDir, { recursive: true, force: true }, () => {});
    } 
    // NADA FEITO: Código 0, mas sem arquivos (link inválido, etc.)
    else { 
      handleJobCompletion(socket, processId, jobDir, generatedFiles, 'MP4');
    }
  });
}


/**
 * ATUALIZADO - Lida com a finalização do lote (MP3 ou MP4)
 * Zips se > 10 arquivos, caso contrário, apenas finaliza.
 */
async function handleJobCompletion(socket, processId, jobDir, generatedFiles, type = 'MP3') {
  
  const totalFiles = generatedFiles.length;
  console.log(`[${type}] Finalização do trabalho. ${totalFiles} arquivos gerados.`);

  if (totalFiles > 10) {
    socket.emit('zip-started', { processId, message: `Compressando ${totalFiles} arquivos... Isso pode demorar.` });
    
    const zipName = `${processId}-Arquivos.zip`;
    const zipPath = path.join(downloadsDir, zipName);
    
    try {
      // Cria o zip a partir dos arquivos que já estão no diretório 'downloads'
      await zipGeneratedFiles(generatedFiles, zipPath);
      
      socket.emit('zip-complete', {
        processId,
        filename: zipName, 
        message: `✅ Lote grande! Arquivo ZIP criado: ${zipName}`
      });

      // (Opcional) Apaga os arquivos individuais após o zip
      generatedFiles.forEach(filePath => {
        fs.unlink(filePath, err => {
          if (err) console.error(`Erro ao apagar arquivo pós-zip: ${filePath}`, err);
        });
      });
      
    } catch (zipError) {
      console.error(`[${type}] Erro ao criar ZIP:`, zipError);
      socket.emit('process-error', { processId, error: 'Falha ao criar arquivo ZIP.' });
    }
    
  } else if (totalFiles > 0) {
    // Menos de 10 arquivos, o cliente já tem os links individuais
    socket.emit('process-complete', {
      processId,
      message: `🎉 Processo concluído com sucesso! ${totalFiles} arquivo(s) pronto(s).`
    });
  } else {
    // Nenhum arquivo foi gerado
     socket.emit('process-error', {
      processId,
      error: 'Nenhum arquivo foi baixado. Verifique os links.'
    });
  }

  // Limpa o diretório temporário
  fs.rm(jobDir, { recursive: true, force: true }, (err) => {
    if (err) console.error(`Erro ao limpar temp dir ${jobDir}:`, err);
    else console.log(`Temp dir ${jobDir} limpo.`);
  });
}


/**
 * Função utilitária para criar ZIP a partir de uma lista de caminhos de arquivos
 */
function zipGeneratedFiles(filePaths, outPath) {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const stream = fs.createWriteStream(outPath);

  return new Promise((resolve, reject) => {
    archive
      .on('error', err => reject(err))
      .pipe(stream);

    // Adiciona cada arquivo ao zip
    filePaths.forEach(filePath => {
      archive.file(filePath, { name: path.basename(filePath) });
    });

    stream.on('close', () => resolve());
    archive.finalize();
  });
}

// --- Iniciar o Servidor ---
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor Downloader Pro rodando na porta ${PORT}`);
  console.log(`💡 Acesse em http://localhost:${PORT} ou pela sua rede local.`);
});
