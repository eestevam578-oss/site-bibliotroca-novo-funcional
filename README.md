# BiblioTroca - Backend local (Express + SQLite)

Instruções rápidas para rodar a API localmente e usar o upload de imagens do formulário.

Pré-requisitos:
- Node.js (v14+)

Instalação:

1. Abra um terminal na pasta do projeto (por exemplo, `c:\Users\eduar\Desktop\projeto prof vanda`).
2. Rode:

```powershell
npm install
```

Executando o servidor:

```powershell
npm start
```

O servidor irá rodar em http://localhost:3000 por padrão. Endpoints principais:
- GET /api/livros -> lista livros disponíveis
- POST /api/livros -> cadastra um livro (aceita multipart/form-data com campo `imagem`)

Frontend:
- O servidor agora serve os arquivos estáticos do projeto. Após `npm start`, abra no navegador:

	http://localhost:3000/

	Isso carrega `index.html` e as demais páginas (por exemplo `http://localhost:3000/cadastro-livro.html`). O JavaScript do frontend já está configurado para comunicar com a API em `http://localhost:3000`.

Docker (build e run)
---------------------
Se preferir rodar em um container Docker (útil para subir o site em um servidor):

1) Build da imagem:

```bash
docker build -t biblio-troca:latest .
```

2) Rodar o container (mapeando porta e persistindo uploads):

```bash
docker run -d -p 3000:3000 --name biblio -v "$PWD/uploads":/app/uploads biblio-troca:latest
```

3) Abra http://localhost:3000

Notas de deploy
- Não inclua `biblio.db` no repositório — o container cria o banco no primeiro run.
- Em produção, use volumes persistentes e configure variáveis de ambiente (PORT, CORS_ORIGIN).

Checklist para subir (rápido)
- [ ] Instalar Node.js localmente se quiser rodar sem Docker
- [ ] Testar `npm install` e `npm start` localmente
- [ ] (opcional) Build e run via Docker

Notas:
- As imagens enviadas são salvas na pasta `uploads/` no root do projeto.
- O banco de dados SQLite fica em `biblio.db`.

Segurança e recomendações (apenas para desenvolvimento)
- O servidor foi configurado com proteções básicas: Helmet (headers), rate limiting e restrição de CORS a `http://localhost:3000`.
- Uploads de imagens são limitados a 2MB e aceitam apenas tipos comuns (`jpeg`, `jpg`, `png`, `gif`).
- Em produção, é necessário adicionar autenticação, validações adicionais do lado do servidor, armazenar imagens em um serviço dedicado (S3, CDN) e usar HTTPS.
# site-escola
