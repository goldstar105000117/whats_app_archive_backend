require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');

// Import routes
const authRoutes = require('./routes/auth');
const whatsappRoutes = require('./routes/whatsapp');
const messageRoutes = require('./routes/messages');

// Import database
const { connectWithRetry } = require('./config/database');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

// Add request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - Origin: ${req.headers.origin}`);
    next();
});

// CORS Configuration - FIXED
const corsOptions = {
    origin: [
        // Local development
        'http://localhost:3000',
        'http://localhost:3001', 
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',

        process.env.FRONTEND_URL,
    ].filter(Boolean),
    
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
        'Cache-Control',
        'X-Access-Token'
    ],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 200
};

// Apply CORS first
app.use(cors(corsOptions));

// Handle ALL preflight requests explicitly
app.options('*', cors(corsOptions));

// Add explicit CORS headers for debugging
app.use((req, res, next) => {
    const origin = req.headers.origin;
    
    // Check if origin is allowed
    if (corsOptions.origin.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    }
    
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS,PATCH');
    res.header('Access-Control-Allow-Headers', 'Origin,X-Requested-With,Content-Type,Accept,Authorization,Cache-Control,X-Access-Token');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
        console.log(`[PREFLIGHT] ${req.path} from ${origin}`);
        return res.status(200).end();
    }
    
    next();
});

// Body parsing middleware (after CORS)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security middleware (after CORS)
app.use(helmet({
    contentSecurityPolicy: false, // Disable for development
    crossOriginEmbedderPolicy: false
}));

// Rate limiting (after CORS) - More lenient for development
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'production' ? 100 : 1000, // More lenient in dev
    message: { error: 'Too many requests from this IP, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Skip rate limiting for health checks and development
        return req.path === '/api/health' || process.env.NODE_ENV === 'development';
    }
});
app.use('/api/', limiter);

// Auth rate limiting (stricter)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'production' ? 10 : 100, // More lenient in dev
    message: { error: 'Too many authentication attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Socket.IO with proper CORS
const io = socketIo(server, {
    cors: {
        origin: corsOptions.origin,
        methods: ["GET", "POST"],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// Make io available to routes
app.set('io', io);

// Health check (before routes)
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        cors: 'enabled',
        environment: process.env.NODE_ENV || 'development',
        allowedOrigins: corsOptions.origin
    });
});

// Test route for CORS - Enhanced
app.get('/api/test', (req, res) => {
    res.json({
        message: 'Server working!',
        origin: req.headers.origin,
        method: req.method,
        timestamp: new Date().toISOString(),
        corsEnabled: true,
        headers: req.headers
    });
});

// Routes with error handling
app.use('/api/auth', authRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/messages', messageRoutes);

// Global error handling middleware
app.use((err, req, res, next) => {
    console.error(`[Global Error Handler] ${req.method} ${req.path}:`, err);

    // Ensure CORS headers on errors
    const origin = req.headers.origin;
    if (origin && corsOptions.origin.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
    }

    // Don't send error if response already sent
    if (res.headersSent) {
        return next(err);
    }

    res.status(500).json({
        error: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { details: err.message, stack: err.stack })
    });
});

// 404 handler
app.use('*', (req, res) => {
    console.log(`[404] ${req.method} ${req.originalUrl} from ${req.headers.origin}`);
    
    // Add CORS headers to 404 responses too
    const origin = req.headers.origin;
    if (origin && corsOptions.origin.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
    }
    
    res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl,
        method: req.method
    });
});

// Socket.IO authentication middleware
io.use(async (socket, next) => {
    try {
        console.log('[Socket.IO] Authentication attempt');
        const token = socket.handshake.auth.token;
        if (!token) {
            console.log('[Socket.IO] No token provided');
            return next(new Error('Authentication error: No token provided'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        socket.userId = decoded.userId;
        socket.join(`user_${decoded.userId}`);

        console.log(`[Socket.IO] User ${decoded.userId} authenticated and joined room`);
        next();
    } catch (err) {
        console.error('[Socket.IO] Authentication error:', err.message);
        next(new Error('Authentication error: Invalid token'));
    }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id} for user ${socket.userId}`);

    socket.on('disconnect', (reason) => {
        console.log(`[Socket.IO] Client disconnected: ${socket.id} for user ${socket.userId}, reason: ${reason}`);
    });

    // Handle custom events
    socket.on('join_room', (room) => {
        socket.join(room);
        console.log(`[Socket.IO] User ${socket.userId} joined room: ${room}`);
    });

    socket.on('leave_room', (room) => {
        socket.leave(room);
        console.log(`[Socket.IO] User ${socket.userId} left room: ${room}`);
    });

    socket.on('error', (error) => {
        console.error(`[Socket.IO] Socket error for user ${socket.userId}:`, error);
    });
});

// Database connection test
const testDatabaseConnection = async () => {
    try {
        console.log('🔍 Testing database connection...');
        const success = await connectWithRetry();
        if (success) {
            console.log('✓ Database connection successful');
        } else {
            console.error('✗ Database connection failed');
            if (process.env.NODE_ENV === 'production') {
                process.exit(1);
            }
        }
    } catch (err) {
        console.error('✗ Database connection error:', err.message);
        if (process.env.NODE_ENV === 'production') {
            process.exit(1);
        }
    }
};

// Graceful shutdown
const gracefulShutdown = () => {
    console.log('📴 Received shutdown signal, closing server gracefully...');

    server.close(() => {
        console.log('🛑 HTTP server closed');

        // Close database connections
        const db = require('./config/database');
        if (db.gracefulShutdown) {
            db.gracefulShutdown(() => {
                console.log('💾 Database connection pool closed');
                process.exit(0);
            });
        } else {
            process.exit(0);
        }
    });

    // Force close after 30 seconds
    setTimeout(() => {
        console.error('⏰ Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 30000);
};

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🚫 Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Start server
const startServer = async () => {
    await testDatabaseConnection();

    server.listen(PORT, () => {
        console.log(`
🚀 Server running on port ${PORT}
📊 Environment: ${process.env.NODE_ENV || 'development'}
🌐 API Base URL: http://localhost:${PORT}/api
💾 Database: Connected
🔌 WebSocket: Ready
🌍 CORS: Enabled for origins:
${corsOptions.origin.map(origin => `   - ${origin}`).join('\n')}
⚡ Rate Limiting: ${process.env.NODE_ENV === 'production' ? 'Strict' : 'Lenient'}
        `);
    });
};

startServer().catch(err => {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
});