// URL do backend (atualize para a URL do Render quando fizer o deploy!)
const BACKEND_URL = ''; // Ex: 'https://bibliotroca-backend.onrender.com'

// Funções para gerenciamento de usuários
let usuariosRegistrados = JSON.parse(localStorage.getItem('usuarios')) || [];

// FUNÇÃO DE LIMPEZA TOTAL (Pode ser chamada pelo console: resetSistema())
async function resetSistema() {
    if (!confirm('Deseja realmente limpar todos os seus dados locais (fotos e cache)?')) return;
    localStorage.clear();
    const db = await openDB();
    const tx = db.transaction(['livros', 'outbox'], 'readwrite');
    tx.objectStore('livros').clear();
    tx.objectStore('outbox').clear();
    console.log('Cache local, LocalStorage e Outbox limpos. Reiniciando...');
    window.location.reload();
}

// Garantir que o admin padrão exista localmente para fallback
const adminPadrao = {
    id: 'admin-master',
    nome: 'Administrador',
    email: 'admin@bibliotroca.com',
    senha: 'admin123',
    turma: 'Sistema',
    isAdmin: 1
};

if (!usuariosRegistrados.find(u => u.email === adminPadrao.email)) {
    usuariosRegistrados.push(adminPadrao);
    localStorage.setItem('usuarios', JSON.stringify(usuariosRegistrados));
}

let livrosRegistrados = JSON.parse(localStorage.getItem('livros')) || [];
let trocasSolicitadas = JSON.parse(localStorage.getItem('trocas')) || [];
let usuarioLogado = JSON.parse(localStorage.getItem('usuarioLogado')) || null;

// ----- IndexedDB (local in-browser DB) + outbox for sync -----
const DB_NAME = 'biblioDB';
const DB_VERSION = 1;
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (e) {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('livros')) {
                db.createObjectStore('livros', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('outbox')) {
                db.createObjectStore('outbox', { autoIncrement: true });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbAdd(storeName, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(value);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbGetAll(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}
window.idbGetAll = idbGetAll;

async function idbDelete(storeName, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}
window.idbDelete = idbDelete;

// Add a local book (with optional image blob) to IndexedDB
async function addLocalBook(book, imageBlob) {
    const copy = Object.assign({}, book);
    if (imageBlob) copy.imagemBlob = imageBlob;
    await idbAdd('livros', copy);
    // also update in-memory fallback
    livrosRegistrados.push(copy);
    localStorage.setItem('livros', JSON.stringify(livrosRegistrados));
}

// Queue an action to outbox for later sync
async function queueOutbox(entry) {
    await idbAdd('outbox', entry);
}

// Process outbox: try to send queued items to server
async function processOutbox() {
    const items = await idbGetAll('outbox');
    for (const item of items) {
        try {
            const formData = new FormData();
            ['titulo','autor','disciplina','ano','descricao','estado','usuarioId','nomeUsuario'].forEach(k => {
                if (item[k]) formData.append(k, item[k]);
            });
            if (item.imagemBlob) {
                formData.append('imagem', item.imagemBlob, item.imagemName || 'imagem.jpg');
            }

            const resp = await fetch(`${BACKEND_URL}/api/livros`, { method: 'POST', body: formData });
            if (resp.ok) {
                const saved = await resp.json();
                // update local 'livros' record with server info
                // find local by temp id (item.id)
                const localLivros = await idbGetAll('livros');
                const loc = localLivros.find(l => l.id === item.id);
                if (loc) {
                    loc.serverId = saved.id;
                    loc.imagemPath = saved.imagemPath;
                    await idbAdd('livros', loc);
                }
                // remove this outbox item: outbox keys are autoIncrement, need to find key
                // we'll delete by matching fields; simpler: clear entire outbox and resync remaining — but here we'll fetch keys and delete matching
                await removeOutboxEntryMatching(item);
            }
        } catch (err) {
            // network error - leave in outbox
            console.log('Outbox sync error:', err.message);
            return; // stop processing on first failure
        }
    }
}

// Helper to remove outbox entry matching the object (search keys)
async function removeOutboxEntryMatching(target) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('outbox', 'readwrite');
        const store = tx.objectStore('outbox');
        const req = store.openCursor();
        req.onsuccess = function(e) {
            const cursor = e.target.result;
            if (!cursor) return resolve();
            const val = cursor.value;
            // crude matching by id and titulo
            if (val.id === target.id && val.titulo === target.titulo) {
                cursor.delete();
            }
            cursor.continue();
        };
        req.onerror = () => reject(req.error);
    });
}

// Sync when back online
window.addEventListener('online', () => {
    console.log('Online - processing outbox');
    processOutbox().catch(err => console.log('processOutbox failed', err));
});

// On load, try to process outbox
if (navigator.onLine) processOutbox().catch(()=>{});
// ----- end IndexedDB section -----

// Função para pedir permissão de notificações
async function pedirPermissaoNotificacoes() {
    if (!('Notification' in window)) {
        console.log('Este navegador não suporta notificações');
        return;
    }
    
    if (Notification.permission === 'granted') {
        return;
    }
    
    if (Notification.permission === 'default') {
        // Mostrar mensagem pedindo permissão
        const banner = document.createElement('div');
        banner.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background-color: #3498db;
            color: white;
            padding: 15px 25px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 9999;
            max-width: 90%;
            text-align: center;
        `;
        banner.innerHTML = `
            <p style="margin: 0 0 10px 0;">
                <i class="fas fa-bell"></i> 
                Permita as notificações para receber alertas sobre trocas de livros!
            </p>
            <button id="allow-notifications-btn" style="
                background-color: white;
                color: #3498db;
                border: none;
                padding: 8px 20px;
                border-radius: 5px;
                cursor: pointer;
                font-weight: bold;
            ">Permitir Notificações</button>
            <button id="dismiss-notifications-banner" style="
                background-color: transparent;
                color: white;
                border: 1px solid white;
                padding: 7px 15px;
                border-radius: 5px;
                cursor: pointer;
                margin-left: 10px;
            ">Agora não</button>
        `;
        document.body.appendChild(banner);
        
        // Adicionar eventos aos botões
        const allowBtn = document.getElementById('allow-notifications-btn');
        const dismissBtn = document.getElementById('dismiss-notifications-banner');
        
        allowBtn.addEventListener('click', async () => {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                enviarNotificacao(
                    'Notificações Ativadas!',
                    'Agora você receberá alertas sobre trocas de livros!'
                );
            }
            banner.remove();
        });
        
        dismissBtn.addEventListener('click', () => {
            banner.remove();
        });
    }
}

// Função para enviar notificação
function enviarNotificacao(titulo, mensagem, icon = null) {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
        return;
    }
    
    const options = {
        body: mensagem,
        icon: icon || 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/svgs/solid/book.svg'
    };
    
    new Notification(titulo, options);
}

// Verificar se o usuário está logado
function verificarLogin() {
    const loginLink = document.getElementById('login-link');
    const perfilLink = document.getElementById('perfil-link');
    const logoutLink = document.getElementById('logout-link');
    const navUl = document.querySelector('nav ul');
    
    // Remove existing admin link if any
    const existingAdmin = document.getElementById('admin-nav-link');
    if (existingAdmin) existingAdmin.remove();

    if (usuarioLogado) {
        if (loginLink) loginLink.style.display = 'none';
        if (perfilLink) perfilLink.style.display = 'block';
        if (logoutLink) logoutLink.style.display = 'block';

        // Add admin link if user is admin
        if (usuarioLogado.isAdmin) {
            const adminLi = document.createElement('li');
            adminLi.id = 'admin-nav-link';
            adminLi.innerHTML = '<a href="admin.html" style="color: #e67e22; font-weight: bold;">Painel Admin</a>';
            if (navUl) navUl.insertBefore(adminLi, logoutLink.parentElement);
        }
    } else {
        if (loginLink) loginLink.style.display = 'block';
        if (perfilLink) perfilLink.style.display = 'none';
        if (logoutLink) logoutLink.style.display = 'none';
    }
}

// Função para cadastrar usuário
async function cadastrarUsuario(formData) {
    try {
        const resp = await fetch(`${BACKEND_URL}/api/usuarios`, {
            method: 'POST',
            body: formData
        });
        
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.error || 'Erro ao cadastrar');
        }
        
        return await resp.json();
    } catch (err) {
        console.log('Erro no cadastro via API, usando localStorage:', err);
        
        // Function to convert file to base64
        const fileToBase64 = (file) => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = () => resolve(reader.result);
                reader.onerror = error => reject(error);
            });
        };
        
        let fotoPerfilBase64 = null;
        const fotoPerfilFile = formData.get('fotoPerfil');
        if (fotoPerfilFile && fotoPerfilFile.size > 0) {
            fotoPerfilBase64 = await fileToBase64(fotoPerfilFile);
        }
        
        // Fallback para localStorage se o servidor falhar
        const novoUsuario = {
            id: Date.now().toString(),
            nome: formData.get('nome'),
            email: formData.get('email'),
            senha: formData.get('senha'),
            telefone: formData.get('telefone'),
            dataNascimento: formData.get('dataNascimento'),
            fotoPerfil: fotoPerfilBase64,
            serie: formData.get('serie'),
            turma: formData.get('turma'),
            turno: formData.get('turno'),
            termosAceitos: formData.get('termos') ? 1 : 0,
            livros: [], 
            trocas: [], 
            isAdmin: 0
        };
        usuariosRegistrados.push(novoUsuario);
        localStorage.setItem('usuarios', JSON.stringify(usuariosRegistrados));
        return novoUsuario;
    }
}

// Função para fazer login
async function fazerLogin(email, senha) {
    const cleanEmail = email.trim().toLowerCase();
    const cleanSenha = senha.trim();

    try {
        const resp = await fetch(`${BACKEND_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: cleanEmail, senha: cleanSenha })
        });
        
        if (resp.ok) {
            usuarioLogado = await resp.json();
            localStorage.setItem('usuarioLogado', JSON.stringify(usuarioLogado));
            // Pedir permissão de notificações após login
            await pedirPermissaoNotificacoes();
            return true;
        }
    } catch (err) {
        console.log('Erro no login via API, tentando local...', err);
    }

    // Fallback local
    const usuario = usuariosRegistrados.find(u => u.email.toLowerCase() === cleanEmail && u.senha === cleanSenha);
    if (usuario) {
        usuarioLogado = usuario;
        localStorage.setItem('usuarioLogado', JSON.stringify(usuarioLogado));
        // Pedir permissão de notificações após login
        await pedirPermissaoNotificacoes();
        return true;
    }
    return false;
}

// Função para fazer logout
function fazerLogout() {
    usuarioLogado = null;
    localStorage.removeItem('usuarioLogado');
    window.location.href = 'index.html';
}

// Função para cadastrar livro
function cadastrarLivro(titulo, autor, disciplina, ano, descricao, estado) {
    if (!usuarioLogado) {
        return false;
    }
    
    const novoLivro = {
        id: Date.now().toString(),
        titulo,
        autor,
        disciplina,
        ano,
        descricao,
        estado,
        usuarioId: usuarioLogado.id,
        nomeUsuario: usuarioLogado.nome,
        disponivel: true
    };
    
    livrosRegistrados.push(novoLivro);
    localStorage.setItem('livros', JSON.stringify(livrosRegistrados));
    
    // Adicionar o livro à lista de livros do usuário
    usuarioLogado.livros.push(novoLivro.id);
    
    // Atualizar o usuário na lista de usuários
    const index = usuariosRegistrados.findIndex(u => u.id === usuarioLogado.id);
    if (index !== -1) {
        usuariosRegistrados[index] = usuarioLogado;
        localStorage.setItem('usuarios', JSON.stringify(usuariosRegistrados));
        localStorage.setItem('usuarioLogado', JSON.stringify(usuarioLogado));
    }
    
    return novoLivro;
}

// Função para listar livros disponíveis
function listarLivrosDisponiveis() {
    return livrosRegistrados.filter(livro => livro.disponivel);
}

// Função para listar livros do usuário
function listarLivrosDoUsuario() {
    if (!usuarioLogado) {
        return [];
    }
    
    return livrosRegistrados.filter(livro => livro.usuarioId === usuarioLogado.id);
}

// Função para solicitar troca
async function solicitarTroca(livroId) {
    if (!usuarioLogado) {
        return false;
    }
    
    const livro = livrosRegistrados.find(l => l.id === livroId);
    
    if (!livro || !livro.disponivel || livro.usuarioId === usuarioLogado.id) {
        return false;
    }
    
    const novaTroca = {
        id: Date.now().toString(),
        livroId,
        livroTitulo: livro.titulo,
        solicitanteId: usuarioLogado.id,
        solicitanteNome: usuarioLogado.nome,
        proprietarioId: livro.usuarioId,
        proprietarioNome: livro.nomeUsuario,
        status: 'pendente',
        dataSolicitacao: new Date().toISOString()
    };
    
    trocasSolicitadas.push(novaTroca);
    localStorage.setItem('trocas', JSON.stringify(trocasSolicitadas));
    
    // Enviar notificação para o solicitante
    enviarNotificacao(
        'Solicitação de Troca Enviada!',
        `Você solicitou a troca do livro "${livro.titulo}" com ${livro.nomeUsuario}!`
    );
    
    // Tentar enviar e-mail para o proprietário via API
    try {
        await fetch(`${BACKEND_URL}/api/notificar-troca`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                solicitanteNome: usuarioLogado.nome,
                proprietarioNome: livro.nomeUsuario,
                livroTitulo: livro.titulo,
                proprietarioEmail: livro.emailUsuario || 'email@exemplo.com'
            })
        });
    } catch (err) {
        console.log('Erro ao enviar e-mail:', err);
    }
    
    // Simular notificação para o proprietário (para demonstração)
    if (Notification.permission === 'granted') {
        // Para realmente notificar o proprietário em tempo real, precisaríamos de Socket.io
        console.log(`Notificação enviada para ${livro.nomeUsuario}: Nova solicitação de troca!`);
    }
    
    return novaTroca;
}

// Função para verificar novas trocas pendentes e notificar
function verificarNovasTrocas() {
    if (!usuarioLogado) return;
    
    const trocasPendentes = trocasSolicitadas.filter(
        t => t.proprietarioId === usuarioLogado.id && t.status === 'pendente'
    );
    
    trocasPendentes.forEach(troca => {
        enviarNotificacao(
            'Nova Solicitação de Troca!',
            `${troca.solicitanteNome} quer trocar o livro "${troca.livroTitulo}" com você!`
        );
    });
}

// Função para aceitar ou recusar troca
async function responderSolicitacaoTroca(trocaId, aceitar) {
    if (!usuarioLogado) {
        return false;
    }
    
    const index = trocasSolicitadas.findIndex(t => t.id === trocaId && t.proprietarioId === usuarioLogado.id);
    
    if (index === -1) {
        return false;
    }
    
    const troca = trocasSolicitadas[index];
    troca.status = aceitar ? 'aceita' : 'recusada';
    
    if (aceitar) {
        const livroIndex = livrosRegistrados.findIndex(l => l.id === troca.livroId || l.serverId === troca.livroId);
        
        if (livroIndex !== -1) {
            const livro = livrosRegistrados[livroIndex];
            livro.disponivel = false;
            
            // Se o livro tem um ID de servidor, avisar o backend
            const serverId = livro.serverId || (typeof livro.id === 'number' ? livro.id : null);
            if (serverId) {
                try {
                    await fetch(`${BACKEND_URL}/api/livros/${serverId}/indisponivel`, { method: 'PUT' });
                } catch (err) {
                    console.error('Erro ao atualizar status no servidor:', err);
                }
            }
            
            localStorage.setItem('livros', JSON.stringify(livrosRegistrados));
            // Atualizar também no IndexedDB se existir
            if (typeof idbAdd === 'function') {
                idbAdd('livros', livro).catch(() => {});
            }
        }
    }
    
    localStorage.setItem('trocas', JSON.stringify(trocasSolicitadas));
    
    return true;
}

// Função para alternar entre capa e verso da foto do livro
function toggleVerso(btn) {
    const container = btn.parentElement;
    const imgCapa = container.querySelector('.img-capa');
    const imgVerso = container.querySelector('.img-verso');
    
    if (imgCapa.style.display === 'none') {
        imgCapa.style.display = 'block';
        imgVerso.style.display = 'none';
        btn.innerHTML = '<i class="fas fa-sync"></i> Ver Verso';
    } else {
        imgCapa.style.display = 'none';
        imgVerso.style.display = 'block';
        btn.innerHTML = '<i class="fas fa-sync"></i> Ver Capa';
    }
}

// Função para listar trocas do usuário
function listarTrocasDoUsuario() {
    if (!usuarioLogado) {
        return [];
    }
    
    return trocasSolicitadas.filter(
        troca => troca.solicitanteId === usuarioLogado.id || troca.proprietarioId === usuarioLogado.id
    );
}

// Inicializar a verificação de login em todas as páginas
document.addEventListener('DOMContentLoaded', async function() {
    // Função para mostrar/ocultar senha
    const togglePasswordBtns = document.querySelectorAll('.toggle-password');
    togglePasswordBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const targetId = this.getAttribute('data-target');
            const input = document.getElementById(targetId);
            const icon = this.querySelector('i');
            
            if (input.type === 'password') {
                input.type = 'text';
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
            } else {
                input.type = 'password';
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
            }
        });
    });
    
    verificarLogin();
    verificarNovasTrocas();
    
    // Adicionar evento de logout
    const logoutLink = document.getElementById('logout-link');
    if (logoutLink) {
        logoutLink.addEventListener('click', function(e) {
            e.preventDefault();
            fazerLogout();
        });
    }
    
    // Inicializar formulário de cadastro
    const formCadastro = document.getElementById('form-cadastro');
    if (formCadastro) {
        formCadastro.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const formData = new FormData(formCadastro);
            formData.set('termosAceitos', document.getElementById('termos').checked ? '1' : '0');
            
            try {
                const novoUsuario = await cadastrarUsuario(formData);
                if (novoUsuario) {
                    alert('Cadastro realizado com sucesso!');
                    window.location.href = 'login.html';
                }
            } catch (err) {
                alert(err.message);
            }
        });
    }
    
    // Inicializar formulário de login
    const formLogin = document.getElementById('form-login');
    if (formLogin) {
        formLogin.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const email = document.getElementById('email').value;
            const senha = document.getElementById('senha').value;
            
            const loginSucesso = await fazerLogin(email, senha);
            
            if (loginSucesso) {
                alert('Login realizado com sucesso!');
                window.location.href = 'perfil.html';
            } else {
                alert('Email ou senha incorretos!');
            }
        });
    }

    // Botão de Acesso Rápido Admin com Camada de Segurança
    const btnAdminLogin = document.getElementById('btn-admin-login');
    if (btnAdminLogin) {
        btnAdminLogin.addEventListener('click', async function() {
            const adminUser = prompt("Digite o e-mail do administrador:");
            if (!adminUser) return;
            
            const adminPass = prompt("Digite a senha do administrador:");
            if (!adminPass) return;

            // Tenta o login com as credenciais inseridas
            const loginSucesso = await fazerLogin(adminUser, adminPass);
            
            if (loginSucesso && usuarioLogado.isAdmin) {
                alert('Acesso Administrativo concedido!');
                window.location.href = 'admin.html';
            } else {
                alert('E-mail ou senha incorretos para o painel administrativo.');
                // Limpa qualquer sessão que possa ter sido criada erroneamente
                if (usuarioLogado && !usuarioLogado.isAdmin) {
                    fazerLogout();
                }
            }
        });
    }


    
    // Inicializar formulário de cadastro de livro
    const formLivro = document.getElementById('form-livro');
    if (formLivro) {
        formLivro.addEventListener('submit', async function(e) {
            e.preventDefault();

            const titulo = document.getElementById('titulo').value;
            const autor = document.getElementById('autor').value;
            const disciplina = document.getElementById('disciplina').value;
            const ano = document.getElementById('ano').value;
            const descricao = document.getElementById('descricao').value;
            const estado = document.getElementById('estado').value;
            const imagemCapaInput = document.getElementById('imagem-capa');
            const imagemVersoInput = document.getElementById('imagem-verso');
            const semCarimboCheck = document.getElementById('sem-carimbo');

            if (!imagemCapaInput.files[0] || !imagemVersoInput.files[0]) {
                alert('Por favor, envie as fotos da capa e do verso.');
                return;
            }

            if (!semCarimboCheck.checked) {
                alert('Você precisa confirmar que o livro não possui carimbo da biblioteca.');
                return;
            }

            // If backend is available, send to API, otherwise fallback to localStorage
            try {
                const formData = new FormData();
                formData.append('titulo', titulo);
                formData.append('autor', autor);
                formData.append('disciplina', disciplina);
                formData.append('ano', ano);
                formData.append('descricao', descricao);
                formData.append('estado', estado);
                formData.append('imagem-capa', imagemCapaInput.files[0]);
                formData.append('imagem-verso', imagemVersoInput.files[0]);
                
                if (usuarioLogado) {
                    formData.append('usuarioId', usuarioLogado.id);
                    formData.append('nomeUsuario', usuarioLogado.nome);
                }

                const resp = await fetch(`${BACKEND_URL}/api/livros`, {
                    method: 'POST',
                    body: formData
                });

                if (!resp.ok) throw new Error('Erro ao enviar ao servidor');

                const novoLivro = await resp.json();
                alert('Livro cadastrado com sucesso!');
                window.location.href = 'perfil.html';
            } catch (err) {
                // Fallback local: save both images as base64
                const tempId = Date.now().toString();
                
                // Function to convert file to base64
                const fileToBase64 = (file) => {
                    return new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.readAsDataURL(file);
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = error => reject(error);
                    });
                };

                let imagemCapaBase64 = null;
                let imagemVersoBase64 = null;
                
                if (imagemCapaInput.files[0]) {
                    imagemCapaBase64 = await fileToBase64(imagemCapaInput.files[0]);
                }
                if (imagemVersoInput.files[0]) {
                    imagemVersoBase64 = await fileToBase64(imagemVersoInput.files[0]);
                }

                const novoLivro = {
                    id: tempId,
                    titulo,
                    autor,
                    disciplina,
                    ano,
                    descricao,
                    estado,
                    usuarioId: usuarioLogado ? usuarioLogado.id : null,
                    nomeUsuario: usuarioLogado ? usuarioLogado.nome : null,
                    disponivel: true,
                    imagemCapa: imagemCapaBase64,
                    imagemVerso: imagemVersoBase64
                };

                // Also save to IndexedDB for consistency
                await addLocalBook(novoLivro, null);
                
                alert('Livro cadastrado localmente e será sincronizado quando precisar (offline).');
                window.location.href = 'perfil.html';
            }
        });
    }
    
        // Inicializar página de livros disponíveis
    const livrosContainer = document.getElementById('livros-disponiveis');
    if (livrosContainer) {
        // Try to fetch from backend first
        try {
            const resp = await fetch(`${BACKEND_URL}/api/livros`);
            if (!resp.ok) throw new Error('Servidor indisponível');
            const livrosDisponiveis = await resp.json();

            if (!livrosDisponiveis || livrosDisponiveis.length === 0) {
                livrosContainer.innerHTML = '<p class="text-center">Nenhum livro disponível no momento.</p>';
            } else {
                livrosDisponiveis.forEach(livro => {
                    // Proteção extra: ignora livros que não estão marcados como disponíveis
                    if (livro.disponivel === 0 || livro.disponivel === false) return;

                    const livroCard = document.createElement('div');
                    livroCard.className = 'book-card';
                    const capaPath = (livro.imagemCapaPath || livro.imagemPath || livro.imagemCapa);
                    const versoPath = (livro.imagemVersoPath || livro.imagemVerso);
                    
                    let imgHtml = `<div class="book-images-container">`;
                    if (capaPath) {
                        let imgUrl;
                        if (capaPath.startsWith('data:image')) {
                            imgUrl = capaPath;
                        } else {
                            const cleanedPath = capaPath.replace(/\\\\/g, '/');
                            imgUrl = cleanedPath.startsWith('/') ? cleanedPath : '/' + cleanedPath;
                        }
                        imgHtml += `<img src="${imgUrl}" class="img-capa" alt="Capa do livro">`;
                    } else {
                        imgHtml += `<i class="fas fa-book fa-5x"></i>`;
                    }
                    if (versoPath) {
                        let imgUrl;
                        if (versoPath.startsWith('data:image')) {
                            imgUrl = versoPath;
                        } else {
                            const cleanedPath = versoPath.replace(/\\\\/g, '/');
                            imgUrl = cleanedPath.startsWith('/') ? cleanedPath : '/' + cleanedPath;
                        }
                        imgHtml += `<img src="${imgUrl}" class="img-verso" alt="Verso do livro" style="display:none;">`;
                        imgHtml += `<button class="btn-ver-verso" onclick="toggleVerso(this)"><i class="fas fa-sync"></i> Ver Verso</button>`;
                    }
                    imgHtml += `</div>`;

                    livroCard.innerHTML = `
                        <div class="book-image">
                            ${imgHtml}
                        </div>
                        <div class="book-info">
                            <h3>${livro.titulo}</h3>
                            <p><strong>Autor:</strong> ${livro.autor}</p>
                            <p><strong>Disciplina:</strong> ${livro.disciplina}</p>
                            <p><strong>Ano:</strong> ${livro.ano}</p>
                            <p><strong>Estado:</strong> ${livro.estado}</p>
                            <p><strong>Proprietário:</strong> ${livro.nomeUsuario}</p>
                            <button class="btn solicitar-troca" data-id="${livro.id}">Solicitar Troca</button>
                        </div>
                    `;
                    livrosContainer.appendChild(livroCard);
                });
            }
            // also show local IndexedDB livros that may not be on server yet
            try {
                const allLocalLivros = await idbGetAll('livros');
                const localLivros = allLocalLivros.filter(l => l.disponivel !== false);
                localLivros.forEach(livro => {
                    // skip if server already returned it (by title+usuario or serverId)
                    const exists = livrosDisponiveis.find(l => (l.id && l.id === livro.serverId) || (l.titulo === livro.titulo && l.nomeUsuario === livro.nomeUsuario));
                    if (exists) return;
                    const livroCard = document.createElement('div');
                    livroCard.className = 'book-card';
                    
                    const capaPath = (livro.imagemCapaPath || livro.imagemPath || livro.imagemCapa);
                    const versoPath = (livro.imagemVersoPath || livro.imagemVerso);
                    
                    let imgHtml = `<div class="book-images-container">`;
                    if (capaPath) {
                        let imgUrl;
                        if (capaPath.startsWith('data:image')) {
                            imgUrl = capaPath;
                        } else {
                            const cleanedPath = capaPath.replace(/\\\\/g, '/');
                            imgUrl = cleanedPath.startsWith('/') ? cleanedPath : '/' + cleanedPath;
                        }
                        imgHtml += `<img src="${imgUrl}" class="img-capa" alt="Capa do livro">`;
                    } else if (livro.imagemBlob) {
                        const url = URL.createObjectURL(livro.imagemBlob);
                        imgHtml += `<img src="${url}" class="img-capa" alt="Capa do livro">`;
                    } else {
                        imgHtml += `<i class="fas fa-book fa-5x"></i>`;
                    }
                    if (versoPath) {
                        let imgUrl;
                        if (versoPath.startsWith('data:image')) {
                            imgUrl = versoPath;
                        } else {
                            const cleanedPath = versoPath.replace(/\\\\/g, '/');
                            imgUrl = cleanedPath.startsWith('/') ? cleanedPath : '/' + cleanedPath;
                        }
                        imgHtml += `<img src="${imgUrl}" class="img-verso" alt="Verso do livro" style="display:none;">`;
                        imgHtml += `<button class="btn-ver-verso" onclick="toggleVerso(this)"><i class="fas fa-sync"></i> Ver Verso</button>`;
                    }
                    imgHtml += `</div>`;

                    livroCard.innerHTML = `
                        <div class="book-image">
                            ${imgHtml}
                        </div>
                        <div class="book-info">
                            <h3>${livro.titulo}</h3>
                            <p><strong>Autor:</strong> ${livro.autor}</p>
                            <p><strong>Disciplina:</strong> ${livro.disciplina}</p>
                            <p><strong>Ano:</strong> ${livro.ano}</p>
                            <p><strong>Estado:</strong> ${livro.estado}</p>
                            <p><strong>Proprietário:</strong> ${livro.nomeUsuario}</p>
                            <button class="btn solicitar-troca" data-id="${livro.id}">Solicitar Troca</button>
                        </div>
                    `;
                    livrosContainer.appendChild(livroCard);
                });
            } catch (err) {
                // ignore indexedDB errors
            }
        } catch (err) {
            const allLocalLivros = await idbGetAll('livros').catch(() => []);
            const livrosDisponiveis = allLocalLivros.filter(l => l.disponivel !== false);
            if (!livrosDisponiveis || livrosDisponiveis.length === 0) {
                livrosContainer.innerHTML = '<p class="text-center">Nenhum livro disponível no momento.</p>';
            } else {
                livrosDisponiveis.forEach(livro => {
                    const livroCard = document.createElement('div');
                    livroCard.className = 'book-card';
                    
                    const capaPath = (livro.imagemCapaPath || livro.imagemPath || livro.imagemCapa);
                    const versoPath = (livro.imagemVersoPath || livro.imagemVerso);
                    
                    let imgHtml = `<div class="book-images-container">`;
                    if (capaPath) {
                        let imgUrl;
                        if (capaPath.startsWith('data:image')) {
                            imgUrl = capaPath;
                        } else {
                            const cleanedPath = capaPath.replace(/\\\\/g, '/');
                            imgUrl = cleanedPath.startsWith('/') ? cleanedPath : '/' + cleanedPath;
                        }
                        imgHtml += `<img src="${imgUrl}" class="img-capa" alt="Capa do livro">`;
                    } else if (livro.imagemBlob) {
                        const url = URL.createObjectURL(livro.imagemBlob);
                        imgHtml += `<img src="${url}" class="img-capa" alt="Capa do livro">`;
                    } else {
                        imgHtml += `<i class="fas fa-book fa-5x"></i>`;
                    }
                    if (versoPath) {
                        let imgUrl;
                        if (versoPath.startsWith('data:image')) {
                            imgUrl = versoPath;
                        } else {
                            const cleanedPath = versoPath.replace(/\\\\/g, '/');
                            imgUrl = cleanedPath.startsWith('/') ? cleanedPath : '/' + cleanedPath;
                        }
                        imgHtml += `<img src="${imgUrl}" class="img-verso" alt="Verso do livro" style="display:none;">`;
                        imgHtml += `<button class="btn-ver-verso" onclick="toggleVerso(this)"><i class="fas fa-sync"></i> Ver Verso</button>`;
                    }
                    imgHtml += `</div>`;

                    livroCard.innerHTML = `
                        <div class="book-image">
                            ${imgHtml}
                        </div>
                        <div class="book-info">
                            <h3>${livro.titulo}</h3>
                            <p><strong>Autor:</strong> ${livro.autor}</p>
                            <p><strong>Disciplina:</strong> ${livro.disciplina}</p>
                            <p><strong>Ano:</strong> ${livro.ano}</p>
                            <p><strong>Estado:</strong> ${livro.estado}</p>
                            <p><strong>Proprietário:</strong> ${livro.nomeUsuario}</p>
                            <button class="btn solicitar-troca" data-id="${livro.id}">Solicitar Troca</button>
                        </div>
                    `;
                    livrosContainer.appendChild(livroCard);
                });
            }
        }

        // Adicionar evento aos botões de solicitar troca (funciona tanto no fallback quanto com backend)
        const botoesSolicitar = document.querySelectorAll('.solicitar-troca');
        botoesSolicitar.forEach(botao => {
            botao.addEventListener('click', async function() {
                if (!usuarioLogado) {
                    alert('Você precisa estar logado para solicitar uma troca!');
                    window.location.href = 'login.html';
                    return;
                }

                const livroId = this.getAttribute('data-id');
                const troca = await solicitarTroca(livroId);

                if (troca) {
                    alert('Solicitação de troca enviada com sucesso!');
                    window.location.reload();
                } else {
                    alert('Não foi possível solicitar a troca.');
                }
            });
        });
    }
    
    // Inicializar página de perfil
    const perfilNome = document.getElementById('perfil-nome');
    const perfilEmail = document.getElementById('perfil-email');
    const perfilTurma = document.getElementById('perfil-turma');
    const profileIcon = document.getElementById('profile-icon');
    const profilePicImg = document.getElementById('profile-pic-img');
    const changeProfilePicBtn = document.getElementById('change-profile-pic-btn');
    const profilePicInput = document.getElementById('profile-pic-input');
    
    if (perfilNome && perfilEmail && perfilTurma) {
        if (!usuarioLogado) {
            window.location.href = 'login.html';
            return;
        }
        
        perfilNome.textContent = usuarioLogado.nome;
        perfilEmail.textContent = usuarioLogado.email;
        perfilTurma.textContent = usuarioLogado.turma;
        
        // Exibir foto de perfil, se houver
        if (usuarioLogado.fotoPerfil) {
            let imgUrl;
            if (usuarioLogado.fotoPerfil.startsWith('data:image')) {
                imgUrl = usuarioLogado.fotoPerfil;
            } else {
                imgUrl = usuarioLogado.fotoPerfil.startsWith('/') ? usuarioLogado.fotoPerfil : '/' + usuarioLogado.fotoPerfil;
            }
            profilePicImg.src = imgUrl;
            profilePicImg.style.display = 'block';
            profileIcon.style.display = 'none';
        }
        
        // Função para trocar foto de perfil
        if (changeProfilePicBtn && profilePicInput) {
            changeProfilePicBtn.addEventListener('click', () => {
                profilePicInput.click();
            });
            
            profilePicInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                
                // Show a preview first
                const reader = new FileReader();
                reader.onload = (event) => {
                    profilePicImg.src = event.target.result;
                    profilePicImg.style.display = 'block';
                    profileIcon.style.display = 'none';
                };
                reader.readAsDataURL(file);
                
                // Try to send to server
                try {
                    const formData = new FormData();
                    formData.append('fotoPerfil', file);
                    
                    const resp = await fetch(`${BACKEND_URL}/api/usuarios/${usuarioLogado.id}/foto-perfil`, {
                        method: 'PUT',
                        body: formData
                    });
                    
                    if (resp.ok) {
                        const updatedUser = await resp.json();
                        usuarioLogado = updatedUser;
                        localStorage.setItem('usuarioLogado', JSON.stringify(usuarioLogado));
                        alert('Foto de perfil atualizada com sucesso!');
                    } else {
                        throw new Error('Erro ao atualizar foto');
                    }
                } catch (err) {
                    console.log('Erro ao enviar para servidor, salvando localmente:', err);
                    
                    // Save locally as base64
                    const base64Reader = new FileReader();
                    base64Reader.onload = async (event) => {
                        usuarioLogado.fotoPerfil = event.target.result;
                        localStorage.setItem('usuarioLogado', JSON.stringify(usuarioLogado));
                        
                        // Also update in usuariosRegistrados
                        const usuarios = JSON.parse(localStorage.getItem('usuarios')) || [];
                        const index = usuarios.findIndex(u => u.id === usuarioLogado.id || u.id === String(usuarioLogado.id));
                        if (index !== -1) {
                            usuarios[index].fotoPerfil = event.target.result;
                            localStorage.setItem('usuarios', JSON.stringify(usuarios));
                        }
                        
                        alert('Foto de perfil atualizada localmente!');
                    };
                    base64Reader.readAsDataURL(file);
                }
            });
        }


        
        // Inicializar abas do perfil
        const tabButtons = document.querySelectorAll('.profile-tabs button');
        const tabContents = document.querySelectorAll('.tab-content');
        
        tabButtons.forEach(button => {
            button.addEventListener('click', function() {
                const tabId = this.getAttribute('data-tab');
                
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));
                
                this.classList.add('active');
                document.getElementById(tabId).classList.add('active');
                
                // Carregar conteúdo da aba
                if (tabId === 'meus-livros') {
                    carregarMeusLivros();
                } else if (tabId === 'minhas-trocas') {
                    carregarMinhasTrocas();
                }
            });
        });
        
        // Função para carregar livros do usuário
        async function carregarMeusLivros() {
            const meusLivrosContainer = document.getElementById('meus-livros-container');
            meusLivrosContainer.innerHTML = '<p>Carregando...</p>';
            
            let livrosDoUsuario = [];
            
            // Tentar buscar do servidor primeiro
            if (usuarioLogado) {
                try {
                    const resp = await fetch(`${BACKEND_URL}/api/livros`);
                    if (resp.ok) {
                        const todosLivros = await resp.json();
                        // Filtrar livros do usuário logado
                        livrosDoUsuario = todosLivros.filter(l => l.usuarioId === usuarioLogado.id || l.usuarioId === String(usuarioLogado.id));
                    }
                } catch (err) {
                    console.log('Erro ao buscar do servidor, tentando IndexedDB e localStorage');
                }
            }
            
            // Tentar IndexedDB
            if (livrosDoUsuario.length === 0 && typeof idbGetAll === 'function') {
                try {
                    const allLocalLivros = await idbGetAll('livros');
                    const localLivros = allLocalLivros.filter(l => l.usuarioId === usuarioLogado.id || l.usuarioId === String(usuarioLogado.id));
                    localLivros.forEach(livro => {
                        // Verificar se já não está na lista
                        const exists = livrosDoUsuario.find(l => (l.id && l.id === livro.serverId) || (l.titulo === livro.titulo && l.nomeUsuario === livro.nomeUsuario));
                        if (!exists) {
                            livrosDoUsuario.push(livro);
                        }
                    });
                } catch (err) {
                    console.log('Erro ao buscar IndexedDB');
                }
            }
            
            // Se não encontrou, usar o fallback do localStorage
            if (livrosDoUsuario.length === 0) {
                livrosDoUsuario = listarLivrosDoUsuario();
            }
            
            if (livrosDoUsuario.length === 0) {
                meusLivrosContainer.innerHTML = '<p>Você ainda não cadastrou nenhum livro.</p>';
            } else {
                meusLivrosContainer.innerHTML = '';
                
                livrosDoUsuario.forEach(livro => {
                    const livroCard = document.createElement('div');
                    livroCard.className = 'book-card';
                    
                    const capaPath = (livro.imagemCapaPath || livro.imagemPath || livro.imagemCapa);
                    const versoPath = (livro.imagemVersoPath || livro.imagemVerso);
                    
                    let imgHtml = `<div class="book-images-container">`;
                    if (capaPath) {
                        let imgUrl;
                        if (capaPath.startsWith('data:image')) {
                            imgUrl = capaPath;
                        } else {
                            const cleanedPath = capaPath.replace(/\\\\/g, '/');
                            imgUrl = cleanedPath.startsWith('/') ? cleanedPath : '/' + cleanedPath;
                        }
                        imgHtml += `<img src="${imgUrl}" class="img-capa" alt="Capa do livro">`;
                    } else if (livro.imagemBlob) {
                        const url = URL.createObjectURL(livro.imagemBlob);
                        imgHtml += `<img src="${url}" class="img-capa" alt="Capa do livro">`;
                    } else {
                        imgHtml += `<i class="fas fa-book fa-5x"></i>`;
                    }
                    if (versoPath) {
                        let imgUrl;
                        if (versoPath.startsWith('data:image')) {
                            imgUrl = versoPath;
                        } else {
                            const cleanedPath = versoPath.replace(/\\\\/g, '/');
                            imgUrl = cleanedPath.startsWith('/') ? cleanedPath : '/' + cleanedPath;
                        }
                        imgHtml += `<img src="${imgUrl}" class="img-verso" alt="Verso do livro" style="display:none;">`;
                        imgHtml += `<button class="btn-ver-verso" onclick="toggleVerso(this)"><i class="fas fa-sync"></i> Ver Verso</button>`;
                    }
                    imgHtml += `</div>`;

                    livroCard.innerHTML = `
                        <div class="book-image">
                            ${imgHtml}
                        </div>
                        <div class="book-info">
                            <h3>${livro.titulo}</h3>
                            <p><strong>Autor:</strong> ${livro.autor}</p>
                            <p><strong>Disciplina:</strong> ${livro.disciplina}</p>
                            <p><strong>Ano:</strong> ${livro.ano}</p>
                            <p><strong>Estado:</strong> ${livro.estado}</p>
                            <p><strong>Status:</strong> ${livro.disponivel ? 'Disponível' : 'Indisponível'}</p>
                            <button class="btn btn-danger delete-book-btn" data-id="${livro.id}" style="width: 100%; margin-top: 10px; background-color: #e74c3c; border-color: #e74c3c;">
                                <i class="fas fa-trash"></i> Excluir Livro
                            </button>
                        </div>
                    `;
                    meusLivrosContainer.appendChild(livroCard);
                });
                
                // Adicionar event listeners aos botões de exclusão
                const deleteBtns = document.querySelectorAll('.delete-book-btn');
                deleteBtns.forEach(btn => {
                    btn.addEventListener('click', function() {
                        const livroId = this.getAttribute('data-id');
                        deletarLivroUsuario(livroId);
                    });
                });
            }
        }
        
        // Função para deletar livro do usuário
        async function deletarLivroUsuario(id) {
            if (!confirm('Tem certeza que deseja excluir este livro?')) return;
            
            // Tentar deletar via API
            try {
                const resp = await fetch(`${BACKEND_URL}/api/admin/livros/${id}`, { method: 'DELETE' });
                if (resp.ok) {
                    console.log('Livro excluído do servidor');
                }
            } catch (err) {
                console.log('API falhou, usando localStorage e IndexedDB');
            }
            
            // Limpar localStorage
            let livros = JSON.parse(localStorage.getItem('livros')) || [];
            livros = livros.filter(l => l.id !== id && l.id !== String(id) && l.serverId !== id && l.serverId !== String(id));
            localStorage.setItem('livros', JSON.stringify(livros));
            
            // Tentar limpar IndexedDB também
            try {
                if (typeof idbDelete === 'function') {
                    await idbDelete('livros', id);
                }
            } catch (err) {
                console.log('Erro ao limpar IndexedDB');
            }
            
            alert('Livro excluído com sucesso');
            carregarMeusLivros();
        }
        
        // Função para carregar trocas do usuário
        function carregarMinhasTrocas() {
            const minhasTrocasContainer = document.getElementById('minhas-trocas-container');
            const trocasDoUsuario = listarTrocasDoUsuario();
            
            if (trocasDoUsuario.length === 0) {
                minhasTrocasContainer.innerHTML = '<p>Você não tem nenhuma troca.</p>';
            } else {
                minhasTrocasContainer.innerHTML = '';
                
                trocasDoUsuario.forEach(troca => {
                    const livro = livrosRegistrados.find(l => l.id === troca.livroId);
                    const solicitante = usuariosRegistrados.find(u => u.id === troca.solicitanteId);
                    const proprietario = usuariosRegistrados.find(u => u.id === troca.proprietarioId);
                    
                    if (!livro || !solicitante || !proprietario) return;
                    
                    const trocaCard = document.createElement('div');
                    trocaCard.className = 'book-card';
                    
                    let cardContent = `
                        <div class="book-image">
                            <i class="fas fa-exchange-alt fa-5x"></i>
                        </div>
                        <div class="book-info">
                            <h3>${livro.titulo}</h3>
                            <p><strong>Solicitante:</strong> ${solicitante.nome}</p>
                            <p><strong>Proprietário:</strong> ${proprietario.nome}</p>
                            <p><strong>Status:</strong> ${troca.status}</p>
                    `;
                    
                    if (troca.proprietarioId === usuarioLogado.id && troca.status === 'pendente') {
                        cardContent += `
                            <div class="troca-acoes">
                                <button class="btn responder-troca" data-id="${troca.id}" data-acao="aceitar">Aceitar</button>
                                <button class="btn btn-outline responder-troca" data-id="${troca.id}" data-acao="recusar">Recusar</button>
                            </div>
                        `;
                    }
                    
                    cardContent += `</div>`;
                    trocaCard.innerHTML = cardContent;
                    minhasTrocasContainer.appendChild(trocaCard);
                });
                
                // Adicionar evento aos botões de responder troca
                const botoesResponder = document.querySelectorAll('.responder-troca');
                botoesResponder.forEach(botao => {
                    botao.addEventListener('click', async function() {
                        const trocaId = this.getAttribute('data-id');
                        const acao = this.getAttribute('data-acao');
                        
                        const resposta = await responderSolicitacaoTroca(trocaId, acao === 'aceitar');
                        
                        if (resposta) {
                            alert(`Solicitação de troca ${acao === 'aceitar' ? 'aceita' : 'recusada'} com sucesso!`);
                            carregarMinhasTrocas();
                        } else {
                            alert('Não foi possível responder à solicitação de troca.');
                        }
                    });
                });
            }
        }
        
        // Carregar a primeira aba por padrão
        document.querySelector('.profile-tabs button').click();
    }

    // --- Lógica do Chat de Ajuda (Onde Trocar) ---
    const chatWidget = document.getElementById('chat-widget');
    const openChatBtn = document.getElementById('open-chat-btn');
    const closeChatBtn = document.getElementById('close-chat');
    const chatOptions = document.querySelector('.chat-options');
    const chatResult = document.getElementById('chat-result');
    const chatOptBtns = document.querySelectorAll('.chat-opt-btn');
    const noveltyIndicator = document.querySelector('.novelty-indicator');

    const locaisTroca = {
        '1': 'A troca para o <strong>1º Ano Médio</strong> deve ser realizada no <strong>Pátio Central</strong>, próximo à cantina, durante o intervalo.',
        '2': 'A troca para o <strong>2º Ano Médio</strong> deve ser realizada na <strong>Biblioteca</strong>, especificamente na Mesa 4, nos horários vagos.',
        '3': 'A troca para o <strong>3º Ano Médio</strong> deve ser realizada na <strong>Sala de Convivência</strong> do Grêmio Estudantil.'
    };

    // Verificar localStorage
    const hasOpenedPopup = localStorage.getItem('hasOpenedPopup') === 'true';
    const hasSeenNovelty = localStorage.getItem('hasSeenNovelty') === 'true';

    // Ocultar indicador de novidade se já foi visto
    if (noveltyIndicator && hasSeenNovelty) {
        noveltyIndicator.classList.add('hidden');
    }

    // Função para abrir o popup e marcar como visto
    function openPopup() {
        if (chatWidget && openChatBtn) {
            chatWidget.style.display = 'flex';
            openChatBtn.style.display = 'none';
            
            // Marcar que o popup já foi aberto
            localStorage.setItem('hasOpenedPopup', 'true');
            
            // Ocultar indicador de novidade
            if (noveltyIndicator) {
                noveltyIndicator.classList.add('hidden');
                localStorage.setItem('hasSeenNovelty', 'true');
            }
        }
    }

    // Auto abrir após 1.5 segundos se for primeira visita
    if (!hasOpenedPopup) {
        setTimeout(openPopup, 1500);
    }

    if (openChatBtn && chatWidget) {
        openChatBtn.addEventListener('click', () => {
            openPopup();
        });
    }

    if (closeChatBtn && chatWidget) {
        closeChatBtn.addEventListener('click', () => {
            chatWidget.style.display = 'none';
            openChatBtn.style.display = 'flex';
            // Reset chat state
            if (chatOptions) chatOptions.style.display = 'flex';
            if (chatResult) chatResult.style.display = 'none';
        });
    }

    chatOptBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const ano = btn.getAttribute('data-ano');
            const local = locaisTroca[ano];
            
            chatOptions.style.display = 'none';
            chatResult.style.display = 'block';
            chatResult.innerHTML = `
                <p>${local}</p>
                <button class="back-btn" id="chat-back-btn">Voltar às opções</button>
            `;

            document.getElementById('chat-back-btn').addEventListener('click', () => {
                chatOptions.style.display = 'flex';
                chatResult.style.display = 'none';
            });
        });
    });
});
