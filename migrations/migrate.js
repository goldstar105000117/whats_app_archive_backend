const fs = require('fs').promises;
const path = require('path');
const { query, connectWithRetry } = require('../config/database');

class MigrationRunner {
    constructor() {
        this.migrationsPath = path.join(__dirname);
        this.migrationTableName = 'schema_migrations';
    }

    async createMigrationsTable() {
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS ${this.migrationTableName} (
                id INT AUTO_INCREMENT PRIMARY KEY,
                filename VARCHAR(255) UNIQUE NOT NULL,
                executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                checksum VARCHAR(64)
            );
        `;

        try {
            await query(createTableQuery);
            console.log('✓ Migrations table created/verified');
        } catch (error) {
            console.error('❌ Error creating migrations table:', error);
            throw error;
        }
    }

    async getExecutedMigrations() {
        try {
            const result = await query(`SELECT filename FROM ${this.migrationTableName} ORDER BY id`);
            return result.rows.map(row => row.filename);
        } catch (error) {
            console.error('❌ Error getting executed migrations:', error);
            return [];
        }
    }

    async getMigrationFiles() {
        try {
            const files = await fs.readdir(this.migrationsPath);
            return files
                .filter(file => file.endsWith('.sql'))
                .sort(); // Sort to ensure consistent execution order
        } catch (error) {
            console.error('❌ Error reading migration files:', error);
            return [];
        }
    }

    async calculateChecksum(content) {
        const crypto = require('crypto');
        return crypto.createHash('md5').update(content).digest('hex');
    }

    async executeMigration(filename) {
        const filePath = path.join(this.migrationsPath, filename);

        try {
            console.log(`🔄 Executing migration: ${filename}`);

            const content = await fs.readFile(filePath, 'utf8');
            const checksum = await this.calculateChecksum(content);

            // Split content by semicolons to handle multiple statements
            const statements = content
                .split(';')
                .map(stmt => stmt.trim())
                .filter(stmt => stmt.length > 0);

            // Execute each statement
            for (const statement of statements) {
                if (statement.trim()) {
                    await query(statement);
                }
            }

            // Record the migration
            await query(
                `INSERT INTO ${this.migrationTableName} (filename, checksum) VALUES (?, ?)`,
                [filename, checksum]
            );

            console.log(`✓ Migration executed successfully: ${filename}`);
            return true;
        } catch (error) {
            console.error(`❌ Error executing migration ${filename}:`, error);
            throw error;
        }
    }

    async runMigrations() {
        try {
            console.log('🚀 Starting database migrations...');

            // Test database connection
            const connected = await connectWithRetry();
            if (!connected) {
                throw new Error('Could not connect to database');
            }

            // Create migrations table if it doesn't exist
            await this.createMigrationsTable();

            // Get list of executed migrations
            const executedMigrations = await this.getExecutedMigrations();
            console.log(`📋 Found ${executedMigrations.length} previously executed migrations`);

            // Get list of migration files
            const migrationFiles = await this.getMigrationFiles();
            console.log(`📁 Found ${migrationFiles.length} migration files`);

            if (migrationFiles.length === 0) {
                console.log('📭 No migration files found');
                return;
            }

            // Find pending migrations
            const pendingMigrations = migrationFiles.filter(
                file => !executedMigrations.includes(file)
            );

            if (pendingMigrations.length === 0) {
                console.log('✅ All migrations are up to date');
                return;
            }

            console.log(`🔄 Found ${pendingMigrations.length} pending migrations:`);
            pendingMigrations.forEach(file => console.log(`  - ${file}`));

            // Execute pending migrations
            for (const migration of pendingMigrations) {
                await this.executeMigration(migration);
            }

            console.log('🎉 All migrations completed successfully!');

        } catch (error) {
            console.error('❌ Migration failed:', error);
            process.exit(1);
        }
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'up';

    const runner = new MigrationRunner();

    await runner.runMigrations();

    process.exit(0);
}

// Only run if this file is executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Migration script failed:', error);
        process.exit(1);
    });
}

module.exports = MigrationRunner;