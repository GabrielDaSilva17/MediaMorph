import express from 'express';
import color from 'color';
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { chmodSync } from 'fs';
import { promisify } from 'util';
import archiver from 'archiver';

const execPromise = promisify(exec);
const app = express();
const PORT = 3000;

const YTDLP_FILENAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const YTDLP_PATH = path.resolve(process.cwd(), YTDLP_FILENAME);

// Gerenciador de conexões para progresso em tempo real
let clients = [];
function sendToUI(data) {
    clients.forEach(c => c.res.write(`data: ${JSON.stringify(data)}\n\n`));
}

async function ensureYtDlp() {
    if (fs.existsSync(YTDLP_PATH)) return;
    const url = process.platform === 'win32' 
        ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
        : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
    try {
        const response = await axios({ url, method: 'GET', responseType: 'stream' });
        const writer = fs.createWriteStream(YTDLP_PATH);
        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                if (process.platform !== 'win32') chmodSync(YTDLP_PATH, '755');
                resolve();
            });
            writer.on('error', reject);
        });
    } catch (error) { process.exit(1); }
}

app.use(express.json());

const getRandomTheme = () => {
    const hue = Math.floor(Math.random() * 360);
    return {
        hex: color.hsl(hue, 30, 10).hex(),
        text: '#E2E8F0',
        accent: color.hsl(hue, 80, 60).hex() 
    };
};

// Rota de Eventos para a UI ouvir
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const id = Date.now();
    clients.push({ id, res });
    req.on('close', () => clients = clients.filter(c => c.id !== id));
});

app.get('/', (req, res) => {
    const theme = getRandomTheme();
    res.send(`
    <!DOCTYPE html>
    <html lang="pt-br">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>MediaMorph - Premium Downloader</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&display=swap');
            :root { --bg-color: ${theme.hex}; --text-color: ${theme.text}; --accent-color: ${theme.accent}; }
            body { font-family: 'Inter', sans-serif; background-color: var(--bg-color); color: var(--text-color); }
            .glass { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.1); }
            .gradient-text { background: linear-gradient(90deg, #38bdf8, var(--accent-color), #c084fc); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
            .btn-primary { background: linear-gradient(135deg, var(--accent-color) 0%, #818cf8 100%); transition: all 0.3s ease; }
            .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 0 20px rgba(56, 189, 248, 0.4); }
            .log-box { background: rgba(0,0,0,0.6); border-radius: 12px; font-family: 'Consolas', monospace; font-size: 11px; height: 160px; overflow-y: auto; padding: 12px; color: #10b981; border: 1px solid rgba(255,255,255,0.05); line-height: 1.5; }
            .progress-bar-fill { transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1); }
        </style>
    </head>
    <body class="min-h-screen flex items-center justify-center p-4">
        <div class="max-w-2xl w-full glass rounded-3xl p-8 shadow-2xl text-center">
            <h1 class="text-5xl font-extrabold mb-2 gradient-text">MediaMorph</h1>
            <p class="text-slate-400 mb-8 text-sm uppercase tracking-widest">Downloader Inteligente</p>

            <div class="space-y-6">
                <div class="relative">
                    <label class="text-xs font-bold uppercase text-slate-500 mb-2 block text-left ml-2">URL da Mídia</label>
                    <input type="text" id="url" placeholder="Cole o link aqui..." 
                        class="w-full bg-slate-900 border border-slate-700 rounded-xl py-4 px-4 focus:outline-none focus:border-blue-500 text-white">
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div class="text-left">
                        <label class="text-xs font-bold uppercase text-slate-500 mb-2 block ml-2">Formato</label>
                        <select id="format" class="w-full bg-slate-800 border border-slate-700 rounded-xl p-4 text-sm outline-none text-white">
                            <option value="mp3">MP3 (Áudio)</option>
                            <option value="mp4">MP4 (Vídeo)</option>
                        </select>
                    </div>
                    <div class="text-left">
                        <label class="text-xs font-bold uppercase text-slate-500 mb-2 block ml-2">Tipo de Download</label>
                        <select id="mode" class="w-full bg-slate-800 border border-slate-700 rounded-xl p-4 text-sm outline-none text-white">
                            <option value="auto">Auto-Detectar</option>
                            <option value="single">Apenas este vídeo</option>
                            <option value="playlist">Playlist Completa (ZIP)</option>
                        </select>
                    </div>
                </div>

                <button id="dlBtn" class="btn-primary w-full py-5 rounded-2xl font-black text-lg text-slate-900">
                    BAIXAR AGORA
                </button>

                <div id="statusArea" class="hidden space-y-4">
                    <div class="flex justify-between text-xs font-bold">
                        <span id="statusLabel" class="text-blue-400 uppercase tracking-tighter">SINCRONIZANDO...</span>
                        <span id="percentText">0%</span>
                    </div>
                    <div class="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div id="progressBar" class="h-full bg-blue-500 progress-bar-fill" style="width: 0%"></div>
                    </div>
                    
                    <div class="text-left">
                        <label class="text-[10px] font-bold uppercase text-slate-500 mb-1 block ml-1">Terminal de Processamento</label>
                        <div id="logBox" class="log-box"></div>
                    </div>
                </div>
            </div>
        </div>

        <script>
            const btn = document.getElementById('dlBtn');
            const statusArea = document.getElementById('statusArea');
            const progressBar = document.getElementById('progressBar');
            const percentText = document.getElementById('percentText');
            const logBox = document.getElementById('logBox');
            const statusLabel = document.getElementById('statusLabel');

            function addLog(msg, isHeader = false) {
                const line = document.createElement('div');
                line.style.marginBottom = "4px";
                if(isHeader) line.style.color = "var(--accent-color)";
                line.innerHTML = \`<span style="color: #475569">[\${new Date().toLocaleTimeString()}]</span> \${msg}\`;
                logBox.appendChild(line);
                logBox.scrollTop = logBox.scrollHeight;
            }

            // OUVIR O SERVIDOR EM TEMPO REAL
            const evtSource = new EventSource('/events');
            evtSource.onmessage = (e) => {
                const data = JSON.parse(e.data);
                if(data.type === 'log') addLog(data.msg, data.header);
                if(data.type === 'progress') {
                    progressBar.style.width = data.percent + '%';
                    percentText.innerText = Math.round(data.percent) + '%';
                    if(data.label) statusLabel.innerText = data.label;
                }
            };

            btn.onclick = () => {
                const url = document.getElementById('url').value.trim();
                const format = document.getElementById('format').value;
                const mode = document.getElementById('mode').value;
                
                if(!url) return alert('Insira um link!');

                statusArea.classList.remove('hidden');
                logBox.innerHTML = '';
                addLog('Iniciando comunicação com motor de download...', true);

                // Redireciona para o download
                window.location.href = '/download?url=' + encodeURIComponent(url) + '&format=' + format + '&mode=' + mode;
            };
        </script>
    </body>
    </html>
    `);
});

app.get('/download', async (req, res) => {
    const { url, format, mode } = req.query;
    if (!url) return res.status(400).send('URL faltando');

    try {
        const ext = format === 'mp3' ? 'mp3' : 'mp4';
        const isPlaylist = url.includes('list=') || mode === 'playlist';

        if (isPlaylist && mode !== 'single') {
            sendToUI({ type: 'log', msg: 'Analisando Playlist... Identificando arquivos.', header: true });
            
            const { stdout } = await execPromise(`"${YTDLP_PATH}" --get-title --get-id --flat-playlist "${url}"`);
            const lines = stdout.trim().split('\n');
            const videos = [];
            for (let i = 0; i < lines.length; i += 2) {
                if (lines[i] && lines[i+1]) videos.push({ title: lines[i], id: lines[i+1] });
            }

            sendToUI({ type: 'log', msg: `Encontrados ${videos.length} arquivos. Iniciando empacotamento ZIP...` });
            
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', 'attachment; filename="playlist_mediamorph.zip"');

            const archive = archiver('zip', { zlib: { level: 5 } });
            archive.pipe(res);

            for (let i = 0; i < videos.length; i++) {
                const video = videos[i];
                const cleanTitle = video.title.replace(/[^\w\s]/gi, '');
                
                sendToUI({ 
                    type: 'progress', 
                    percent: ((i) / videos.length) * 100, 
                    label: `BAIXANDO ${i+1} DE ${videos.length}` 
                });
                sendToUI({ type: 'log', msg: `Processando: ${video.title}` });

                let args = ['--no-playlist', '-o', '-', `https://www.youtube.com/watch?v=${video.id}`];
                if (format === 'mp3') args.push('-x', '--audio-format', 'mp3');
                else args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]');

                const downloader = spawn(YTDLP_PATH, args);
                archive.append(downloader.stdout, { name: `${cleanTitle}.${ext}` });
                await new Promise(resolve => downloader.on('close', resolve));
            }

            sendToUI({ type: 'progress', percent: 100, label: 'PLAYLIST CONCLUÍDA!' });
            sendToUI({ type: 'log', msg: 'ZIP finalizado e enviado.', header: true });
            archive.finalize();

        } else {
            sendToUI({ type: 'log', msg: 'Extraindo metadados do arquivo...', header: true });
            const { stdout: titleRaw } = await execPromise(`"${YTDLP_PATH}" --get-title --no-playlist "${url}"`);
            const title = titleRaw.trim().replace(/[^\w\s]/gi, '');
            
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${title}.${ext}"`);

            let args = ['--no-playlist', '--newline', '--progress', '-o', '-', url];
            if (format === 'mp3') args.push('-x', '--audio-format', 'mp3');
            else args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');

            const downloader = spawn(YTDLP_PATH, args);
            downloader.stdout.pipe(res);

            downloader.stderr.on('data', (data) => {
                const line = data.toString();
                const match = line.match(/(\d+\.\d+)%/);
                if (match) {
                    const p = parseFloat(match[1]);
                    sendToUI({ type: 'progress', percent: p, label: 'BAIXANDO ARQUIVO...' });
                    if (line.includes('ETA')) {
                        const eta = line.split('ETA')[1].trim();
                        if (Math.round(p) % 5 === 0) sendToUI({ type: 'log', msg: `Baixado: ${p}% | Tempo Restante: ${eta}` });
                    }
                }
            });

            downloader.on('close', () => {
                sendToUI({ type: 'progress', percent: 100, label: 'DOWNLOAD COMPLETO!' });
                sendToUI({ type: 'log', msg: 'Arquivo enviado com sucesso.', header: true });
                res.end();
            });
        }
    } catch (error) {
        sendToUI({ type: 'log', msg: 'ERRO: ' + error.message });
        if (!res.headersSent) res.status(500).send('Erro no processamento.');
    }
});

ensureYtDlp().then(() => {
    app.listen(PORT, () => console.log(`🚀 MediaMorph pronto em http://localhost:${PORT}`));
});