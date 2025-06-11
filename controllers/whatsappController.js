const whatsappService = require('../services/whatsappService');
const WhatsAppSession = require('../models/WhatsAppSession');

const initializeWhatsApp = async (req, res) => {
    try {
        console.log(`[initializeWhatsApp] Starting for user ${req.user.id}`);
        const userId = req.user.id;
        const io = req.app.get('io');

        if (!io) {
            console.error('[initializeWhatsApp] Socket.IO not available');
            return res.status(500).json({ error: 'WebSocket server not available' });
        }

        const result = await whatsappService.initializeClient(userId, io);

        console.log(`[initializeWhatsApp] Result for user ${userId}:`, result);

        if (result.success) {
            res.json({
                message: result.message,
                status: 'initializing',
                connected: result.connected || false
            });
        } else {
            res.status(500).json({
                error: result.error || 'Failed to initialize WhatsApp client'
            });
        }
    } catch (error) {
        console.error('[initializeWhatsApp] Error:', error);
        res.status(500).json({ error: 'Failed to initialize WhatsApp client' });
    }
};

// Fixed endpoint to check existing session on login
const checkSession = async (req, res) => {
    try {
        console.log(`[checkSession] Request received for user ${req.user.id}`);
        const userId = req.user.id;
        const io = req.app.get('io');

        if (!io) {
            console.error('[checkSession] Socket.IO not available');
            return res.status(500).json({ error: 'WebSocket server not available' });
        }

        console.log(`[checkSession] Calling whatsappService.checkExistingSession for user ${userId}`);
        const sessionStatus = await whatsappService.checkExistingSession(userId, io);
        console.log(`[checkSession] Session status result for user ${userId}:`, sessionStatus);

        const response = {
            hasSession: sessionStatus.hasSession || false,
            isActive: sessionStatus.isActive || false,
            connected: sessionStatus.connected || whatsappService.isClientReady(userId) || false,
            phoneNumber: sessionStatus.phoneNumber || null,
            lastUsed: sessionStatus.lastUsed || null
        };

        console.log(`[checkSession] Sending response for user ${userId}:`, response);
        res.json(response);
    } catch (error) {
        console.error('[checkSession] Error for user', req.user?.id, ':', error);

        // Don't fail completely, return a safe fallback
        res.json({
            hasSession: false,
            isActive: false,
            connected: false,
            phoneNumber: null,
            lastUsed: null,
            error: 'Failed to check session status'
        });
    }
};

const getQRCode = async (req, res) => {
    try {
        console.log(`[getQRCode] Request for user ${req.user.id}`);
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
    try {
        console.log(`[fetchMessages] Request for user ${req.user.id}`);
        const userId = req.user.id;
        const { limit, all } = req.query;

        // Check if client is ready
        if (!whatsappService.isClientReady(userId)) {
            console.log(`[fetchMessages] Client not ready for user ${userId}`);
            return res.status(400).json({
                error: 'WhatsApp client not connected. Please scan QR code first.'
            });
        }

        // Determine limit: null for no limit, or parse the provided limit
        let messageLimit = null;
        if (all === 'true') {
            messageLimit = null; // Fetch all messages
        } else if (limit) {
            messageLimit = parseInt(limit);
        } else {
            messageLimit = 5000; // Default limit
        }

        console.log(`[fetchMessages] Fetching messages for user ${userId} with limit: ${messageLimit || 'unlimited'}`);

        const result = await whatsappService.fetchAndSaveMessages(userId, messageLimit);

        res.json({
            message: `Messages fetched successfully. Total: ${result.totalMessages}`,
            data: result
        });
    } catch (error) {
        console.error('[fetchMessages] Error:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
};

const getStatus = async (req, res) => {
    try {
        console.log(`[getStatus] Request for user ${req.user.id}`);
        const userId = req.user.id;
        const status = await whatsappService.getClientStatus(userId);

        res.json({ status });
    } catch (error) {
        console.error('[getStatus] Error:', error);
        res.status(500).json({ error: 'Failed to get status' });
    }
};

const disconnect = async (req, res) => {
    try {
        console.log(`[disconnect] Request for user ${req.user.id}`);
        const userId = req.user.id;
        const result = await whatsappService.disconnectClient(userId);

        if (result.success) {
            res.json({ message: 'WhatsApp client disconnected successfully' });
        } else {
            res.status(500).json({ error: result.error || 'Failed to disconnect' });
        }
    } catch (error) {
        console.error('[disconnect] Error:', error);
        res.status(500).json({ error: 'Failed to disconnect WhatsApp client' });
    }
};

const deleteSession = async (req, res) => {
    try {
        console.log(`[deleteSession] Request for user ${req.user.id}`);
        const userId = req.user.id;

        // Disconnect client first
        await whatsappService.disconnectClient(userId);

        // Delete session from database
        await WhatsAppSession.delete(userId);

        res.json({ message: 'Session deleted successfully' });
    } catch (error) {
        console.error('[deleteSession] Error:', error);
        res.status(500).json({ error: 'Failed to delete session' });
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