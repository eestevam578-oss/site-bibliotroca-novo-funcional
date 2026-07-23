const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

// Importar Nodemailer (instalar com: npm install nodemailer)
let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch (e) {
  console.log('Nodemailer não instalado. Execute: npm install nodemailer');
}

// Configurar transporte de e-mail (usando Gmail como exemplo)
let transporter;
if (nodemailer) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'seu-email@gmail.com', // Coloque seu e-mail Gmail aqui
      pass: 'sua-senha-app' // Coloque sua senha de app do Gmail (não a senha normal!)
    }
  });
}

// Função para enviar e-mail
async function enviarEmail(destinatario, assunto, mensagem) {
  if (!transporter) {
    console.log('Transporte de e-mail não configurado');
    return false;
  }
  
  const mailOptions = {
    from: 'seu-email@gmail.com',
    to: destinatario,
    subject: assunto,
    text: mensagem,
    html: `<p>${mensagem}</p>`
  };
  
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('E-mail enviado:', info.response);
    return true;
  } catch (error) {
    console.log('Erro ao enviar e-mail:', error);
    return false;
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
// Restrict CORS by environment variable, default to allow all in dev
const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: corsOrigin }));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Basic rate limiting to mitigate brute-force/DoS in development
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60 // limit each IP to 60 requests per windowMs
});
app.use(limiter);
// Serve static files (HTML, CSS, JS) from project root so frontend can be accessed via the same server
app.use(express.static(path.join(__dirname)));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
// Limit file size to 2MB and validate mimetype
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif/;
  const ext = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = allowed.test(file.mimetype);
  if (ext && mime) cb(null, true); else cb(new Error('Somente imagens são permitidas'));
}});

// Initialize SQLite DB
const dbFile = path.join(__dirname, 'biblio.db');
const db = new sqlite3.Database(dbFile);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      senha TEXT NOT NULL,
      telefone TEXT NOT NULL,
      dataNascimento TEXT NOT NULL,
      fotoPerfil TEXT,
      serie TEXT NOT NULL,
      turma TEXT NOT NULL,
      turno TEXT NOT NULL,
      termosAceitos INTEGER DEFAULT 0,
      isAdmin INTEGER DEFAULT 0,
      criadoEm DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS livros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      autor TEXT,
      disciplina TEXT,
      ano TEXT,
      descricao TEXT,
      estado TEXT,
      usuarioId TEXT,
      nomeUsuario TEXT,
      imagemPath TEXT,
      imagemCapaPath TEXT,
      imagemVersoPath TEXT,
      disponivel INTEGER DEFAULT 1,
      criadoEm DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create default admin user if it doesn't exist
  db.get('SELECT * FROM usuarios WHERE email = ?', ['admin@bibliotroca.com'], (err, row) => {
    if (!row) {
      db.run('INSERT INTO usuarios (nome, email, senha, turma, isAdmin, telefone, dataNascimento, serie, turno, termosAceitos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
        ['Administrador', 'admin@bibliotroca.com', 'admin123', 'Sistema', 1, '(00) 00000-0000', '2000-01-01', '3º Ano', 'Manhã', 1]);
    }
  });
});

// Routes
app.get('/api/livros', (req, res) => {
  db.all('SELECT * FROM livros WHERE disponivel = 1 ORDER BY criadoEm DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Auth & Admin API
app.get('/api/admin/reset-livros', (req, res) => {
  db.run('DELETE FROM livros', (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, message: 'Todos os livros foram apagados do banco de dados.' });
  });
});

app.post('/api/login', (req, res) => {
  const { email, senha } = req.body;
  db.get('SELECT * FROM usuarios WHERE email = ? AND senha = ?', [email, senha], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(401).json({ error: 'Email ou senha incorretos' });
    res.json({ 
      id: row.id, 
      nome: row.nome, 
      email: row.email, 
      telefone: row.telefone,
      dataNascimento: row.dataNascimento,
      fotoPerfil: row.fotoPerfil,
      serie: row.serie,
      turma: row.turma,
      turno: row.turno,
      termosAceitos: row.termosAceitos,
      isAdmin: row.isAdmin 
    });
  });
});

// Endpoint to notify about a book exchange request
app.post('/api/notificar-troca', async (req, res) => {
  const { solicitanteNome, proprietarioNome, livroTitulo, proprietarioEmail } = req.body;

  if (!solicitanteNome || !proprietarioNome || !livroTitulo || !proprietarioEmail) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }

  const assunto = 'Nova Solicitação de Troca de Livro!';
  const mensagem = `
    Olá ${proprietarioNome}!
    
    ${solicitanteNome} quer trocar o livro "${livroTitulo}" com você!
    
    Acesse o BiblioTroca para ver mais detalhes e aceitar ou recusar a solicitação.
  `;

  const emailEnviado = await enviarEmail(proprietarioEmail, assunto, mensagem);
  
  if (emailEnviado) {
    res.json({ success: true, message: 'Notificação enviada com sucesso!' });
  } else {
    res.status(500).json({ error: 'Erro ao enviar notificação' });
  }
});

// Configure multer for profile picture upload
const profileStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'perfil-' + unique + path.extname(file.originalname));
  }
});
const uploadProfile = multer({ storage: profileStorage, limits: { fileSize: 2 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif/;
  const ext = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = allowed.test(file.mimetype);
  if (ext && mime) cb(null, true); else cb(new Error('Somente imagens são permitidas'));
}});

app.post('/api/usuarios', uploadProfile.single('fotoPerfil'), (req, res) => {
  const { nome, email, senha, telefone, dataNascimento, serie, turma, turno, termosAceitos } = req.body;
  const fotoPerfil = req.file ? path.join('uploads', req.file.filename).split(path.sep).join('/') : null;
  
  db.run('INSERT INTO usuarios (nome, email, senha, telefone, dataNascimento, fotoPerfil, serie, turma, turno, termosAceitos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
    [nome, email, senha, telefone, dataNascimento, fotoPerfil, serie, turma, turno, termosAceitos ? 1 : 0], 
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Email já cadastrado' });
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json({ 
        id: this.lastID, 
        nome, email, telefone, dataNascimento, fotoPerfil, serie, turma, turno, termosAceitos: termosAceitos ? 1 : 0 
      });
    }
  );
});

// CMS Endpoints
app.get('/api/admin/usuarios', (req, res) => {
  db.all('SELECT * FROM usuarios ORDER BY criadoEm DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/admin/livros', (req, res) => {
  db.all('SELECT * FROM livros ORDER BY criadoEm DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.delete('/api/admin/usuarios/:id', (req, res) => {
  db.run('DELETE FROM usuarios WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.delete('/api/admin/livros/:id', (req, res) => {
  db.run('DELETE FROM livros WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Endpoint to update user profile picture
app.put('/api/usuarios/:id/foto-perfil', uploadProfile.single('fotoPerfil'), (req, res) => {
  const { id } = req.params;
  const fotoPerfil = req.file ? path.join('uploads', req.file.filename).split(path.sep).join('/') : null;
  
  if (!fotoPerfil) {
    return res.status(400).json({ error: 'Nenhuma foto fornecida' });
  }
  
  db.run('UPDATE usuarios SET fotoPerfil = ? WHERE id = ?', [fotoPerfil, id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
    
    db.get('SELECT * FROM usuarios WHERE id = ?', [id], (err2, row) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json(row);
    });
  });
});



app.post('/api/livros', upload.fields([{ name: 'imagem-capa', maxCount: 1 }, { name: 'imagem-verso', maxCount: 1 }]), (req, res) => {
  const { titulo, autor, disciplina, ano, descricao, estado, usuarioId, nomeUsuario } = req.body;
  
  const imagemCapaPath = req.files['imagem-capa'] ? path.join('uploads', req.files['imagem-capa'][0].filename).split(path.sep).join('/') : null;
  const imagemVersoPath = req.files['imagem-verso'] ? path.join('uploads', req.files['imagem-verso'][0].filename).split(path.sep).join('/') : null;

  // For backward compatibility and single image usage, we'll use imagemCapaPath as the primary imagemPath
  const imagemPath = imagemCapaPath;

  const stmt = db.prepare(`INSERT INTO livros (titulo, autor, disciplina, ano, descricao, estado, usuarioId, nomeUsuario, imagemPath, imagemCapaPath, imagemVersoPath) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  stmt.run(titulo, autor, disciplina, ano, descricao, estado, usuarioId || null, nomeUsuario || null, imagemPath, imagemCapaPath, imagemVersoPath, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    const id = this.lastID;
    db.get('SELECT * FROM livros WHERE id = ?', [id], (err2, row) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.status(201).json(row);
    });
  });
  stmt.finalize();
});

app.put('/api/livros/:id/indisponivel', (req, res) => {
  const { id } = req.params;
  db.run('UPDATE livros SET disponivel = 0 WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Livro não encontrado' });
    res.json({ success: true, message: 'Livro marcado como indisponível' });
  });
});

// Error handler for multer file size or type errors
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Arquivo muito grande. Limite de 2MB.' });
  }
  if (err && err.message === 'Somente imagens são permitidas') {
    return res.status(400).json({ error: err.message });
  }
  // fallback
  next(err);
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

console.log(`Using DB at ${dbFile} and uploads at ${uploadsDir}`);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
