// ==========================================
// INTEGRAÇÃO SUPABASE
// ==========================================

class SupabaseClient {
    constructor(url, anonKey) {
        this.url = url;
        this.anonKey = anonKey;
        this.session = null;
    }

    // ==================== AUTENTICAÇÃO ====================
    async signUp(email, senha, userData) {
        try {
            const response = await fetch(`${this.url}/auth/v1/signup`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': this.anonKey,
                },
                body: JSON.stringify({
                    email: email,
                    password: senha,
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Erro ao registrar');
            }

            const data = await response.json();
            this.session = data;
            
            // Salvar dados adicionais do usuário
            if (data.user && userData) {
                await this.insertUser(data.user.id, userData);
            }

            return data.user;
        } catch (err) {
            console.error('Erro SignUp:', err);
            throw err;
        }
    }

    async signIn(email, senha) {
        try {
            const response = await fetch(`${this.url}/auth/v1/token?grant_type=password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': this.anonKey,
                },
                body: JSON.stringify({
                    email: email,
                    password: senha,
                })
            });

            if (!response.ok) {
                throw new Error('Email ou senha incorretos');
            }

            const data = await response.json();
            this.session = data;
            localStorage.setItem('supabase_session', JSON.stringify(data));
            return data;
        } catch (err) {
            console.error('Erro SignIn:', err);
            throw err;
        }
    }

    async signOut() {
        this.session = null;
        localStorage.removeItem('supabase_session');
    }

    getSession() {
        return this.session || JSON.parse(localStorage.getItem('supabase_session') || 'null');
    }

    // ==================== USUÁRIOS ====================
    async insertUser(userId, userData) {
        return this.insert('usuarios', {
            id: userId,
            ...userData
        });
    }

    async getUser(userId) {
        return this.selectOne('usuarios', userId);
    }

    async updateUser(userId, updates) {
        return this.update('usuarios', userId, updates);
    }

    // ==================== LIVROS ====================
    async insertLivro(livroData) {
        return this.insert('livros', livroData);
    }

    async getLivros() {
        return this.selectAll('livros');
    }

    async getLivrosDoUsuario(usuarioId) {
        return this.query('livros', `usuario_id=eq.${usuarioId}`);
    }

    async updateLivro(livroId, updates) {
        return this.update('livros', livroId, updates);
    }

    async deleteLivro(livroId) {
        return this.delete('livros', livroId);
    }

    // ==================== TROCAS ====================
    async insertTroca(trocaData) {
        return this.insert('trocas', trocaData);
    }

    async getTrocas() {
        return this.selectAll('trocas');
    }

    async getTrocasDoUsuario(usuarioId) {
        const trocas = await this.selectAll('trocas');
        return trocas.filter(t => 
            t.solicitante_id === usuarioId || t.proprietario_id === usuarioId
        );
    }

    async updateTroca(trocaId, updates) {
        return this.update('trocas', trocaId, updates);
    }

    // ==================== OPERAÇÕES GENÉRICAS ====================
    async insert(table, data) {
        try {
            const response = await fetch(`${this.url}/rest/v1/${table}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': this.anonKey,
                    'Authorization': `Bearer ${this.session?.access_token || this.anonKey}`,
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || `Erro ao inserir em ${table}`);
            }

            return await response.json();
        } catch (err) {
            console.error(`Erro inserir ${table}:`, err);
            throw err;
        }
    }

    async selectAll(table) {
        try {
            const response = await fetch(`${this.url}/rest/v1/${table}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': this.anonKey,
                    'Authorization': `Bearer ${this.session?.access_token || this.anonKey}`,
                }
            });

            if (!response.ok) {
                throw new Error(`Erro ao buscar ${table}`);
            }

            return await response.json();
        } catch (err) {
            console.error(`Erro buscar ${table}:`, err);
            return [];
        }
    }

    async selectOne(table, id) {
        try {
            const response = await fetch(`${this.url}/rest/v1/${table}?id=eq.${id}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': this.anonKey,
                    'Authorization': `Bearer ${this.session?.access_token || this.anonKey}`,
                }
            });

            if (!response.ok) {
                throw new Error(`Erro ao buscar ${table}`);
            }

            const data = await response.json();
            return data.length > 0 ? data[0] : null;
        } catch (err) {
            console.error(`Erro buscar ${table}:`, err);
            return null;
        }
    }

    async query(table, filter) {
        try {
            const response = await fetch(`${this.url}/rest/v1/${table}?${filter}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': this.anonKey,
                    'Authorization': `Bearer ${this.session?.access_token || this.anonKey}`,
                }
            });

            if (!response.ok) {
                throw new Error(`Erro ao consultar ${table}`);
            }

            return await response.json();
        } catch (err) {
            console.error(`Erro consultar ${table}:`, err);
            return [];
        }
    }

    async update(table, id, updates) {
        try {
            const response = await fetch(`${this.url}/rest/v1/${table}?id=eq.${id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': this.anonKey,
                    'Authorization': `Bearer ${this.session?.access_token || this.anonKey}`,
                },
                body: JSON.stringify(updates)
            });

            if (!response.ok) {
                throw new Error(`Erro ao atualizar ${table}`);
            }

            return await response.json();
        } catch (err) {
            console.error(`Erro atualizar ${table}:`, err);
            throw err;
        }
    }

    async delete(table, id) {
        try {
            const response = await fetch(`${this.url}/rest/v1/${table}?id=eq.${id}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': this.anonKey,
                    'Authorization': `Bearer ${this.session?.access_token || this.anonKey}`,
                }
            });

            if (!response.ok) {
                throw new Error(`Erro ao deletar de ${table}`);
            }

            return true;
        } catch (err) {
            console.error(`Erro deletar ${table}:`, err);
            throw err;
        }
    }
}

// Exportar para uso global
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SupabaseClient;
}
