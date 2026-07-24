// ==========================================
// CONFIGURAÇÃO DO SUPABASE
// ==========================================
// Copie este arquivo para 'config.js' e preencha com suas credenciais
// Não compartilhe suas credenciais! Mantenha config.js no .gitignore

const SUPABASE_CONFIG = {
    // URL do seu projeto Supabase
    // Encontre em: Supabase Dashboard → Settings → API → Project URL
    url: 'https://seu-projeto.supabase.co',
    
    // Chave pública do Supabase (anon key)
    // Encontre em: Supabase Dashboard → Settings → API → Anon Public Key
    anonKey: 'sua-chave-anonima-aqui'
};

// ==========================================
// TIPO DE BACKEND
// ==========================================
// Escolha qual backend usar:
// 'supabase' - Recomendado para produção
// 'localhost' - Para desenvolvimento local com Express
// 'hybrid' - Tenta Supabase primeiro, fallback para localStorage

const BACKEND_TYPE = 'supabase'; // Mude para 'localhost' se estiver desenvolvendo localmente

const LOCAL_BACKEND_URL = 'http://localhost:3000'; // URL do seu servidor Express local
