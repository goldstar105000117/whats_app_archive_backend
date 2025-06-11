const mysql = require('mysql2/promise');
require('dotenv').config();

// Create connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'whatsapp_archive',
    port: process.env.DB_PORT || 3306,

    // Connection pool settings
    connectionLimit: 10,
    acquireTimeout: 60000,
    timeout: 60000,
    reconnect: true,

    // MySQL specific settings
    charset: 'utf8mb4',
    timezone: 'Z'
});

// Wrapper function for queries with better error handling
const query = async (text, params = []) => {
    const start = Date.now();
    let connection;

    try {
        connection = await pool.getConnection();
        const [rows, fields] = await connection.execute(text, params);
        const duration = Date.now() - start;

        console.log(`🔍 Executed query in ${duration}ms, returned ${Array.isArray(rows) ? rows.length : 1} rows`);

        // Return result in PostgreSQL-like format for compatibility
        return {
            rows: rows,
            rowCount: Array.isArray(rows) ? rows.length : (rows.affectedRows || 0),
            fields: fields
        };
    } catch (error) {
        console.error('❌ Database query error:', error.message);
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Add connection retry logic
const connectWithRetry = async (retries = 5) => {
    for (let i = 0; i < retries; i++) {
        let connection;
        try {
            connection = await pool.getConnection();
            await connection.execute('SELECT NOW()');
            console.log('✓ Database connection test successful');
            return true;
        } catch (err) {
            console.error(`❌ Database connection attempt ${i + 1}/${retries} failed:`, err.message);
            if (i === retries - 1) {
                console.error('❌ All database connection attempts failed');
                return false;
            }
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
        } finally {
            if (connection) {
                connection.release();
            }
        }
    }
};

// Pool monitoring
const monitorPool = () => {
    setInterval(async () => {
        try {
            const connection = await pool.getConnection();
            const [rows] = await connection.execute(`
                SELECT 
                    VARIABLE_VALUE as current_connections
                FROM information_schema.GLOBAL_STATUS 
                WHERE VARIABLE_NAME = 'Threads_connected'
            `);
            connection.release();

            console.log(`📊 Current MySQL connections: ${rows[0]?.current_connections || 'unknown'}`);
        } catch (monitorError) {
            console.error('❌ Error monitoring pool:', monitorError.message);
        }
    }, 30000); // Every 30 seconds
};

// Start monitoring in development
if (process.env.NODE_ENV !== 'production') {
    monitorPool();
}

// Test connection on startup
connectWithRetry().then(success => {
    if (!success && process.env.NODE_ENV === 'production') {
        console.error('❌ Critical: Database connection failed in production');
        process.exit(1);
    }
});

// Graceful shutdown
const gracefulShutdown = async () => {
    console.log('🔄 Closing database pool...');
    try {
        await pool.end();
        console.log('✓ Database pool closed successfully');
    } catch (error) {
        console.error('❌ Error closing database pool:', error);
    }
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Export functions
module.exports = {
    query,
    connect: () => pool.getConnection(),
    end: () => pool.end(),
    pool: pool,
    connectWithRetry,
    gracefulShutdown
};