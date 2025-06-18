const whatsappService = require('../services/whatsappService');
const WhatsAppSession = require('../models/WhatsAppSession');

const checkSession = async (req, res) => {
    console.log(`[checkSession] EMERGENCY FIX - Quick response for user ${req.user.id}`);
    
    // Set immediate timeout to prevent hanging
    const timeout = setTimeout(() => {
        if (!res.headersSent) {
            console.error(`[checkSession] TIMEOUT - Force responding for user ${req.user.id}`);
            res.status(408).json({
                hasSession: false,
                isActive: false,
                connected: false,
                phoneNumber: null,
                lastUsed: null,
                error: 'Request timeout - emergency fallback'
            });
        }
    }, 15000);

    try {
        const userId = req.user.id;
        const io = req.app.get('io');

        if (!io) {
            console.error('[checkSession] Socket.IO not available');
            return res.status(500).json({ error: 'WebSocket server not available' });
        }

        if (!userId) {
            clearTimeout(timeout);
            return res.status(400).json({ error: 'User ID required' });
        }

        // Quick client check first (no database call)
        const isClientReady = whatsappService.isClientReady(userId);
        console.log(`[checkSession] Quick client check for user ${userId}: ${isClientReady}`);

        if (isClientReady) {
            clearTimeout(timeout);
            return res.json({
                hasSession: true,
                isActive: true,
                connected: true,
                phoneNumber: null, // We'll get this from client if needed
                lastUsed: new Date().toISOString()
            });
        }

        // Try database query with very short timeout
        console.log(`[checkSession] Attempting database query for user ${userId}`);
        
        // const dbPromise = WhatsAppSession.findByUserId(userId);
        // const dbTimeout = new Promise((_, reject) => 
        //     setTimeout(() => reject(new Error('DB timeout')), 2000)
        // );

        const sessionStatus = await whatsappService.checkExistingSession(userId, io);

        // const sessionData = await Promise.race([dbPromise, dbTimeout]);
        
        console.log(`[checkSession] Database query successful for user ${userId}`);
        clearTimeout(timeout);

        if (sessionStatus) {
            res.json({
                hasSession: sessionStatus.hasSession,
                isActive: sessionStatus.isActive || false,
                connected: sessionStatus.connected || false,
                phoneNumber: sessionStatus.phoneNumber || null,
                lastUsed: sessionStatus.lastUsed || null
            });
        } else {
            res.json({
                hasSession: false,
                isActive: false,
                connected: false,
                phoneNumber: null,
                lastUsed: null
            });
        }

    } catch (error) {
        clearTimeout(timeout);
        console.error('[checkSession] EMERGENCY ERROR for user', req.user?.id, ':', error.message);

        if (!res.headersSent) {
            // Always respond, never let it hang
            res.json({
                hasSession: false,
                isActive: false,
                connected: false,
                phoneNumber: null,
                lastUsed: null,
                error: 'Database error - using fallback'
            });
        }
    }
};

// EMERGENCY FIX: Simplified initialize that responds quickly
const initializeWhatsApp = async (req, res) => {
    console.log(`[initializeWhatsApp] EMERGENCY FIX - Starting for user ${req.user.id}`);
    
    // Immediate response timeout
    const timeout = setTimeout(() => {
        if (!res.headersSent) {
            console.error(`[initializeWhatsApp] TIMEOUT - Force responding for user ${req.user.id}`);
            res.status(408).json({ error: 'Initialization timeout' });
        }
    }, 15000);

    try {
        const userId = req.user.id;
        const io = req.app.get('io');

        if (!io) {
            clearTimeout(timeout);
            return res.status(500).json({ error: 'WebSocket server not available' });
        }

        // Quick check if already connected
        if (whatsappService.isClientReady(userId)) {
            clearTimeout(timeout);
            return res.json({
                message: 'Client already connected',
                status: 'connected',
                connected: true
            });
        }

        // Start initialization but don't wait for completion
        console.log(`[initializeWhatsApp] Starting background initialization for user ${userId}`);
        whatsappService.initializeClient(userId, io).catch(error => {
            console.error(`[initializeWhatsApp] Background initialization failed for user ${userId}:`, error);
        });

        // Respond immediately that we started the process
        clearTimeout(timeout);
        res.json({
            message: 'WhatsApp initialization started',
            status: 'initializing',
            connected: false
        });

    } catch (error) {
        clearTimeout(timeout);
        console.error('[initializeWhatsApp] EMERGENCY ERROR:', error);
        
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to start initialization' });
        }
    }
};

const getQRCode = async (req, res) => {
    try {
        const userId = req.user.id;
        const qrCode = whatsappService.getQRCode(userId);

        if (qrCode) {
            res.json({ qr: qrCode });
        } else {
            res.status(404).json({ error: 'QR code not available' });
        }
    } catch (error) {
        console.error('[getQRCode] Error:', error);
        res.status(500).json({ error: 'Failed to get QR code' });
    }
};

const fetchMessages = async (req, res) => {
    // Set immediate timeout
    const timeout = setTimeout(() => {
        if (!res.headersSent) {
            res.status(408).json({ error: 'Message fetch timeout' });
        }
    }, 15000);

    try {
        const userId = req.user.id;
        const { limit, all } = req.query;

        if (!whatsappService.isClientReady(userId)) {
            clearTimeout(timeout);
            return res.status(400).json({
                error: 'WhatsApp client not connected. Please scan QR code first.'
            });
        }

        let messageLimit = null;
        if (all === 'true') {
            messageLimit = null;
        } else if (limit) {
            messageLimit = parseInt(limit);
        } else {
            messageLimit = 9999;
        }

        console.log(`[fetchMessages] Starting fetch for user ${userId} with limit: ${messageLimit || 'unlimited'}`);

        const result = await whatsappService.fetchAndSaveMessages(userId, messageLimit);
        
        clearTimeout(timeout);
        res.json({
            message: `Messages fetched successfully. Total: ${result.totalMessages}`,
            data: result
        });
    } catch (error) {
        clearTimeout(timeout);
        console.error('[fetchMessages] Error:', error);
        
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to fetch messages' });
        }
    }
};

const getStatus = async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Quick status check without database calls
        const connected = whatsappService.isClientReady(userId);
        
        res.json({ 
            status: {
                connected,
                hasSession: connected, // Assume if connected, has session
                isActive: connected,
                phoneNumber: null,
                lastUsed: connected ? new Date().toISOString() : null
            }
        });
    } catch (error) {
        console.error('[getStatus] Error:', error);
        res.status(500).json({ error: 'Failed to get status' });
    }
};

const disconnect = async (req, res) => {
    const timeout = setTimeout(() => {
        if (!res.headersSent) {
            res.status(408).json({ error: 'Disconnect timeout' });
        }
    }, 5000);

    try {
        const userId = req.user.id;
        const result = await whatsappService.disconnectClient(userId);

        clearTimeout(timeout);
        if (result.success) {
            res.json({ message: 'WhatsApp client disconnected successfully' });
        } else {
            res.status(500).json({ error: result.error || 'Failed to disconnect' });
        }
    } catch (error) {
        clearTimeout(timeout);
        console.error('[disconnect] Error:', error);
        
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to disconnect WhatsApp client' });
        }
    }
};

const deleteSession = async (req, res) => {
    const timeout = setTimeout(() => {
        if (!res.headersSent) {
            res.status(408).json({ error: 'Delete timeout' });
        }
    }, 5000);

    try {
        const userId = req.user.id;

        // Disconnect client first
        await whatsappService.disconnectClient(userId);

        // Try to delete session with timeout
        try {
            await Promise.race([
                WhatsAppSession.delete(userId),
                new Promise((_, reject) => setTimeout(() => reject(new Error('DB delete timeout')), 2000))
            ]);
        } catch (dbError) {
            console.error('[deleteSession] Database error:', dbError.message);
            // Continue anyway, client is already disconnected
        }

        clearTimeout(timeout);
        res.json({ message: 'Session deleted successfully' });
    } catch (error) {
        clearTimeout(timeout);
        console.error('[deleteSession] Error:', error);
        
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to delete session' });
        }
    }
};

module.exports = {
    initializeWhatsApp,
    checkSession,
    getQRCode,
    fetchMessages,
    getStatus,
    disconnect,
    deleteSession
};