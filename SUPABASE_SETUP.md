# Conexão do frontend com Supabase (Guia rápido)

Este arquivo explica os passos para conectar o frontend do seu site (ex.: GitHub Pages) ao Supabase usando a anon public key (frontend direto).

Passos resumidos:
1. Crie um projeto no https://supabase.com
2. Vá em Settings → API e copie:
   - URL do projeto (ex: https://xyzcompany.supabase.co)
   - ANON PUBLIC KEY (anon key)
3. No seu site estático (GitHub Pages), inclua a biblioteca supabase-js via CDN ou via bundler.
4. Inicialize o cliente no JavaScript com a URL e a ANON KEY.
5. Configure Row Level Security (RLS) e policies conforme a necessidade.

Segurança: NUNCA coloque a service_role key no frontend. Use apenas a ANON KEY no frontend e proteja operações sensíveis com RLS e policies.

Conteúdo salvo também em public/index-supabase-example.html — um exemplo completo pronto para você substituir as chaves e testar.
