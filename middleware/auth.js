const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Fixed auth middleware with better error handling
const auth = async (req, res, next) => {
    try {
        console.log(`[AUTH] Processing request to ${req.path}`);
        
        const authHeader = req.header('Authorization');
        if (!authHeader) {
            console.log('[AUTH] No Authorization header found');
            return res.status(401).json({ error: 'Access denied. No token provided.' });
        }

        const token = authHeader.replace('Bearer ', '');
        if (!token) {
            console.log('[AUTH] No token in Authorization header');
            return res.status(401).json({ error: 'Access denied. Invalid token format.' });
        }

        console.log(`[AUTH] Verifying token for ${req.path}`);
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        
        console.log(`[AUTH] Token decoded, userId: ${decoded.userId}`);
        
        const user = await User.findById(decoded.userId);
        if (!user) {
            console.log(`[AUTH] User not found for userId: ${decoded.userId}`);
            return res.status(401).json({ error: 'Invalid token. User not found.' });
        }

        console.log(`[AUTH] User authenticated: ${user.username}`);
        req.user = user;
        next();
    } catch (error) {
        console.error('[AUTH] Authentication error:', error.message);
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token.' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired.' });
        }
        
        return res.status(500).json({ error: 'Authentication server error.' });
    }
};

module.exports = auth;