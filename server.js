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

// --- [NOVO] Chave Geral para Ligar/Desligar a API ---
// Mude para 'false' para desativar todas as rotas da API v1
const ENABLE_API = true;
// ---------------------------------------------------


// --- Configuração de Diretórios ---
const downloadsDir = path.join(__dirname, 'downloads');
const publicDir = path.join(__dirname, 'public');
const tempDir = path.join(__dirname, 'temp');
// [NOVO] Subdiretórios de download
const mp3Dir = path.join(downloadsDir, 'mp3');
const mp4Dir = path.join(downloadsDir, 'mp4');


// Criar diretórios se não existirem
[downloadsDir, publicDir, tempDir, mp3Dir, mp4Dir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));
app.use('/downloads', express.static(downloadsDir));

// --- Rotas da API (Download de Arquivo) ---
// [MODIFICADO] Rota de download para aceitar subpastas (ex: /mp3/arquivo.mp3)
app.get('/api/download/:filename(*)', (req, res) => {
  // :filename(*) captura tudo, incluindo barras /
  const filename = req.params.filename; 
  const filePath = path.join(downloadsDir, filename);
  
  if (fs.existsSync(filePath)) {
    // Configurar headers para download
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(path.basename(filename))}"`); // Usa path.basename para o nome do arquivo
    res.setHeader('Content-Type', 'application/octet-stream');
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    fileStream.on('error', (err) => {
      console.error("Erro ao ler arquivo:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Erro ao ler arquivo' });
      }
    });
    
    // Se o cliente fechar a conexão, destrói o stream
    req.on('close', () => {
      fileStream.destroy();
    });
    
  } else {
    console.warn(`Tentativa de baixar arquivo não existente: ${filename}`);
    res.status(404).json({ error: 'Arquivo não encontrado' });
  }
});

// --- [NOVAS] Rotas da API v1 (GET) ---
if (ENABLE_API) {
  console.log('💡 API de [GET] está ATIVADA.');

  // Rota para a documentação (assumindo que você tem o api-docs.html em /public)
  app.get('/api-docs', (req, res) => {
    res.sendFile(path.join(publicDir, 'api-docs.html'));
  });

  // Rota API: YouTube MP3
  app.get('/api/v1/youtube-mp3', async (req, res) => {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ success: false, error: 'Parâmetro "url" é obrigatório.' });
    }
    try {
      // Chama a nova função "headless"
      const { filename, title } = await downloadYouTubeMP3_API(url);
      // [MODIFICADO] Garante que a URL é codificada corretamente
      const downloadUrl = `${req.protocol}://${req.get('host')}/api/download/${encodeURIComponent(filename)}`;
      res.status(200).json({
        success: true,
        title: title,
        filename: filename,
        downloadUrl: downloadUrl
      });
    } catch (error) {
      console.error('[API v1 MP3] Erro:', error.message);
      res.status(500).json({ success: false, error: error.message || 'Falha ao processar.' });
    }
  });

  // Rota API: TikTok MP4
  app.get('/api/v1/tiktok-mp4', async (req, res) => {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ success: false, error: 'Parâmetro "url" é obrigatório.' });
    }
    try {
      // Chama a nova função "headless"
      const { filename, title } = await downloadTikTokMP4_API(url);
      // [MODIFICADO] Garante que a URL é codificada corretamente
      const downloadUrl = `${req.protocol}://${req.get('host')}/api/download/${encodeURIComponent(filename)}`;
      res.status(200).json({
        success: true,
        title: title,
        filename: filename,
        downloadUrl: downloadUrl
      });
    } catch (error) {
      console.error('[API v1 MP4] Erro:', error.message);
      res.status(500).json({ success: false, error: error.message || 'Falha ao processar.' });
    }
  });

} else {
  console.log('🔌 API de [GET] está DESATIVADA.');
}
// --- [FIM] Novas Rotas da API ---


// Rotas de páginas (HTML)
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/youtube-mp3', (req, res) => {
  res.sendFile(path.join(publicDir, 'youtube-mp3.html'));
});

app.get('/tiktok-download', (req, res) => {
  res.sendFile(path.join(publicDir, 'tiktok-download.html'));
});

app.get('/about', (req, res) => {
  res.sendFile(path.join(publicDir, 'about.html'));
});

// Servir arquivos estáticos para CSS e JS
app.use('/css', express.static(path.join(publicDir, 'css')));
app.use('/js', express.static(path.join(publicDir, 'js')));

// --- Lógica do Socket.io (Sem alteração) ---
io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  socket.on('download-video', (data) => {
    const urls = data.urls.split('\n').filter(Boolean); 
    if (urls.length === 0) {
      return socket.emit('process-error', { error: 'Nenhum URL fornecido (YouTube).' });
    }
    
    console.log(`[MP3] Iniciando download para ${urls.length} URLs...`);
    startDownloadProcess(socket, urls);
  });

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
 * (Socket) Inicia o processo de download do YouTube (MP3)
 * (Função original - Sem alteração)
 */
function startDownloadProcess(socket, urls) {
  const processId = `mp3-${Date.now()}`;
  const jobDir = path.join(tempDir, processId);
  fs.mkdirSync(jobDir, { recursive: true });

  let totalVideos = 1, currentVideoIndex = 0, isPlaylist = false, currentTitle = '', hasError = false; 
  let lastConversionPath = null, generatedFiles = [];

  socket.emit('process-started', { processId, message: `🔄 [MP3] Iniciando... Processando ${urls.length} entrada(s).` });

  const args = ['-x', '--audio-format', 'mp3', '--audio-quality', '0', '--output', `${jobDir}/%(title).100s.%(ext)s`, '--newline', '--no-warnings', ...urls];

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
        totalVideos = urls.length;
      }
      currentTitle = path.basename(output.split('Destination:')[1].trim()).replace(/\.[^/.]+$/, "");
      socket.emit('video-info', { processId, title: currentTitle, current: currentVideoIndex, total: totalVideos });
    }
    if (output.includes('[download]') && output.includes('%')) {
      const percentMatch = output.match(/(\d+\.?\d*)%/);
      if (percentMatch) {
        const progress = parseFloat(percentMatch[1]);
        socket.emit('download-progress', { processId, progress: progress, message: `📥 [MP3] Baixando [${currentVideoIndex}/${totalVideos}] ${currentTitle}: ${progress.toFixed(1)}%` });
      }
    }
    if (output.includes('[ExtractAudio] Destination:')) {
      lastConversionPath = output.split('Destination:')[1].trim();
      socket.emit('conversion-started', { processId, message: `🔄 [MP3] Convertendo [${currentVideoIndex}/${totalVideos}] ${currentTitle}...` });
    }
    if (output.includes('Deleting original file') && lastConversionPath) {
      const finalFilename = path.basename(lastConversionPath);
      // [MODIFICADO] Salva na pasta 'mp3'
      const finalDestPath = path.join(mp3Dir, finalFilename);
      try {
        fs.renameSync(lastConversionPath, finalDestPath);
        console.log(`[MP3] Arquivo movido para: ${finalDestPath}`);
        generatedFiles.push(finalDestPath);
        // [MODIFICADO] Envia o caminho relativo 'mp3/filename.mp3'
        socket.emit('conversion-complete', { processId, message: `✅ [MP3] Convertido: ${finalFilename}`, filename: `mp3/${finalFilename}`, current: currentVideoIndex, total: totalVideos });
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
    if (errorOutput.includes('ERROR') || errorOutput.includes('FATAL')) {
      hasError = true; 
      socket.emit('process-error', { processId, error: errorOutput });
    }
  });
  ytdlp.on('close', (code) => {
    console.log(`[MP3] Processo finalizado com código: ${code}`);
    if (hasError) { cleanupJob(jobDir); return; }
    if (generatedFiles.length > 0) { handleJobCompletion(socket, processId, jobDir, generatedFiles, 'MP3'); }
    else if (code !== 0) { socket.emit('process-error', { processId, error: `[MP3] Processo falhou (código: ${code}). Verifique o link.`}); cleanupJob(jobDir); }
    else { handleJobCompletion(socket, processId, jobDir, generatedFiles, 'MP3'); }
  });
}

/**
 * (Socket) Inicia o processo de download do TikTok (MP4)
 * (Função original - Sem alteração)
 */
function startTikTokDownloadProcess(socket, urls) {
  const processId = `mp4-${Date.now()}`;
  const jobDir = path.join(tempDir, processId);
  fs.mkdirSync(jobDir, { recursive: true });

  let totalVideos = 1, currentVideoIndex = 0, isPlaylist = false, currentTitle = '', hasError = false;
  let generatedFiles = [], currentFileDestination = null;

  socket.emit('process-started', { processId, message: `🔄 [MP4] Iniciando... Processando ${urls.length} entrada(s).` });

  // (Lógica estável de cópia de cookie)
  const originalCookieFile = path.join(__dirname, 'www.tiktok.com_cookies.txt');
  const tempCookieFile = path.join(jobDir, 'cookies.txt');
  let cookieArgs = [];
  if (fs.existsSync(originalCookieFile)) {
    try {
      fs.copyFileSync(originalCookieFile, tempCookieFile);
      console.log(`[MP4] Usando arquivo de cookies temporário: ${tempCookieFile}`);
      cookieArgs = ['--cookies', tempCookieFile];
    } catch (err) {
      console.warn(`[MP4] Não foi possível copiar arquivo de cookies: ${err.message}`);
    }
  } else {
    console.warn(`[MP4] Arquivo de cookies não encontrado. Tentando sem cookies.`);
  }

  const args = [
    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '--output', `${jobDir}/%(title).100s.%(ext)s`,
    '--newline', '--no-warnings',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
    '--referer', 'https://www.tiktok.com/',
    ...cookieArgs, ...urls
  ];

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
      currentFileDestination = output.split('Destination:')[1].trim();
      currentTitle = path.basename(currentFileDestination).replace(/\.[^/.]+$/, "");
      socket.emit('video-info', { processId, title: currentTitle, current: currentVideoIndex, total: totalVideos });
    }
    if (output.includes('[download]') && output.includes('%')) {
      const percentMatch = output.match(/(\d+\.?\d*)%/);
      if (percentMatch) {
        const progress = parseFloat(percentMatch[1]);
        socket.emit('download-progress', { processId, progress: progress, message: `📥 [MP4] Baixando [${currentVideoIndex}/${totalVideos}] ${currentTitle}: ${progress.toFixed(1)}%` });
      }
    }
    let finalFileReadyPath = null;
    if (output.includes('[Merger] Merging formats into "')) { finalFileReadyPath = output.split('[Merger] Merging formats into "')[1].replace(/"$/, ''); }
    else if (output.includes('[download] 100%') && currentFileDestination) { if (!/\.f\d+\./.test(currentFileDestination)) { finalFileReadyPath = currentFileDestination; } }
    if (finalFileReadyPath) {
      const finalFilename = path.basename(finalFileReadyPath);
      // [MODIFICADO] Salva na pasta 'mp4'
      const finalDestPath = path.join(mp4Dir, finalFilename);
      try {
        fs.renameSync(finalFileReadyPath, finalDestPath);
        console.log(`[MP4] Arquivo movido para: ${finalDestPath}`);
        generatedFiles.push(finalDestPath);
        // [MODIFICADO] Envia o caminho relativo 'mp4/filename.mp4'
        socket.emit('tiktok-file-complete', { processId, message: `✅ [MP4] Baixado: ${finalFilename}`, filename: `mp4/${finalFilename}`, current: currentVideoIndex, total: totalVideos });
      } catch (moveErr) {
        console.error('[MP4] Erro ao mover arquivo:', moveErr);
        hasError = true; 
        socket.emit('process-error', { processId, error: 'Erro ao salvar arquivo MP4 final.' });
      }
      currentFileDestination = null;
    }
  });
  ytdlp.stderr.on('data', (data) => {
    const errorOutput = data.toString().trim();
    if (errorOutput) console.log('[MP4 yt-dlp stderr]:', errorOutput);
    if (errorOutput.includes('ERROR') || errorOutput.includes('FATAL')) {
      hasError = true;
      socket.emit('process-error', { processId, error: errorOutput });
    }
  });
  ytdlp.on('close', (code) => {
    console.log(`[MP4] Processo finalizado com código: ${code}`);
    if (hasError) { cleanupJob(jobDir); return; }
    if (generatedFiles.length > 0) { handleJobCompletion(socket, processId, jobDir, generatedFiles, 'MP4'); } 
    else if (code !== 0) { socket.emit('process-error', { processId, error: `[MP4] Processo falhou (código: ${code}). Verifique o link.` }); cleanupJob(jobDir); } 
    else { handleJobCompletion(socket, processId, jobDir, generatedFiles, 'MP4'); }
  });
}


// --- [NOVAS] Funções "Headless" para a API ---

/**
 * (API) Baixa um ÚNICO vídeo do YouTube como MP3.
 * @param {string} url - A URL do vídeo
 * @returns {Promise<{filename: string, title: string}>}
 */
function downloadYouTubeMP3_API(url) {
  return new Promise((resolve, reject) => {
    const processId = `api-mp3-${Date.now()}`;
    const jobDir = path.join(tempDir, processId);
    fs.mkdirSync(jobDir, { recursive: true });

    let finalFilename = null;
    let finalTitle = "Vídeo";
    let lastConversionPath = null;
    let hasError = false;
    let errorMessages = [];

    const args = [
      '-x', '--audio-format', 'mp3', '--audio-quality', '0',
      '--output', `${jobDir}/%(title).100s.%(ext)s`,
      '--newline', '--no-warnings',
      '--no-playlist', // API só baixa um vídeo
      url
    ];

    const ytdlp = spawn('yt-dlp', args);

    ytdlp.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output.includes('[download] Destination:')) {
        finalTitle = path.basename(output.split('Destination:')[1].trim()).replace(/\.[^/.]+$/, "");
      }
      if (output.includes('[ExtractAudio] Destination:')) {
        lastConversionPath = output.split('Destination:')[1].trim();
      }
      if (output.includes('Deleting original file') && lastConversionPath) {
        const filename = path.basename(lastConversionPath);
        // [MODIFICADO] Salva na pasta 'mp3'
        const finalDestPath = path.join(mp3Dir, filename);
        try {
          fs.renameSync(lastConversionPath, finalDestPath);
          // [MODIFICADO] Armazena o caminho relativo 'mp3/filename.mp3'
          finalFilename = `mp3/${filename}`;
        } catch (moveErr) {
          console.error('[API MP3] Erro ao mover arquivo:', moveErr);
          hasError = true;
          errorMessages.push('Erro ao salvar arquivo MP3 final.');
        }
      }
    });
    ytdlp.stderr.on('data', (data) => {
      const errorOutput = data.toString().trim();
      if (errorOutput.includes('ERROR') || errorOutput.includes('FATAL')) {
        hasError = true;
        errorMessages.push(errorOutput);
      }
    });
    ytdlp.on('close', (code) => {
      cleanupJob(jobDir);
      if (hasError) { reject(new Error(errorMessages.join('; '))); }
      else if (finalFilename) { resolve({ filename: finalFilename, title: finalTitle }); }
      else if (code !== 0) { reject(new Error(`[API MP3] Processo falhou (código: ${code}). Verifique o link.`)); }
      else { reject(new Error('[API MP3] Nenhum arquivo foi baixado.')); }
    });
  });
}

/**
 * (API) Baixa um ÚNICO vídeo do TikTok como MP4.
 * @param {string} url - A URL do vídeo
 * @returns {Promise<{filename: string, title: string}>}
 */
function downloadTikTokMP4_API(url) {
  return new Promise((resolve, reject) => {
    const processId = `api-mp4-${Date.now()}`;
    const jobDir = path.join(tempDir, processId);
    fs.mkdirSync(jobDir, { recursive: true });

    let finalFilename = null;
    let finalTitle = "Vídeo";
    let currentFileDestination = null;
    let hasError = false;
    let errorMessages = [];

    // (Lógica estável de cópia de cookie - IDÊNTICA à do socket)
    const originalCookieFile = path.join(__dirname, 'www.tiktok.com_cookies.txt');
    const tempCookieFile = path.join(jobDir, 'cookies.txt');
    let cookieArgs = [];
    if (fs.existsSync(originalCookieFile)) {
      try {
        fs.copyFileSync(originalCookieFile, tempCookieFile);
        console.log(`[API MP4] Usando arquivo de cookies temporário: ${tempCookieFile}`);
        cookieArgs = ['--cookies', tempCookieFile];
      } catch (err) {
        console.warn(`[API MP4] Não foi possível copiar cookie: ${err.message}`);
      }
    }

    const args = [
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--output', `${jobDir}/%(title).100s.%(ext)s`,
      '--newline', '--no-warnings',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
      '--referer', 'https://www.tiktok.com/',
      '--no-playlist', // API só baixa um vídeo
      ...cookieArgs,
      url
    ];

    const ytdlp = spawn('yt-dlp', args);

    ytdlp.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output.includes('[download] Destination:')) {
        currentFileDestination = output.split('Destination:')[1].trim();
        finalTitle = path.basename(currentFileDestination).replace(/\.[^/.]+$/, "");
      }
      let finalFileReadyPath = null;
      if (output.includes('[Merger] Merging formats into "')) { finalFileReadyPath = output.split('[Merger] Merging formats into "')[1].replace(/"$/, ''); }
      else if (output.includes('[download] 100%') && currentFileDestination) { if (!/\.f\d+\./.test(currentFileDestination)) { finalFileReadyPath = currentFileDestination; } }
      
      if (finalFileReadyPath) {
        const filename = path.basename(finalFileReadyPath);
        // [MODIFICADO] Salva na pasta 'mp4'
        const finalDestPath = path.join(mp4Dir, filename);
        try {
          fs.renameSync(finalFileReadyPath, finalDestPath);
          // [MODIFICADO] Armazena o caminho relativo 'mp4/filename.mp4'
          finalFilename = `mp4/${filename}`;
        } catch (moveErr) {
          console.error('[API MP4] Erro ao mover arquivo:', moveErr);
          hasError = true;
          errorMessages.push('Erro ao salvar arquivo MP4 final.');
        }
      }
    });
    ytdlp.stderr.on('data', (data) => {
      const errorOutput = data.toString().trim();
      if (errorOutput.includes('ERROR') || errorOutput.includes('FATAL')) {
        hasError = true;
        errorMessages.push(errorOutput);
      }
    });
    ytdlp.on('close', (code) => {
      cleanupJob(jobDir);
      if (hasError) { reject(new Error(errorMessages.join('; '))); }
      else if (finalFilename) { resolve({ filename: finalFilename, title: finalTitle }); }
      else if (code !== 0) { reject(new Error(`[API MP4] Processo falhou (código: ${code}). Verifique o link.`)); }
      else { reject(new Error('[API MP4] Nenhum arquivo foi baixado.')); }
    });
  });
}


// --- Funções Utilitárias (Originais - Sem alteração) ---

/**
 * Função auxiliar para limpar diretório de trabalho
 */
function cleanupJob(jobDir) {
  fs.rm(jobDir, { recursive: true, force: true }, (err) => {
    if (err) console.error(`Erro ao limpar temp dir ${jobDir}:`, err);
    else console.log(`Temp dir ${jobDir} limpo.`);
  });
}

/**
 * Lida com a finalização do lote (MP3 ou MP4)
 */
async function handleJobCompletion(socket, processId, jobDir, generatedFiles, type = 'MP3') {
  
  const totalFiles = generatedFiles.length;
  console.log(`[${type}] Finalização do trabalho. ${totalFiles} arquivos gerados.`);

  if (totalFiles > 10) {
    socket.emit('zip-started', { processId, message: `Compressando ${totalFiles} arquivos... Isso pode demorar.` });
    const zipName = `${processId}-Arquivos.zip`;
    const zipPath = path.join(downloadsDir, zipName); // Salva o ZIP na pasta 'downloads' raiz
    try {
      await zipGeneratedFiles(generatedFiles, zipPath);
      socket.emit('zip-complete', { processId, filename: zipName, message: `✅ Lote grande! Arquivo ZIP criado: ${zipName}`});
      generatedFiles.forEach(filePath => {
        fs.unlink(filePath, err => {
          if (err) console.error(`Erro ao apagar arquivo pós-zip: ${filePath}`, err);
        });
      });
      // [FIX] Adicionado para disparar a tela de conclusão
      socket.emit('process-complete', { processId, message: `🎉 Processo concluído com sucesso! ${totalFiles} arquivo(s) compactado(s).` });

    } catch (zipError) {
      console.error(`[${type}] Erro ao criar ZIP:`, zipError);
      socket.emit('process-error', { processId, error: 'Falha ao criar arquivo ZIP.' });
    }
  } else if (totalFiles > 0) {
    socket.emit('process-complete', { processId, message: `🎉 Processo concluído com sucesso! ${totalFiles} arquivo(s) pronto(s).` });
  } else {
    socket.emit('process-error', { processId, error: 'Nenhum arquivo foi baixado. Verifique os links.' });
  }
  cleanupJob(jobDir);
}

/**
 * Função utilitária para criar ZIP
 */
function zipGeneratedFiles(filePaths, outPath) {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const stream = fs.createWriteStream(outPath);
  return new Promise((resolve, reject) => {
    archive
      .on('error', err => reject(err))
      .pipe(stream);
    filePaths.forEach(filePath => {
      // Adiciona o arquivo ao ZIP apenas com seu nome base (ex: 'musica.mp3')
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
