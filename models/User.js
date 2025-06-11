const { query } = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
    static async create({ username, email, password }) {
        const hashedPassword = await bcrypt.hash(password, 10);

        const queryText = `
            INSERT INTO users (username, email, password_hash)
            VALUES (?, ?, ?)
        `;

        await query(queryText, [username, email, hashedPassword]);

        // Fetch the created user
        const selectQuery = 'SELECT id, username, email, created_at FROM users WHERE email = ?';
        const result = await query(selectQuery, [email]);
        return result.rows[0];
    }

    static async findByEmail(email) {
        const queryText = 'SELECT * FROM users WHERE email = ?';
        const result = await query(queryText, [email]);
        return result.rows[0];
    }

    static async findById(id) {
        const queryText = 'SELECT id, username, email, created_at FROM users WHERE id = ?';
        const result = await query(queryText, [id]);
        return result.rows[0];
    }

    static async findByUsername(username) {
        const queryText = 'SELECT * FROM users WHERE username = ?';
        const result = await query(queryText, [username]);
        return result.rows[0];
    }

    static async validatePassword(password, hashedPassword) {
        return await bcrypt.compare(password, hashedPassword);
    }

    static async updateLastLogin(userId) {
        const queryText = 'UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = ?';
        await query(queryText, [userId]);
    }

    static async exists(email, username = null) {
        let queryText = 'SELECT id FROM users WHERE email = ?';
        let params = [email];

        if (username) {
            queryText += ' OR username = ?';
            params.push(username);
        }

        const result = await query(queryText, params);
        return result.rows.length > 0;
    }
}

module.exports = User;