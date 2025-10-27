// --- Elementos do DOM para YouTube ---
const steps = {
    insert: document.getElementById('step-1-insert'),
    process: document.getElementById('step-2-process-list')
};

// Elementos do Passo 2 (Processamento)
const processingHeader = document.getElementById('processing-header');
const finishedHeader = document.getElementById('finished-header');
const progressBars = document.getElementById('progress-bars');

const currentFileProgressFill = document.getElementById('currentFileProgressFill');
const currentFileText = document.getElementById('currentFileText');
const overallProgressFill = document.getElementById('overallProgressFill');
const overallProgressText = document.getElementById('overallProgressText');
const messagesDiv = document.getElementById('messages');

// Botões e Inputs
const convertBtn = document.getElementById('convertBtn');
const convertBtnText = document.getElementById('convertBtnText');
const videoUrlsInput = document.getElementById('videoUrls');

const filesListDiv = document.getElementById('filesList');
const noFilesMessage = document.getElementById('noFilesMessage');
const newDownloadBtn = document.getElementById('newDownloadBtn');

// --- Variáveis de Estado ---
let totalJobCount = 1;
const socket = io();

// --- Funções de Navegação ---
function showStep(stepName) {
    Object.values(steps).forEach(step => {
        step.style.display = 'none';
    });
    
    if (steps[stepName]) {
        steps[stepName].style.display = 'flex';
    }
}

// --- Eventos do Socket ---
socket.on('process-started', (data) => {
    showStep('process');
    addMessage(data.message);
    disableForms();
    totalJobCount = 1;
});

socket.on('playlist-info', (data) => {
    totalJobCount = data.total;
    overallProgressText.textContent = `Progresso Total: ${data.current} / ${data.total}`;
});

socket.on('video-info', (data) => {
     currentFileText.textContent = `Baixando [${data.current}/${data.total}]: ${data.title}`;
});

socket.on('download-progress', (data) => {
    currentFileProgressFill.classList.remove('converting-pulse');
    currentFileProgressFill.className = "h-2.5 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-300"; 
    currentFileProgressFill.style.width = data.progress + '%';
    currentFileText.textContent = data.message; 
    updateLastMessage(data.message);
});

socket.on('conversion-started', (data) => {
    currentFileText.textContent = data.message;
    currentFileProgressFill.classList.add('converting-pulse');
    currentFileProgressFill.className = "h-2.5 rounded-full bg-orange-500 transition-all duration-300"; 
    addMessage(data.message);
});

// Evento MP3
socket.on('conversion-complete', (data) => {
    currentFileProgressFill.classList.remove('converting-pulse');
    currentFileProgressFill.className = "h-2.5 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-300"; 
    addMessage(data.message);
    
    const overallPct = (data.current / data.total) * 100;
    overallProgressFill.style.width = overallPct + '%';
    overallProgressText.textContent = `Progresso Total: ${data.current} / ${data.total}`;
    
    currentFileProgressFill.style.width = '0%';
    currentFileText.textContent = 'Convertido. Aguardando próximo...';

    // data.filename agora é 'mp3/arquivo.mp3'
    addFileToList(data.filename, 'mp3'); // Tipo 'mp3'
});

socket.on('zip-started', (data) => addMessage(data.message));

socket.on('zip-complete', (data) => {
    addMessage(data.message);
    // data.filename é 'arquivo.zip'
    addFileToList(data.filename, 'zip'); // Tipo 'zip'
});

socket.on('process-complete', (data) => {
    addMessage(data.message);
    enableForms();
    
    processingHeader.style.display = 'none';
    progressBars.style.display = 'none';
    
    finishedHeader.style.display = 'block';
    newDownloadBtn.style.display = 'block';
});

socket.on('process-error', (data) => {
    addMessage('❌ Erro: ' + data.error, true);
    currentFileProgressFill.classList.remove('converting-pulse');
    enableForms();
    setTimeout(() => {
        showStep('insert');
        resetProcessScreen(); 
    }, 3000);
});

// --- Funções Auxiliares ---
function resetProcessScreen() {
    finishedHeader.style.display = 'none';
    newDownloadBtn.style.display = 'none';
    processingHeader.style.display = 'flex';
    progressBars.style.display = 'block';

    currentFileText.textContent = 'Aguardando...';
    overallProgressText.textContent = 'Progresso Total';
    currentFileProgressFill.style.width = '0%';
    overallProgressFill.style.width = '0%';
    currentFileProgressFill.classList.remove('converting-pulse');

    filesListDiv.innerHTML = ''; 
    noFilesMessage.style.display = 'block';
    messagesDiv.innerHTML = '';
}

function resetForNewDownload() {
    videoUrlsInput.value = '';
    resetProcessScreen();
    showStep('insert');
}

function addMessage(message, isError = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = isError ? 'text-red-600 font-medium' : 'text-gray-600';
    messageDiv.textContent = message;
    messagesDiv.prepend(messageDiv);
}

function updateLastMessage(message) {
    const firstMessage = messagesDiv.querySelector('div');
    if (firstMessage && !firstMessage.classList.contains('text-red-600')) {
        firstMessage.textContent = message;
    } else {
        addMessage(message);
    }
}

function disableForms() {
    convertBtn.disabled = true;
    videoUrlsInput.disabled = true;
    convertBtnText.textContent = 'Processando...';
}

function enableForms() {
    convertBtn.disabled = false;
    videoUrlsInput.disabled = false;
    convertBtnText.textContent = 'Converter para MP3';
}

// Função para adicionar arquivos à lista
function addFileToList(fullPath, type = 'mp3') {
    noFilesMessage.style.display = 'none'; 

    // [MODIFICADO] Extrai apenas o nome do arquivo para exibição
    // ex: 'mp3/musica.mp3' vira 'musica.mp3'
    // ex: 'meu-zip.zip' vira 'meu-zip.zip'
    const displayName = fullPath.split('/').pop();

    let iconId, btnText, btnColor, iconColor;

    switch (type) {
        case 'mp4':
            iconId = '#icon-video';
            btnText = 'Baixar MP4';
            btnColor = 'bg-purple-600 hover:bg-purple-700';
            iconColor = 'text-purple-500';
            break;
        case 'zip':
            iconId = '#icon-zip';
            // [MODIFICADO] Altera o texto do botão ZIP
            btnText = 'Baixar Tudo (ZIP)';
            btnColor = 'bg-blue-600 hover:bg-blue-700';
            iconColor = 'text-blue-500';
            break;
        case 'mp3':
        default:
            iconId = '#icon-music';
            btnText = 'Download MP3';
            btnColor = 'bg-green-600 hover:bg-green-700';
            iconColor = 'text-cyan-500';
            break;
    }

    const fileItem = document.createElement('div');
    fileItem.className = 'flex justify-between items-center p-3 bg-white border border-gray-200 rounded-lg animate-fade-in';
    fileItem.innerHTML = `
        <div class="flex items-center min-w-0">
            <svg class="w-5 h-5 ${iconColor} flex-shrink-0" fill="currentColor">
                <use href="${iconId}"></use>
            </svg>
            <span class="ml-3 text-sm font-medium text-gray-700 truncate" title="${displayName}">${displayName}</span>
        </div>
        
        <a href="/api/download/${encodeURIComponent(fullPath)}" 
           class="ml-4 px-3 py-1.5 ${btnColor} text-white text-sm font-medium rounded-md transition-colors flex-shrink-0" 
           target="_blank">
            ${btnText}
        </a>
    `;
    filesListDiv.prepend(fileItem);
}

// --- Event Listeners ---
convertBtn.addEventListener('click', () => {
    const urls = videoUrlsInput.value.trim();
    if (!urls) {
        videoUrlsInput.classList.add('ring-2', 'ring-red-500');
        videoUrlsInput.placeholder = 'Por favor, cole pelo menos um link aqui!';
        setTimeout(() => {
            videoUrlsInput.classList.remove('ring-2', 'ring-red-500');
            videoUrlsInput.placeholder = 'Cole um ou mais links do YouTube aqui (um por linha)...';
        }, 2500);
        return;
    }

    resetProcessScreen(); 
    showStep('process');
    socket.emit('download-video', { urls });
});

newDownloadBtn.addEventListener('click', () => {
    resetForNewDownload();
});

// --- Inicialização ---
showStep('insert'); // Mostra a tela de inserção
