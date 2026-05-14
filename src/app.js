// ==========================================
// --- 0. LOG VISÍVEL EM ARQUIVO ---
// ==========================================
const _fs = require('fs');
const _logPath = require('path').join(require('path').dirname(process.execPath), 'verde_debug.log');
try { _fs.writeFileSync(_logPath, ''); } catch (e) { } // limpa o log ao iniciar
function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
    try { _fs.appendFileSync(_logPath, line); } catch (e) { }
}
log('=== LAUNCHER INICIADO ===');
log('Log path: ' + _logPath);

// ==========================================
// --- 1. CONTROLES DE JANELA (Carrega Primeiro!) ---
// ==========================================
const appWindow = nw.Window.get();
const titleBar = document.getElementById('title-bar');
let isMaximized = true;
let capaGlobal = 'logo';

appWindow.on('maximize', () => { isMaximized = true; });
appWindow.on('restore', () => { isMaximized = false; });

document.getElementById('btn-minimize').addEventListener('click', () => appWindow.minimize());
document.getElementById('btn-maximize').addEventListener('click', () => { if (isMaximized) appWindow.unmaximize(); else appWindow.maximize(); });
document.getElementById('btn-close').addEventListener('click', () => appWindow.close());
document.getElementById('btn-login-minimize').addEventListener('click', () => appWindow.minimize());
document.getElementById('btn-login-close').addEventListener('click', () => appWindow.close());

// ==========================================
// --- 2. CONTROLES DO BROWSER E LOADING ---
// ==========================================
const webview = document.getElementById('streaming-view');
const loadingOverlay = document.getElementById('loading-overlay');
const windowTitle = document.getElementById('window-title');
const appName = "Stream Verde";
let shouldAutoFullscreen = false;
let spinnerSafetyTimer = null;
let hasCommitted = true;

document.getElementById('btn-back').addEventListener('click', () => { loadingOverlay.style.display = 'flex'; webview.back(); });
document.getElementById('btn-forward').addEventListener('click', () => { loadingOverlay.style.display = 'flex'; webview.forward(); });
document.getElementById('btn-reload').addEventListener('click', () => { loadingOverlay.style.display = 'flex'; webview.reload(); });

webview.addEventListener('loadstart', (e) => {
    if (e.isTopLevel === false) return;
    hasCommitted = false;
    loadingOverlay.style.display = 'flex';
    windowTitle.innerText = 'Carregando...';
    document.title = `Carregando... - ${appName}`;
    setDiscordStatus('Navegando no catálogo...', 'Escolhendo o que assistir');
    clearTimeout(spinnerSafetyTimer);
    spinnerSafetyTimer = setTimeout(() => {
        if (loadingOverlay.style.display === 'flex') loadingOverlay.style.display = 'none';
        hasCommitted = true;
    }, 15000);
});

webview.addEventListener('loadcommit', (e) => { if (e.isTopLevel) hasCommitted = true; });

webview.addEventListener('loadstop', (e) => {
    if (e.isTopLevel === false || !hasCommitted) return;
    webview.executeScript({ code: "window.location.href" }, function (results) {
        if (results && results[0] && results[0].includes('wp-login.php')) return;
        clearTimeout(spinnerSafetyTimer);
        setTimeout(() => {
            loadingOverlay.style.display = 'none';
            webview.executeScript({ code: "document.title" }, function (res) {
                if (res && res[0] && res[0].trim() !== '') { windowTitle.innerText = res[0]; document.title = `${res[0]} - ${appName}`; }
                else if (windowTitle.innerText === 'Carregando...') { windowTitle.innerText = 'Início'; document.title = appName; }
            });
            webview.focus();
        }, 300);
    });
});

webview.addEventListener('page-title-updated', (e) => {
    if (e.title && e.title.trim() !== '') { windowTitle.innerText = e.title; document.title = `${e.title} - ${appName}`; }
});

// ==========================================
// --- 3. SISTEMA DE LOGIN BLINDADO (Integração WP) ---
// ==========================================
const SITE_DOMAIN = 'https://streamverde.net';
const LOGIN_API = SITE_DOMAIN + '/wp-json/steamverde/v1/launcher-login';
const CHECK_API = SITE_DOMAIN + '/wp-json/steamverde/v1/launcher-check';

const loginOverlay = document.getElementById('login-overlay');
const loginUser = document.getElementById('login-user');
const loginPass = document.getElementById('login-pass');
const loginRemember = document.getElementById('login-remember');
const btnLogin = document.getElementById('btn-login');
const loginError = document.getElementById('login-error');

let lockWindowInterval = null;
let isLoggingIn = false;
let checkSubInterval = null;

const pressionarEnter = (e) => { if (e.key === 'Enter') btnLogin.click(); };
if (loginUser) loginUser.addEventListener('keydown', pressionarEnter);
if (loginPass) loginPass.addEventListener('keydown', pressionarEnter);

function checarSessaoLocal() {
    if (localStorage.getItem('sv_logged_in') === 'true' || sessionStorage.getItem('sv_logged_in') === 'true') {
        clearInterval(lockWindowInterval); loginOverlay.style.display = 'none'; titleBar.style.display = 'flex';
        setTimeout(() => { appWindow.maximize(); }, 150); webview.src = SITE_DOMAIN;
        iniciarVerificacaoAssinatura();
        iniciarHeartbeat();
    } else {
        titleBar.style.display = 'none'; loginOverlay.style.display = 'flex'; webview.src = 'about:blank';
        appWindow.leaveFullscreen(); appWindow.unmaximize(); appWindow.resizeTo(450, 680); appWindow.setPosition('center');
        lockWindowInterval = setInterval(() => {
            if (window.innerWidth > 600 && localStorage.getItem('sv_logged_in') !== 'true' && sessionStorage.getItem('sv_logged_in') !== 'true') {
                appWindow.unmaximize(); appWindow.resizeTo(450, 680);
            }
        }, 300);
    }
}

function forcarLogout(msgErro) {
    localStorage.removeItem('sv_logged_in'); sessionStorage.removeItem('sv_logged_in');
    localStorage.removeItem('sv_user_id');
    if (checkSubInterval) { clearInterval(checkSubInterval); checkSubInterval = null; }
    pararHeartbeat();
    // Navegar para o endpoint de logout server-side (limpa cookies httpOnly)
    webview.src = SITE_DOMAIN + '/?sv_auto_logout=1';
    // Limpar cookies da partição trusted
    chrome.cookies.getAll({ storeId: "persist:trusted", url: SITE_DOMAIN }, function (cookies) {
        for (let i = 0; i < cookies.length; i++) { chrome.cookies.remove({ storeId: "persist:trusted", url: SITE_DOMAIN + cookies[i].path, name: cookies[i].name }); }
    });
    // Limpar cookies da partição google_oauth também
    chrome.cookies.getAll({ storeId: "persist:google_oauth", url: SITE_DOMAIN }, function (cookies) {
        for (let i = 0; i < cookies.length; i++) { chrome.cookies.remove({ storeId: "persist:google_oauth", url: SITE_DOMAIN + cookies[i].path, name: cookies[i].name }); }
    });
    // Após um breve delay, limpar webview e mostrar login
    setTimeout(() => {
        webview.src = 'about:blank';
    }, 1500);
    titleBar.style.display = 'none';
    appWindow.leaveFullscreen(); appWindow.unmaximize(); appWindow.resizeTo(450, 680); appWindow.setPosition('center');
    lockWindowInterval = setInterval(() => {
        if (window.innerWidth > 600 && localStorage.getItem('sv_logged_in') !== 'true' && sessionStorage.getItem('sv_logged_in') !== 'true') {
            appWindow.unmaximize(); appWindow.resizeTo(450, 680);
        }
    }, 300);
    loginOverlay.style.display = 'flex';
    if (msgErro) { loginError.innerText = msgErro; loginError.style.display = 'block'; }
}

let isGoogleLoggingIn = false;

webview.addEventListener('loadcommit', (e) => {
    if (e.isTopLevel && isLoggingIn) {
        const user = loginUser.value.trim(); const pass = loginPass.value.trim(); const rememberMe = loginRemember ? loginRemember.checked : true;
        const autoLoginScript = `
            document.documentElement.style.opacity = '0'; document.documentElement.style.pointerEvents = 'none'; document.body.style.background = '#0a0b0d';
            var form = document.createElement('form'); form.method = 'POST'; form.action = '${SITE_DOMAIN}/wp-login.php'; form.style.display = 'none';
            var u = document.createElement('input'); u.type = 'hidden'; u.name = 'log'; u.value = '${user}'; form.appendChild(u);
            var p = document.createElement('input'); p.type = 'hidden'; p.name = 'pwd'; p.value = '${pass}'; form.appendChild(p);
            if (${rememberMe}) { var r = document.createElement('input'); r.type = 'hidden'; r.name = 'rememberme'; r.value = 'forever'; form.appendChild(r); }
            var redir = document.createElement('input'); redir.type = 'hidden'; redir.name = 'redirect_to'; redir.value = '${SITE_DOMAIN}/'; form.appendChild(redir);
            document.body.appendChild(form); form.submit();
        `;
        webview.executeScript({ code: autoLoginScript });
        isLoggingIn = false;
    }
});

if (btnLogin) {
    btnLogin.addEventListener('click', () => {
        const user = loginUser.value.trim(); const pass = loginPass.value.trim(); const rememberMe = loginRemember ? loginRemember.checked : true;
        if (!user || !pass) { loginError.innerText = "Preencha usuário e senha."; loginError.style.display = 'block'; return; }
        btnLogin.innerText = "Verificando..."; btnLogin.disabled = true; loginError.style.display = 'none';
        const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 12000);
        fetch(LOGIN_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: user, password: pass, remember: rememberMe }), signal: controller.signal })
            .then(async res => { clearTimeout(timeoutId); const data = await res.json(); if (!res.ok || data.code) throw new Error(data.message || "Usuário incorreto."); return data; })
            .then(data => {
                if (data.success) {
                    btnLogin.innerText = "Entrar no Launcher"; btnLogin.disabled = false;
                    if (rememberMe) localStorage.setItem('sv_logged_in', 'true'); else sessionStorage.setItem('sv_logged_in', 'true');
                    localStorage.setItem('sv_user_id', data.user_id);
                    localStorage.setItem('sv_username', user);
                    loginError.style.display = 'none'; loginOverlay.style.display = 'none';
                    clearInterval(lockWindowInterval); titleBar.style.display = 'flex'; appWindow.maximize();
                    isLoggingIn = true; webview.src = SITE_DOMAIN + '/wp-login.php';
                } else { throw new Error("Usuário ou senha incorretos."); }
            })
            .catch(err => {
                clearTimeout(timeoutId); btnLogin.innerText = "Entrar no Launcher"; btnLogin.disabled = false;
                if (err.name === 'AbortError') loginError.innerText = "Servidor offline.";
                else if (err.message.includes('Unexpected token')) loginError.innerText = "Bloqueio do Site (Cloudflare).";
                else loginError.innerText = err.message;
                loginError.style.display = 'block';
            });
    });
}
// --- BOTÃO GOOGLE LOGIN ---
const GOOGLE_CHECK_API = SITE_DOMAIN + '/wp-json/steamverde/v1/launcher-google-check';
const btnGoogleLogin = document.getElementById('btn-google-login');

if (btnGoogleLogin) {
    btnGoogleLogin.addEventListener('click', () => {
        loginError.style.display = 'none';
        btnGoogleLogin.style.opacity = '0.6';
        btnGoogleLogin.style.pointerEvents = 'none';

        // Limpar flags anteriores
        localStorage.removeItem('sv_google_ready');
        localStorage.removeItem('sv_google_cookie');

        log('Google Login: abrindo popup');

        nw.Window.open('src/google_login.html', {
            width: 500,
            height: 650,
            position: 'center',
            resizable: false,
            frame: true,
            title: 'Login com Google - Stream Verde',
            icon: 'src/icon.png'
        }, function (googleWin) {
            if (!googleWin) {
                log('Google Login: falha ao abrir janela');
                btnGoogleLogin.style.opacity = '1';
                btnGoogleLogin.style.pointerEvents = 'auto';
                return;
            }

            let googleLoginDone = false;
            let pollInterval = null;

            const finalizarGoogle = () => {
                googleLoginDone = true;
                if (pollInterval) clearInterval(pollInterval);
                localStorage.removeItem('sv_google_ready');
                localStorage.removeItem('sv_google_cookie');
                btnGoogleLogin.style.opacity = '1';
                btnGoogleLogin.style.pointerEvents = 'auto';
            };

            // Monitorar localStorage (a popup escreve lá quando detecta login)
            pollInterval = setInterval(() => {
                if (googleLoginDone) return;
                const ready = localStorage.getItem('sv_google_ready');
                if (!ready) return;

                log('Google Login: popup sinalizou! ready=' + ready);
                googleLoginDone = true;
                clearInterval(pollInterval);

                if (ready === 'ok') {
                    const userId = localStorage.getItem('sv_google_user_id');
                    const autoToken = localStorage.getItem('sv_google_auto_token');
                    log('Google Login: sucesso! user_id=' + userId + ' token=' + (autoToken ? 'sim' : 'não'));
                    localStorage.setItem('sv_logged_in', 'true');
                    localStorage.setItem('sv_user_id', userId);
                    // Limpar flags temporárias
                    localStorage.removeItem('sv_google_ready');
                    localStorage.removeItem('sv_google_user_id');
                    localStorage.removeItem('sv_google_display_name');
                    localStorage.removeItem('sv_google_error');
                    localStorage.removeItem('sv_google_auto_token');

                    loginError.style.display = 'none';
                    loginOverlay.style.display = 'none';
                    clearInterval(lockWindowInterval);
                    titleBar.style.display = 'flex';
                    appWindow.maximize();
                    // Navegar para URL de auto-login (WordPress seta os cookies via HTTP)
                    if (autoToken) {
                        webview.src = SITE_DOMAIN + '/?sv_auto_login=' + autoToken;
                    } else {
                        webview.src = SITE_DOMAIN;
                    }
                    iniciarVerificacaoAssinatura();
                    try { googleWin.close(true); } catch (e) { }
                } else {
                    // Erro (not_vip, sessão inválida, etc)
                    const errorMsg = localStorage.getItem('sv_google_error') || 'Erro ao validar login.';
                    log('Google Login: erro - ' + errorMsg);
                    loginError.innerText = errorMsg;
                    loginError.style.display = 'block';
                    localStorage.removeItem('sv_google_ready');
                    localStorage.removeItem('sv_google_error');
                    try { googleWin.close(true); } catch (e) { }
                    finalizarGoogle();
                }
            }, 1000);

            googleWin.on('closed', function () {
                finalizarGoogle();
            });
        });
    });
}

checarSessaoLocal();





// ==========================================
// --- 3.5 VERIFICAÇÃO PERIÓDICA DE ASSINATURA ---
// ==========================================
function verificarAssinatura() {
    const userId = localStorage.getItem('sv_user_id');
    if (!userId) { log('Check: sem user_id salvo, pulando.'); return; }

    log('Check: verificando assinatura para user_id=' + userId);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    fetch(CHECK_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: parseInt(userId) }),
        signal: controller.signal
    })
        .then(async res => {
            clearTimeout(timeoutId);
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Erro na verificação');
            return data;
        })
        .then(data => {
            if (data.active) {
                log('Check: assinatura ativa.');
            } else {
                log('Check: assinatura EXPIRADA! Forçando logout.');
                forcarLogout('⚠️ Sua assinatura expirou. Renove para continuar usando o launcher.');
            }
        })
        .catch(err => {
            // Em caso de erro de rede, não deslogamos (pode ser offline temporário)
            log('Check: erro na verificação - ' + err.message);
        });
}

function iniciarVerificacaoAssinatura() {
    if (checkSubInterval) clearInterval(checkSubInterval);
    // Verificar 10s após o login e depois a cada 5 minutos
    setTimeout(() => verificarAssinatura(), 10000);
    checkSubInterval = setInterval(() => verificarAssinatura(), 5 * 60 * 1000);
}

// ==========================================
// --- 3.6 ANALYTICS HEARTBEAT ---
// ==========================================
var heartbeatInterval = null;
var HEARTBEAT_API = SITE_DOMAIN + '/wp-json/sv/v1/heartbeat';

function enviarHeartbeat() {
    const userId = localStorage.getItem('sv_user_id');
    if (!userId) { log('Heartbeat: sem user_id, abortando.'); return; }
    
    const username = loginUser ? loginUser.value.trim() : '';
    const appVersion = (typeof currentVersion !== 'undefined') ? currentVersion : '0.0.0';
    const finalUsername = username || localStorage.getItem('sv_username') || 'user_' + userId;
    
    log('Heartbeat: enviando... user_id=' + userId + ' username=' + finalUsername + ' version=' + appVersion);
    
    fetch(HEARTBEAT_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            user_id: parseInt(userId),
            username: finalUsername,
            platform: 'launcher',
            app_version: appVersion,
            current_page: (typeof windowTitle !== 'undefined' && windowTitle) ? windowTitle.innerText || '' : ''
        })
    })
    .then(res => res.json())
    .then(data => log('Heartbeat: resposta OK - ' + JSON.stringify(data)))
    .catch(err => log('Heartbeat: ERRO - ' + err.message));
}

function iniciarHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    setTimeout(() => enviarHeartbeat(), 5000); // Primeiro ping 5s após login
    heartbeatInterval = setInterval(() => enviarHeartbeat(), 15000); // Depois a cada 15s
}

function pararHeartbeat() {
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
}

// ==========================================
// --- 4 E 5. CONFIGURAÇÕES E UPDATER ---
// ==========================================
let rpcEnabled = localStorage.getItem('sv_discord') !== 'false'; let autoNextEnabled = localStorage.getItem('sv_autonext') !== 'false';
let autoSkipEnabled = localStorage.getItem('sv_autoskip') === 'true'; // Pular abertura automático
let freioEnabled = localStorage.getItem('sv_freio') !== 'false'; let freioLimit = parseInt(localStorage.getItem('sv_freio_limit')) || 10; let episociosSeguidos = 0;
let elDiscord = document.getElementById('toggle-discord');
if (elDiscord) elDiscord.checked = rpcEnabled;
let elAutoNext = document.getElementById('toggle-autonext');
if (elAutoNext) elAutoNext.checked = autoNextEnabled;
let elAutoSkip = document.getElementById('toggle-autoskip');
if (elAutoSkip) elAutoSkip.checked = autoSkipEnabled;

const toggleFreioBtn = document.getElementById('toggle-freio'); const inputFreioLimit = document.getElementById('input-freio-limite');
if (toggleFreioBtn) toggleFreioBtn.checked = freioEnabled; if (inputFreioLimit) inputFreioLimit.value = freioLimit;
let elSettings = document.getElementById('btn-settings');
if (elSettings) elSettings.addEventListener('click', () => { let sm = document.getElementById('settings-modal'); if(sm) sm.style.display = 'flex'; });
let elCloseSet = document.getElementById('close-settings');
if (elCloseSet) elCloseSet.addEventListener('click', () => { let sm = document.getElementById('settings-modal'); if(sm) sm.style.display = 'none'; });

if (elDiscord) elDiscord.addEventListener('change', (e) => { rpcEnabled = e.target.checked; localStorage.setItem('sv_discord', rpcEnabled); if (!rpcEnabled && typeof rpc !== 'undefined' && rpcReady) rpc.clearActivity(); if (rpcEnabled && rpcReady) setDiscordStatus('Navegando no catálogo...', 'Escolhendo o que assistir'); });
if (elAutoNext) elAutoNext.addEventListener('change', (e) => { autoNextEnabled = e.target.checked; localStorage.setItem('sv_autonext', autoNextEnabled); });
if (elAutoSkip) elAutoSkip.addEventListener('change', (e) => { autoSkipEnabled = e.target.checked; localStorage.setItem('sv_autoskip', autoSkipEnabled); });
if (toggleFreioBtn) toggleFreioBtn.addEventListener('change', (e) => { freioEnabled = e.target.checked; localStorage.setItem('sv_freio', freioEnabled); });
if (inputFreioLimit) inputFreioLimit.addEventListener('change', (e) => { let val = parseInt(e.target.value); if (val < 1) val = 1; freioLimit = val; localStorage.setItem('sv_freio_limit', freioLimit); });

const btnLogoutApp = document.getElementById('btn-logout-app');
if (btnLogoutApp) btnLogoutApp.addEventListener('click', () => { document.getElementById('settings-modal').style.display = 'none'; forcarLogout("Você saiu com sucesso."); });

const repoUrl = 'https://raw.githubusercontent.com/steamverdeoficial/stream-verde/main/package.json';
const releasesApiUrl = 'https://api.github.com/repos/steamverdeoficial/stream-verde/releases/latest';
let currentVersion = '0.0.0';
let isDownloading = false;
let latestInstallerUrl = null;
let latestVersionAvailable = null;
if (nw && nw.App && nw.App.manifest && nw.App.manifest.version) { 
    currentVersion = nw.App.manifest.version; 
    log('Versão lida de nw.App.manifest: ' + currentVersion);
} else {
    // Fallback: ler direto do package.json
    try {
        const pkg = require('./package.json');
        currentVersion = pkg.version || '0.0.0';
        log('Versão lida de package.json (fallback): ' + currentVersion);
    } catch(e) {
        log('ERRO ao ler versão: ' + e.message);
    }
}
let elAppVer = document.getElementById('app-version');
if (elAppVer) elAppVer.innerText = `v${currentVersion}`; 
let elSetVer = document.getElementById('settings-version-text');
if (elSetVer) elSetVer.innerText = `v${currentVersion}`; 

    // Função reutilizável para converter markdown do GitHub em HTML
    function parseChangelogMarkdown(body) {
        let text = body.replace(/\r\n/g, '\n');
        
        // Processar tabelas markdown ANTES de qualquer outra coisa
        const lines = text.split('\n');
        let result = [];
        let i = 0;
        while (i < lines.length) {
            // Detectar início de tabela: linha com | e próxima linha é separador (|---|)
            if (lines[i].trim().startsWith('|') && i + 1 < lines.length && /^\|[\s:-]+\|/.test(lines[i + 1].trim())) {
                let tableHTML = '<table style="width:100%; border-collapse:collapse; margin:12px 0; font-size:13px;">';
                // Header
                const headers = lines[i].split('|').filter(c => c.trim() !== '');
                tableHTML += '<tr>';
                headers.forEach(h => {
                    tableHTML += '<th style="border:1px solid #444; padding:10px 12px; background:#252525; color:#81bc00; text-align:left; font-weight:600;">' + h.trim() + '</th>';
                });
                tableHTML += '</tr>';
                i += 2; // Pular header + separador
                // Rows
                const totalCols = headers.length;
                while (i < lines.length && lines[i].trim().startsWith('|')) {
                    // Pegar todas as colunas incluindo vazias
                    const rawCols = lines[i].split('|');
                    rawCols.shift(); // remove o primeiro vazio antes do primeiro |
                    if (rawCols.length > 0 && rawCols[rawCols.length - 1].trim() === '') rawCols.pop(); // remove último vazio
                    
                    const col1 = rawCols[0] ? rawCols[0].trim() : '';
                    const col2 = rawCols[1] ? rawCols[1].trim() : '';
                    
                    tableHTML += '<tr>';
                    if (totalCols === 2 && col1 && !col2) {
                        // Primeira coluna tem conteúdo, segunda vazia → colspan
                        let cell = col1.replace(/\*\*(.*?)\*\*/g, '<strong style="color:#fff;">$1</strong>');
                        tableHTML += '<td colspan="2" style="border:1px solid #333; padding:10px 14px; color:#ccc;">' + cell + '</td>';
                    } else if (totalCols === 2 && !col1 && col2) {
                        // Primeira vazia, segunda com conteúdo → colspan
                        let cell = col2.replace(/\*\*(.*?)\*\*/g, '<strong style="color:#fff;">$1</strong>');
                        tableHTML += '<td colspan="2" style="border:1px solid #333; padding:10px 14px; color:#ccc; padding-left:20px;">' + cell + '</td>';
                    } else {
                        // Ambas com conteúdo → normal
                        rawCols.forEach(c => {
                            let cell = (c || '').trim();
                            cell = cell.replace(/\*\*(.*?)\*\*/g, '<strong style="color:#fff;">$1</strong>');
                            tableHTML += '<td style="border:1px solid #333; padding:10px 14px; color:#ccc; vertical-align:top;">' + cell + '</td>';
                        });
                    }
                    tableHTML += '</tr>';
                    i++;
                }
                tableHTML += '</table>';
                result.push(tableHTML);
            } else {
                result.push(lines[i]);
                i++;
            }
        }
        text = result.join('\n');
        
        // Processar o resto do markdown
        text = text.replace(/^### (.*$)/gim, '<h3 style="color:#81bc00; margin-top:15px; margin-bottom:5px; font-size:15px;">$1</h3>');
        text = text.replace(/^## (.*$)/gim, '<h2 style="color:#81bc00; margin-top:15px; margin-bottom:5px; font-size:17px;">$1</h2>');
        text = text.replace(/^# (.*$)/gim, '<h1 style="color:#81bc00; margin-top:15px; margin-bottom:5px; font-size:19px;">$1</h1>');
        text = text.replace(/\*\*(.*?)\*\*/gim, '<strong style="color:#fff;">$1</strong>');
        text = text.replace(/^\* (.*$)/gim, '<div style="margin-left:15px; margin-bottom:5px;">• $1</div>');
        text = text.replace(/^- (.*$)/gim, '<div style="margin-left:15px; margin-bottom:5px;">• $1</div>');
        text = text.replace(/\n/gim, '<br>');
        return text;
    }

    function fetchAndShowChangelog() {
        document.getElementById('changelog-content').innerHTML = 'Carregando novidades...';
        document.getElementById('changelog-modal').style.display = 'flex';
        fetch(releasesApiUrl, { cache: 'no-store' })
            .then(res => res.json())
            .then(data => {
                if (data.body) {
                    document.getElementById('changelog-content').innerHTML = parseChangelogMarkdown(data.body);
                } else {
                    document.getElementById('changelog-content').innerHTML = 'Nenhum changelog disponível para esta versão.';
                }
            })
            .catch(err => { document.getElementById('changelog-content').innerHTML = 'Não foi possível carregar o changelog.'; });
    }

    const closeChangelog = () => {
        document.getElementById('changelog-modal').style.display = 'none';
        localStorage.setItem('sv_last_version_seen', currentVersion);
    };
    document.getElementById('close-changelog').addEventListener('click', closeChangelog);
    document.getElementById('btn-changelog-ok').addEventListener('click', closeChangelog);

    // Botão "Ver Changelog" nas configurações
    document.getElementById('btn-view-changelog').addEventListener('click', () => {
        document.getElementById('settings-modal').style.display = 'none';
        fetchAndShowChangelog();
    });

    const lastVersionSeen = localStorage.getItem('sv_last_version_seen');
    const isExistingUser = localStorage.getItem('sv_user_id') !== null;
    
    // Mostra se a versão mudou OU se não tem a chave mas já é um usuário antigo (update da 1.0.4 pra 1.0.5)
    if (lastVersionSeen !== currentVersion && (lastVersionSeen !== null || isExistingUser)) {
        fetchAndShowChangelog();
    } else if (lastVersionSeen === null) {
        // Se for a primeiríssima vez abrindo o launcher na vida, não mostra changelog pra não assustar o usuário novo
        localStorage.setItem('sv_last_version_seen', currentVersion);
    }

async function checkForUpdates(manual = false) {
    if (isDownloading) return;
    try {
        if (manual) document.getElementById('btn-check-updates').innerText = "Buscando...";
        const res = await fetch(repoUrl + "?t=" + Date.now(), { cache: "no-store" });
        if (!res.ok) throw new Error("Inacessível");
        const data = await res.json();
        if (data.version !== currentVersion && data.version > currentVersion) {
            latestVersionAvailable = data.version;
            document.getElementById('btn-update').style.display = 'inline-block';
            document.getElementById('btn-update').innerText = `⬇️ Atualizar v${data.version}`;
            if (manual) alert(`Atualização Encontrada!\nNova versão: ${data.version}\nClique no botão "Atualizar" na barra de título.`);
        } else if (manual) {
            alert(`App atualizado (v${currentVersion}).`);
        }
    } catch (e) {
        if (manual) alert("Falha ao verificar atualização.");
    } finally {
        if (manual) document.getElementById('btn-check-updates').innerText = "Verificar Updates";
    }
}

async function downloadAndInstallUpdate() {
    if (isDownloading) return;
    isDownloading = true;
    const btnUpdate = document.getElementById('btn-update');
    const windowTitleEl = document.getElementById('window-title');
    const originalTitle = windowTitleEl.innerText;

    try {
        btnUpdate.innerText = '⏳ Buscando...';
        btnUpdate.style.animation = 'none';
        const relRes = await fetch(releasesApiUrl, { cache: 'no-store', headers: { 'Accept': 'application/vnd.github.v3+json' } });
        if (!relRes.ok) throw new Error('Falha ao acessar GitHub Releases');
        const relData = await relRes.json();

        let exeAsset = null;
        if (relData.assets && relData.assets.length > 0) {
            exeAsset = relData.assets.find(a => a.name.toLowerCase().endsWith('.exe'));
        }
        if (!exeAsset) throw new Error('Nenhum instalador .exe encontrado no Release');

        const downloadUrl = exeAsset.browser_download_url;
        const fileName = exeAsset.name;
        const tempDir = require('os').tmpdir();
        const filePath = require('path').join(tempDir, fileName);
        log(`OTA: Baixando ${downloadUrl} para ${filePath}`);

        btnUpdate.innerText = '⬇️ 0%';
        windowTitleEl.innerText = '⬇️ Baixando atualização... 0%';
        windowTitleEl.style.color = '#81bc00';

        const dlRes = await fetch(downloadUrl);
        if (!dlRes.ok) throw new Error('Download falhou: ' + dlRes.status);
        const totalBytes = parseInt(dlRes.headers.get('content-length')) || 0;
        const reader = dlRes.body.getReader();
        let receivedBytes = 0;
        let chunks = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedBytes += value.length;
            if (totalBytes > 0) {
                const pct = Math.round((receivedBytes / totalBytes) * 100);
                btnUpdate.innerText = `⬇️ ${pct}%`;
                windowTitleEl.innerText = `⬇️ Baixando atualização... ${pct}%`;
            } else {
                const mb = (receivedBytes / 1048576).toFixed(1);
                btnUpdate.innerText = `⬇️ ${mb} MB`;
                windowTitleEl.innerText = `⬇️ Baixando... ${mb} MB`;
            }
        }

        btnUpdate.innerText = '💾 Salvando...';
        windowTitleEl.innerText = '💾 Salvando instalador...';
        const buffer = Buffer.concat(chunks.map(c => Buffer.from(c)));
        const fs = require('fs');
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { }
        let finalPath = filePath;
        try {
            fs.writeFileSync(finalPath, buffer);
        } catch (writeErr) {
            const uniqueName = fileName.replace('.exe', '_' + Date.now() + '.exe');
            finalPath = require('path').join(tempDir, uniqueName);
            fs.writeFileSync(finalPath, buffer);
        }
        log(`OTA: Download completo. ${receivedBytes} bytes salvos em ${finalPath}`);

        btnUpdate.innerText = '🚀 Instalando...';
        windowTitleEl.innerText = '🚀 Abrindo instalador...';

        const { spawn } = require('child_process');
        const installerProcess = spawn(finalPath, [], {
            detached: true,
            stdio: 'ignore'
        });
        installerProcess.unref();

        setTimeout(() => {
            nw.App.quit();
        }, 2000);

    } catch (e) {
        log('OTA ERRO: ' + e.message);
        alert('Erro ao baixar atualização:\n' + e.message + '\n\nTente novamente.');
        btnUpdate.innerText = `⬇️ Atualizar v${latestVersionAvailable || '?'}`;
        btnUpdate.style.animation = 'blink 1.5s infinite';
        windowTitleEl.innerText = originalTitle;
        windowTitleEl.style.color = 'rgba(255, 255, 255, 0.9)';
        isDownloading = false;
    }
}

document.getElementById('btn-check-updates').addEventListener('click', () => checkForUpdates(true));
document.getElementById('btn-update').addEventListener('click', () => downloadAndInstallUpdate());
setTimeout(() => checkForUpdates(false), 3000); setInterval(() => checkForUpdates(false), 300000);

// ==========================================
// --- 6. MOTOR DO DISCORD RPC ---
// ==========================================
let rpcReady = false; let rpc = null;
try {
    const DiscordRPC = require('discord-rpc'); const clientId = '1474268923045347429'; DiscordRPC.register(clientId); rpc = new DiscordRPC.Client({ transport: 'ipc' });
    rpc.on('ready', () => { rpcReady = true; const tituloAntigo = windowTitle.innerText; windowTitle.innerText = '✅ Discord Conectado!'; windowTitle.style.color = '#81bc00'; setTimeout(() => { windowTitle.innerText = tituloAntigo; windowTitle.style.color = 'rgba(255, 255, 255, 0.9)'; }, 3000); if (rpcEnabled) setDiscordStatus('Navegando no catálogo...', 'Escolhendo o que assistir'); });
    rpc.login({ clientId }).catch(err => console.log("Discord App não detectado."));
} catch (e) { console.error("Falha ao carregar RPC"); }
function setDiscordStatus(detalhes, estado, startTime = null, imagemUrl = 'logo') {
    if (!rpcReady || !rpc || !rpcEnabled) return;
    let activityInfo = { details: detalhes, state: estado, largeImageKey: imagemUrl, largeImageText: 'Stream Verde Premium', instance: false };
    if (startTime) activityInfo.startTimestamp = startTime; rpc.setActivity(activityInfo).catch(console.error);
}

// ==========================================
// --- 7. O INJETOR (Robô Blindado e Sincronizado) ---
// ==========================================
let currentVerdeSegsGlob = 'null';

setInterval(() => {
    if (webview && webview.executeScript) {
        let syncCode = `window.verdeAutoSkip = ${autoSkipEnabled};`;
        if (currentVerdeSegsGlob !== 'null') syncCode += ` window.verdeSegs = ${currentVerdeSegsGlob};`;
        webview.executeScript({ code: syncCode, allFrames: true });
    }
}, 2000);

webview.addEventListener('loadcommit', () => {
    const indestructibleCode = `
        window.verdeSegs = ${currentVerdeSegsGlob};
        window.verdeAutoSkip = ${autoSkipEnabled};

        if (!window.verdeMaster) {
            window.verdeMaster = true;

            // =======================================
            // LÓGICA DA PÁGINA PRINCIPAL (WP)
            // =======================================
            if (window.self === window.top) {
                let verdeLastAtv = Date.now();
                const verdeVerificaAtv = (e) => {
                    if (!e.isTrusted) return; 
                    if (Date.now() - verdeLastAtv > 5000) { 
                        console.log('VERDE_USER_ACTIVE');
                        verdeLastAtv = Date.now();
                    }
                };
                window.addEventListener('mousemove', verdeVerificaAtv, {passive: true});
                window.addEventListener('click', verdeVerificaAtv, {passive: true});
                window.addEventListener('keydown', verdeVerificaAtv, {passive: true});

				window.lastVerdeMeta = '';
                window.lastVerdeCapa = ''; // Memória isolada pra capa
                setInterval(() => {
                    // 1. CAPA PRO DISCORD (Roda sempre, em filmes e séries)
                    let imgSerie = document.querySelector('.jws-images img');
                    let meta = document.querySelector('meta[property="og:image"]');
                    let imgWP = document.querySelector('.wp-post-image');
                    let imgCapa = 'logo'; 
                    if (imgSerie && imgSerie.src) imgCapa = imgSerie.src;
                    else if (meta && meta.content) imgCapa = meta.content;
                    else if (imgWP && imgWP.src) imgCapa = imgWP.src;

                    if (window.lastVerdeCapa !== imgCapa) {
                        window.lastVerdeCapa = imgCapa;
                        console.log('VERDE_CAPA_ATUAL_VERDE_IMG_' + imgCapa);
                    }

                    // 2. THEINTRODB PARA FILMES E SÉRIES
                    let tmdb = document.querySelector('meta[name="verde-tmdb"]')?.content;
                    let imdb = document.querySelector('meta[name="verde-imdb"]')?.content || 'none';
                    let season = document.querySelector('meta[name="verde-season"]')?.content || 'none';
                    let episode = document.querySelector('meta[name="verde-episode"]')?.content || 'none';

                    // Agora aciona se tiver a tag do filme OU da série!
                    if (tmdb) { 
                        let currentMeta = tmdb + '_' + season + '_' + episode + '_' + imdb;
                        if (window.lastVerdeMeta !== currentMeta) {
                            window.lastVerdeMeta = currentMeta;
                            console.log('VERDE_NOVO_EPISODIO'); 
                            console.log('VERDE_META_TMDB_' + currentMeta);
                        }
                    }
                }, 2000);
            }

            // =======================================
            // LÓGICA UNIVERSAL E DE VÍDEO
            // =======================================
            try { 
                Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth, configurable: true }); 
                Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight, configurable: true }); 
                Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
                // Desarma armadilhas de Debug (usado em bloqueadores de player falsos positivos)
                if (window.console) {
                    window.console.profile = function() {};
                    window.console.profileEnd = function() {};
                    window.console.clear = function() {};
                }
            } catch(e) {}

            // --- SISTEMA DE TECLADO VIA POSTMESSAGE (Resolve foco preso no NW.js) ---
            // RECEPTOR: Roda em todos os frames, escuta mensagens de teclado e controla o vídeo
            window.addEventListener('message', (msg) => {
                if (!msg.data || msg.data.type !== 'VERDE_KEY') return;
                const video = document.querySelector('video');
                if (video) {
                    if (msg.data.code === 'Space') video.paused ? video.play() : video.pause();
                    if (msg.data.code === 'ArrowRight') video.currentTime += 10;
                    if (msg.data.code === 'ArrowLeft') video.currentTime -= 10;
                    if (msg.data.code === 'ArrowUp') video.volume = Math.min(video.volume + 0.1, 1);
                    if (msg.data.code === 'ArrowDown') video.volume = Math.max(video.volume - 0.1, 0);
                }
                if (msg.data.code === 'Escape') {
                    if (document.exitFullscreen) document.exitFullscreen();
                    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
                }
                // Repassar para iframes filhos (cadeia de iframes aninhados)
                document.querySelectorAll('iframe').forEach(f => {
                    try { f.contentWindow.postMessage(msg.data, '*'); } catch(err) {}
                });
            });

            // EMISSOR: Só roda na página principal, captura teclado e manda pros iframes
            if (window.self === window.top) {
                window.addEventListener('keydown', (e) => {
                    const tag = document.activeElement ? document.activeElement.tagName : '';
                    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
                    const chaves = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape'];
                    if (chaves.includes(e.code)) {
                        const iframes = document.querySelectorAll('iframe');
                        if (iframes.length > 0 || e.code === 'Escape') {
                            e.preventDefault(); e.stopImmediatePropagation();
                            iframes.forEach(f => {
                                try { f.contentWindow.postMessage({ type: 'VERDE_KEY', code: e.code }, '*'); } catch(err) {}
                            });
                        }
                    }
                }, true);
            }

            const notificarTela = () => {
                if (document.fullscreenElement || document.webkitFullscreenElement) console.log('VERDE_FS_ON');
                else console.log('VERDE_FS_OFF');
            };
            document.addEventListener('fullscreenchange', notificarTela);
            document.addEventListener('webkitfullscreenchange', notificarTela);

            if (window.self !== window.top) {
                try {
                    const style = document.createElement('style');
                    style.innerHTML = "#footer-actions, .panel-footer, .action-link { display: none !important; } :root { --plyr-color-main: #9dbf00 !important; --jwplayer-color-active: #9dbf00 !important; } .jw-progress, .jw-knob, .vjs-play-progress { background-color: #9dbf00 !important; }";
                    if (document.head) document.head.appendChild(style);
                } catch(e){}
            }

            setInterval(() => {
                const video = document.querySelector('video');

                // CONTROLES DE VÍDEO E NEXT EPISODE
                if (video) {
                    if (!video.monitorado) {
                        video.monitorado = true;
                        video.addEventListener('ended', () => { 
                            if (!video.avisoEnviado && video.duration !== Infinity && video.duration > 300) {
                                if (document.fullscreenElement || document.webkitFullscreenElement) {
                                    console.log('VERDE_WAS_IN_FS_TRUE');
                                    if (document.exitFullscreen) document.exitFullscreen();
                                    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
                                } else { console.log('VERDE_WAS_IN_FS_FALSE'); }
                                console.log('VERDE_VIDEO_ENDED'); 
                            }
                        });
                        video.addEventListener('play', () => { console.log('VERDE_STATUS_PLAY:' + video.currentTime); });
                        video.addEventListener('pause', () => { console.log('VERDE_STATUS_PAUSE:' + video.currentTime); });
                        if (!video.paused) console.log('VERDE_STATUS_PLAY:' + video.currentTime);
                    }

                    let tempoAtual = video.currentTime;
                    let duracao = video.duration || 0;
                    let tempoRestante = duracao - tempoAtual;

                    let isIntroNow = false;
                    let introEndTarget = 0;
                    let isCreditsNow = false;

                    // LÓGICA THEINTRODB (Só pular se for vídeo grande)
                    if (window.verdeSegs && duracao > 300) {
                        for (let seg of window.verdeSegs) {
                            if (tempoAtual >= seg.start && tempoAtual < (seg.end - 1)) {
                                if (seg.type === 'intro' || seg.start < (duracao / 2)) {
                                    isIntroNow = true;
                                    introEndTarget = seg.end;
                                } else {
                                    isCreditsNow = true;
                                }
                            }
                        }
                    }

                    // CRIAÇÃO E ANCORAGEM DO BOTÃO
                    let btnExiste = document.getElementById('btn-pular-intro');
                    let fsElement = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement;
                    let alvoPai = fsElement;
                    if (alvoPai && alvoPai.tagName && (alvoPai.tagName.toUpperCase() === 'VIDEO' || alvoPai.tagName.toUpperCase() === 'IFRAME')) {
                        alvoPai = alvoPai.parentElement;
                    }
                    if (!alvoPai && video) alvoPai = video.closest('.plyr, .video-js, .jwplayer, .vjs-tech, .art-player-inner') || video.parentElement;
                    if (!alvoPai) alvoPai = document.body || document.documentElement;

                    if (isIntroNow && duracao > 300) {
                        if (!btnExiste) {
                            const btn = document.createElement('button');
                            btn.id = 'btn-pular-intro';
                            btn.style.cssText = "position:absolute !important; bottom:80px !important; right:30px !important; z-index:2147483647 !important; background:rgba(20,20,20,0.8) !important; border:1px solid #81bc00 !important; color:#fff !important; padding:12px 24px !important; font-weight:bold !important; font-size:16px !important; border-radius:6px !important; cursor:pointer !important; box-shadow: 0 5px 15px rgba(0,0,0,0.6) !important; backdrop-filter: blur(5px) !important; transition:all 0.2s !important; display:block !important; visibility:visible !important; opacity:1 !important; overflow:hidden !important;";
                            
                            if (window.verdeAutoSkip) {
                                btn.innerText = 'Pulando Abertura... ⏳';
                                const progress = document.createElement('div');
                                progress.style.cssText = "position:absolute !important; bottom:0 !important; left:0 !important; height:4px !important; background:#81bc00 !important; width:0% !important; transition: width 1.5s linear !important;";
                                btn.appendChild(progress);
                                
                                setTimeout(() => { progress.style.width = '100%'; }, 50);
                                setTimeout(() => {
                                    const b = document.getElementById('btn-pular-intro');
                                    if (b && parseFloat(b.dataset.skipTarget) > 0) {
                                        const v = document.querySelector('video');
                                        if (v) v.currentTime = parseFloat(b.dataset.skipTarget);
                                        b.remove();
                                        console.log('VERDE_AUTO_SKIPPED');
                                    }
                                }, 1500);
                            } else {
                                btn.innerText = 'Pular Abertura ⏭️';
                            }

                            btn.onmouseover = () => { btn.style.background = '#81bc00'; btn.style.color = '#121212'; btn.style.transform = 'scale(1.05)'; };
                            btn.onmouseout = () => { btn.style.background = 'rgba(20,20,20,0.8)'; btn.style.color = '#fff'; btn.style.transform = 'scale(1)'; };
                            
                            btn.dataset.skipTarget = introEndTarget;
                            btn.onclick = (ev) => {
                                ev.stopPropagation();
                                const v = document.querySelector('video');
                                if (v) v.currentTime = parseFloat(btn.dataset.skipTarget);
                                btn.remove();
                            };
                            try { alvoPai.appendChild(btn); } catch(e) { document.documentElement.appendChild(btn); }
                        } else {
                            btnExiste.dataset.skipTarget = introEndTarget;
                            try { if (btnExiste.parentElement !== alvoPai) alvoPai.appendChild(btnExiste); } catch(e) {}
                        }
                    } else {
                        if (btnExiste) btnExiste.remove();
                    }

                    // NEXT EPISODE (Ignora propagandas)
                    if (duracao > 300 && duracao !== Infinity && !video.paused) {
                        let horaDoProximo = isCreditsNow || (tempoRestante <= 10 && tempoRestante > 0);
                        if (horaDoProximo && !video.avisoEnviado) {
                            video.avisoEnviado = true;
                            if (document.fullscreenElement || document.webkitFullscreenElement) {
                                console.log('VERDE_WAS_IN_FS_TRUE');
                                if (document.exitFullscreen) document.exitFullscreen();
                                else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
                            } else { console.log('VERDE_WAS_IN_FS_FALSE'); }
                            console.log('VERDE_SHOW_NEXT_EP');
                        }
                    }
                }

                // =======================================
                // AUTOPLAY E AUTO-CLICKER (SEM RETURN ASSASSINO!)
                // =======================================
                if (window.self !== window.top) {
                    const superClick = (el) => {
                        if(!el) return;
                        const opts = { bubbles: true, cancelable: true, view: window };
                        el.dispatchEvent(new MouseEvent('mousedown', opts));
                        el.dispatchEvent(new MouseEvent('mouseup', opts));
                        el.dispatchEvent(new MouseEvent('click', opts));
                    };

                    // 1. O Clicador de Servidor Principal
                    const candidates = document.querySelectorAll('div, li, button, span, a');
                    const triggers = ['servidor principal'];
                    for (let el of candidates) {
                        const txt = el.innerText ? el.innerText.toLowerCase().trim() : '';
                        if (triggers.some(t => txt.includes(t)) && el.offsetParent !== null) {
                            if (txt.length < 25 && !el.getAttribute('data-clicked')) { el.setAttribute('data-clicked', 'true'); superClick(el); }
                        }
                    }

                    // 2. Autoplay (Só clica se estiver pausado e no começo)
                    if (!video || (video.paused && video.currentTime <= 1)) {
                        const bigPlayBtns = document.querySelectorAll('.vjs-big-play-button, .plyr__control--overlaid, [aria-label="Play"], .art-icon-play');
                        for (let btn of bigPlayBtns) {
                            if (btn && btn.offsetParent !== null && !btn.getAttribute('data-clicked')) {
                                btn.setAttribute('data-clicked', 'true');
                                superClick(btn);
                                break; 
                            }
                        }
                    }

                    // 3. Destruidor de Barreiras
                    const traps = document.querySelectorAll('div, a');
                    traps.forEach(el => {
                        const css = window.getComputedStyle(el);
                        if ((css.position === 'absolute' || css.position === 'fixed') && el.clientWidth > (window.innerWidth * 0.5)) {
                            if ((css.opacity === '0' || css.backgroundColor === 'rgba(0, 0, 0, 0)' || css.backgroundColor === 'transparent') && parseInt(css.zIndex) > 50) {
                                const txt = el.className || '';
                                if (!txt.includes('jw-controls') && !txt.includes('vjs-control') && !txt.includes('plyr__') && !el.querySelector('video')) {
                                    el.style.setProperty('pointer-events', 'none', 'important');
                                }
                            }
                        }
                    });

                    // 4. Detecção e Atualização Rápida na Tela "Por favor não abra o console"
                    if (document.body && document.body.innerText) {
                        if (document.body.innerText.includes('Por favor não abra o console do navegador') || document.body.innerText.includes('DevTools')) {
                            if (!window._verdeProtecaoReloading) {
                                window._verdeProtecaoReloading = true;
                                console.log('VERDE_ANTI_DEVTOOLS_DETECTADO - Recarregando Janela Pai via WebView Console');
                                if (window.top !== window.self) {
                                    try { console.log('VERDE_FULL_RELOAD_REQUESTED_FROM_DEVTOOLS'); } catch(e){}
                                }
                            }
                        }
                    }
                }
            }, 1000);

            // ASSASSINO DE ANÚNCIOS (Em loop paralelo)
            if (window.self !== window.top) {
                if (window._verdeSkipAdInterval) clearInterval(window._verdeSkipAdInterval);
                window._verdeSkipAdInterval = setInterval(() => {
                    const btns = document.querySelectorAll('div, button, span, a');
                    btns.forEach(b => {
                        if (b.id === 'btn-pular-intro') return; // Protege nosso próprio botão
                        const txt = b.innerText ? b.innerText.toLowerCase().trim() : '';
                        if (txt.includes('pular') || txt.includes('skip') || txt === 'skip ad') {
                            if (b.offsetParent !== null && txt.length < 25) b.click();
                        }
                    });
                }, 500);
            }
        }
    `;
    webview.executeScript({ code: indestructibleCode, allFrames: true });
});

// ==========================================
// --- 8. CÉREBRO CENTRAL (Receptor de Mensagens) ---
// ==========================================
document.getElementById('content-area').addEventListener('mouseenter', () => webview.focus());
document.getElementById('content-area').addEventListener('click', () => webview.focus());



webview.addEventListener('dialog', (e) => {
    e.preventDefault();
    if (e.messageText && (e.messageText.includes('Erro ao carregar') || e.messageText.includes('Error loading'))) { e.dialog.ok(); return; }
    if (e.messageType === 'alert') alert(e.messageText), e.dialog.ok();
    else if (e.messageType === 'confirm') confirm(e.messageText) ? e.dialog.ok() : e.dialog.cancel();
    else if (e.messageType === 'prompt') { const res = prompt(e.messageText, e.defaultPromptText); res !== null ? e.dialog.ok(res) : e.dialog.cancel(); }
});

webview.addEventListener('permissionrequest', function (e) { if (e.permission === 'fullscreen') e.request.allow(); });

let lastTokenReload = 0;

webview.addEventListener('consolemessage', (e) => {

    if (e.message === 'VERDE_FS_ON') { titleBar.style.display = 'none'; }
    else if (e.message === 'VERDE_FS_OFF') { titleBar.style.display = 'flex'; }

    else if (e.message === 'VERDE_WAS_IN_FS_TRUE') { shouldAutoFullscreen = true; }
    else if (e.message === 'VERDE_WAS_IN_FS_FALSE') { shouldAutoFullscreen = false; }

    else if (e.message === 'VERDE_NOVO_EPISODIO') { currentVerdeSegsGlob = 'null'; }

    // Interceptador de Auto-Reload para Tela Vermelha/Console bloqueado
    else if (e.message === 'VERDE_FULL_RELOAD_REQUESTED_FROM_DEVTOOLS') {
        if (!window._verdeAntiSpamReload) {
            window._verdeAntiSpamReload = true;
            log('Recebido aviso de Bloqueio Player (Anti-Console). Forçando Reload Global via ConsoleMessage Logger...');
            try { document.getElementById('loading-overlay').style.display = 'flex'; } catch(err){}
            try { document.querySelector('#loading-overlay h2').innerText = 'Bypass Segurança...'; } catch(err){}
            setTimeout(() => { webview.reload(); window._verdeAntiSpamReload = false; }, 2500);
        }
    }

    else if (typeof e.message === 'string' && e.message.startsWith('VERDE_CAPA_ATUAL')) {
        let url = e.message.split('_VERDE_IMG_')[1];
        if (url && url.startsWith('http')) { capaGlobal = url; } else { capaGlobal = 'logo'; }
    }

    // LEITOR THEINTRODB (Inteligente: Lê Segundos e Milissegundos perfeitamente!)
    // LEITOR THEINTRODB (Inteligente: Lê Segundos e Milissegundos perfeitamente!)
    else if (typeof e.message === 'string' && e.message.startsWith('VERDE_META_TMDB_')) {
        let partes = e.message.split('_');
        let tmdb = partes[3]; let season = partes[4]; let episode = partes[5]; let imdb = partes[6];

        let cacheBuster = '&cb=' + Date.now();
        
        // Montador de Link Inteligente: Se for filme, não manda as tags de temporada!
        let api1 = 'https://api.theintrodb.org/v2/media?tmdb_id=' + tmdb;
        if (season !== 'none' && episode !== 'none' && season !== 'undefined') {
            api1 += '&season=' + season + '&episode=' + episode;
        }
        api1 += cacheBuster;

        let api2 = null;
        if (imdb !== 'none') { 
            api2 = 'https://api.introdb.app/intro?imdb_id=' + imdb;
            if (season !== 'none' && episode !== 'none' && season !== 'undefined') {
                api2 += '&season=' + season + '&episode=' + episode;
            }
            api2 += cacheBuster;
        }

        const processarESalvarTempos = (data) => {
            let todosOsTempos = [];
            
            if (data.intro && Array.isArray(data.intro)) todosOsTempos.push(...data.intro.map(s => ({ ...s, _type: 'intro' })));
            if (data.credits && Array.isArray(data.credits)) todosOsTempos.push(...data.credits.map(s => ({ ...s, _type: 'credits' })));
            if (data.recap && Array.isArray(data.recap)) todosOsTempos.push(...data.recap.map(s => ({ ...s, _type: 'recap' })));

            if (todosOsTempos.length > 0) {
                let temposLimpos = todosOsTempos.map(seg => {
                    let s = seg.start ?? seg.start_ms ?? seg.startMs;
                    let e = seg.end ?? seg.end_ms ?? seg.endMs;
                    if (s == null) s = 0;
                    if (e == null) e = 99999000; 

                    let startSec = s > 10000 ? s / 1000 : parseFloat(s);
                    let endSec = e > 10000 ? e / 1000 : parseFloat(e);

                    return { start: startSec, end: endSec, type: seg._type || 'unknown' };
                }).filter(s => !isNaN(s.start) && !isNaN(s.end) && s.end > s.start);

                currentVerdeSegsGlob = JSON.stringify(temposLimpos);
                webview.executeScript({ code: `window.verdeSegs = ${currentVerdeSegsGlob};`, allFrames: true });
            } else {
                currentVerdeSegsGlob = 'null';
                webview.executeScript({ code: `window.verdeSegs = null;`, allFrames: true });
            }
        };

        fetch(api1, { cache: 'no-store', headers: { 'Authorization': 'Bearer theintrodb:user_3AAhy8pLm6MxHRFG95R7LW47eVN:JiHxMFh3ScEMVUHo1tOvFPwYWCeOXUcsPyWYnWhDIfI' } })
            .then(res => res.json()).then(data => processarESalvarTempos(data))
            .catch(err => {
                if (api2) {
                    fetch(api2, { cache: 'no-store' }).then(res => res.json()).then(data => {
                        if (data && (data.start_ms !== undefined || data.start !== undefined)) {
                            let s = data.start_ms ?? data.start; if (s === null) s = 0;
                            let e = data.end_ms ?? data.end; if (e === null) e = 99999000;
                            processarESalvarTempos({ intro: [{ start: s, end: e }] });
                        }
                    }).catch(err2 => { currentVerdeSegsGlob = 'null'; });
                } else { currentVerdeSegsGlob = 'null'; }
            });
    }

    else if (typeof e.message === 'string' && e.message.startsWith('VERDE_STATUS_PAUSE')) {
        document.title = `Pausado - ${appName}`;
        let videoTime = e.message.includes(':') ? parseFloat(e.message.split(':')[1]) || 0 : 0;
        let h = Math.floor(videoTime / 3600); let m = Math.floor((videoTime % 3600) / 60); let s = Math.floor(videoTime % 60);
        let tempoFormatado = h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        let nomeVideo = windowTitle.innerText.replace(' - Stream Verde', '').trim();
        setDiscordStatus(nomeVideo, `Pausado aos ${tempoFormatado} ⏸️`, null, capaGlobal);
    }

    else if (typeof e.message === 'string' && e.message.startsWith('VERDE_STATUS_PLAY')) {
        document.title = `Reproduzindo - ${appName}`;
        let videoTime = e.message.includes(':') ? parseFloat(e.message.split(':')[1]) || 0 : 0;
        let tempoSincronizado = Date.now() - (videoTime * 1000);
        let nomeVideo = windowTitle.innerText.replace(' - Stream Verde', '').trim();
        setDiscordStatus(nomeVideo, 'Assistindo agora 🍿', tempoSincronizado, capaGlobal);

        if (shouldAutoFullscreen) {
            shouldAutoFullscreen = false;
            setTimeout(() => {
                webview.executeScript({
                    code: `(function() { 
                        // TRAVA ANTI-CLIQUE FANTASMA (Só clica se NÃO estiver em Fullscreen)
                        if (document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement) return;

                        const video = document.querySelector('video'); 
                        const fsBtn = document.querySelector('.vjs-fullscreen-control, .plyr__control[data-plyr="fullscreen"], .jw-icon-fullscreen, [aria-label="Fullscreen"]'); 
                        if (fsBtn) fsBtn.click(); 
                        else if (video) { 
                            if (video.requestFullscreen) video.requestFullscreen(); 
                            else if (video.webkitRequestFullscreen) video.webkitRequestFullscreen(); 
                        } 
                    })();`,
                    allFrames: true
                });
            }, 1500);
        }
    }

    else if (e.message === 'VERDE_USER_ACTIVE') { episociosSeguidos = 0; }
    else if (e.message === 'VERDE_AUTO_NEXT_TRIGGERED') { episociosSeguidos++; }
    else if (e.message === 'VERDE_CONTINUE_WATCHING') { episociosSeguidos = 0; }
    else if (e.message === 'VERDE_PAUSE_ALL') { webview.executeScript({ code: "const v = document.querySelector('video'); if(v) v.pause();", allFrames: true }); }

    else if (e.message === 'VERDE_RELOAD_TOKEN_EXPIRED') {
        let agora = Date.now();
        if (agora - lastTokenReload > 120000) {
            lastTokenReload = agora;
            console.log("Token expirado. Tentando F5...");
            webview.reload();
        }
    }

    else if (e.message === 'VERDE_SHOW_NEXT_EP' || e.message === 'VERDE_VIDEO_ENDED') {
        if (!autoNextEnabled) return;
        titleBar.style.display = 'flex'; // Zerei os comandos do appWindow aqui
        const isFreioAtivo = freioEnabled && (episociosSeguidos >= freioLimit);

        webview.executeScript({
            code: `
                (function() {
                    const navLinks = Array.from(document.querySelectorAll('a.asf-nav-btn'));
                    const nextLink = navLinks.find(el => { const txt = el.innerText.toLowerCase(); return txt.includes('próximo') || txt.includes('next'); });

                    if (nextLink && !nextLink.classList.contains('disabled') && !document.getElementById('verde-overlay')) {
                        if (!document.getElementById('verde-anim')) {
                            const style = document.createElement('style'); style.id = 'verde-anim';
                            style.innerHTML = "@keyframes slideUp { from { transform: translateY(120%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }";
                            document.head.appendChild(style);
                        }

                        const overlay = document.createElement('div'); overlay.id = 'verde-overlay';
                        overlay.style.cssText = "position:fixed; bottom:25px; right:25px; width:330px; background:rgba(20, 20, 20, 0.95); border:1px solid rgba(129, 188, 0, 0.4); z-index:999999; display:flex; flex-direction:column; padding:20px; color:white; font-family:'Segoe UI', sans-serif; border-radius:12px; box-shadow: 0 15px 35px rgba(0,0,0,0.8); backdrop-filter: blur(8px); animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1);";
                        
                        const isFreio = ${isFreioAtivo};

                        const forcarProximo = () => {
                            console.log('VERDE_AUTO_NEXT_TRIGGERED');
                            let url = nextLink.getAttribute('href');
                            if (url && url !== '#' && url !== '') { window.location.href = url; } else { nextLink.click(); }
                        };

                        if (isFreio) {
                            overlay.innerHTML = \`
                                <div style='display:flex; justify-content:center; align-items:center; margin-bottom:15px;'><h2 style='font-size:18px; margin:0; font-weight:700; color:#81bc00;'>Stream Verde</h2></div>
                                <h3 style='font-size:16px; color:#fff; margin:0 0 20px 0; font-weight:500; text-align:center;'>Você ainda está assistindo?</h3>
                                <button id='v-now' style='width:100%; padding:14px; background:#81bc00; border:none; color:#121212; cursor:pointer; border-radius:6px; font-weight:bold; font-size:14px; text-transform:uppercase; transition:background 0.2s;' onmouseover='this.style.background="#9ce200"' onmouseout='this.style.background="#81bc00"'>Sim, continuar assistindo</button>
                            \`;
                            document.body.appendChild(overlay);
                            console.log('VERDE_PAUSE_ALL'); 
                            document.getElementById('v-now').onclick = () => { console.log('VERDE_CONTINUE_WATCHING'); forcarProximo(); };
                        } else {
                            let count = 10;
                            overlay.innerHTML = \`
                                <div style='display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;'>
                                    <h2 style='font-size:15px; margin:0; font-weight:600; color:#ccc; letter-spacing:0.5px;'>Próximo Episódio em <span id='v-count' style='color:#81bc00; font-weight:900; font-size:18px;'>\${count}</span>s</h2>
                                    <button id='v-cancel' style='background:transparent; border:none; color:#666; cursor:pointer; font-size:16px; font-weight:bold; padding:0; transition:color 0.2s;' onmouseover='this.style.color="#fff"' onmouseout='this.style.color="#666"'>✕</button>
                                </div>
                                <h3 style='font-size:14px; color:#fff; margin:0 0 20px 0; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;' title='\${nextLink.innerText.replace('Próximo', '').trim()}'>\${nextLink.innerText.replace('Próximo', '').trim()}</h3>
                                <button id='v-now' style='width:100%; padding:12px; background:#81bc00; border:none; color:#121212; cursor:pointer; border-radius:6px; font-weight:bold; font-size:14px; text-transform:uppercase; transition:background 0.2s;' onmouseover='this.style.background="#9ce200"' onmouseout='this.style.background="#81bc00"'>Assistir Agora</button>
                            \`;
                            document.body.appendChild(overlay);

                            const timer = setInterval(() => {
                                count--; const el = document.getElementById('v-count'); if(el) el.innerText = count;
                                if (count <= 0) { clearInterval(timer); forcarProximo(); }
                            }, 1000);
                            document.getElementById('v-now').onclick = () => { clearInterval(timer); forcarProximo(); };
                            document.getElementById('v-cancel').onclick = () => { clearInterval(timer); overlay.remove(); };
                        }
                    }
                })();
            `
        });
    }
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        titleBar.style.display = 'flex';
        webview.executeScript({ code: "if(document.exitFullscreen) document.exitFullscreen(); else if(document.webkitExitFullscreen) document.webkitExitFullscreen();" });
        return;
    }
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    const chaves = [' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (chaves.includes(e.key)) {
        e.preventDefault();
        webview.executeScript({
            code: `(function(){ const v = document.querySelector('video'); if (v) { if ('${e.key}' === ' ') v.paused ? v.play() : v.pause(); if ('${e.key}' === 'ArrowRight') v.currentTime += 10; if ('${e.key}' === 'ArrowLeft') v.currentTime -= 10; if ('${e.key}' === 'ArrowUp') v.volume = Math.min(v.volume + 0.1, 1); if ('${e.key}' === 'ArrowDown') v.volume = Math.max(v.volume - 0.1, 0); } })();`,
            allFrames: true
        });
    }
});

webview.addEventListener('newwindow', (e) => {
    e.preventDefault();
});

const mockVastXML = `<?xml version="1.0" encoding="UTF-8"?><VAST version="3.0"><Ad><InLine><AdSystem>Mock</AdSystem><AdTitle>Empty</AdTitle><Creatives><Creative sequence="1"><Linear><Duration>00:00:01</Duration><MediaFiles></MediaFiles></Linear></Creative></Creatives></InLine></Ad></VAST>`;
const mockVastDataURI = "data:text/xml;charset=utf-8;base64," + Buffer.from(mockVastXML).toString('base64');
const adPatterns = ["*://*.vast*", "*://*/*vast.xml*", "*://*/*ad-delivery*", "*://*/*vpaid*", "*://*/*ads.js*", "*://*/*ad_systems*", "*://*/*popunder*", "*://*/*popup*", "*://*/*pop.js*", "*://*/*pop.html*", "*://*.popcash.net/*", "*://*.propellerads.com/*", "*://*.onclickmega.com/*", "*://*.popads.net/*", "*://*.adsterra.com/*", "*://*.exoclick.com/*", "*://*.adcash.com/*", "*://*.hilltopads.com/*", "*://*.syndication.exdynsrv.com/*", "*://*.directrev.com/*", "*://*.terraclicks.com/*", "*://*.onclickads.net/*", "*://*.betano.com/*", "*://*.1xbet.com/*", "*://*/*bet*.js*", "*://*.blaze.com/*", "*://*.bet365.com/*", "*://*.sportingbet.com/*", "*://*.pixbet.com/*", "*://*/*tigrinho*", "*://*/*fortune-tiger*", "*://*.doubleclick.net/*", "*://*/*scorecardresearch*", "*://*/*adx.js*", "*://*/*anti-adblock*", "*://*/*blocker.js*", "*://*/*coin-hive*"];

webview.request.onBeforeRequest.addListener(
    function (details) {
        const url = details.url.toLowerCase();
        const isAd = adPatterns.some(p => { const keyword = p.replace(/\*:\/\/\*\.?/, '').replace(/\*/g, ''); return url.includes(keyword) && keyword.length > 3; });
        if (isAd) {
            if (details.type === 'sub_frame' && (url.includes('superflix') || url.includes('playerflix') || url.includes('primevicio'))) { return { cancel: false }; }
            return { cancel: true };
        }
    }, { urls: ["<all_urls>"] }, ["blocking"]
);

webview.request.onBeforeSendHeaders.addListener(
    function (details) {
        let headers = details.requestHeaders;
        const spoofedHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 SteamVerdeLauncher', 'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"', 'Sec-Ch-Ua-Mobile': '?0', 'Sec-Ch-Ua-Platform': '"Windows"' };
        headers = headers.filter(h => { const name = h.name.toLowerCase(); return !['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'user-agent'].includes(name); });
        for (const [key, value] of Object.entries(spoofedHeaders)) headers.push({ name: key, value: value });
        return { requestHeaders: headers };
    }, { urls: ["<all_urls>"] }, ["blocking", "requestHeaders", "extraHeaders"]
);