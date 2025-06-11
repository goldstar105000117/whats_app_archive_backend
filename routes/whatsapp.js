const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');
const auth = require('../middleware/auth');

// Apply authentication middleware with error handling
router.use((req, res, next) => {
    console.log(`[WhatsApp Routes] ${req.method} ${req.path}`);
    next();
});

router.use(auth);

// Routes with proper error handling
router.get('/check-session', whatsappController.checkSession);
router.post('/initialize', whatsappController.initializeWhatsApp);
router.get('/qr', whatsappController.getQRCode);
router.post('/fetch-messages', whatsappController.fetchMessages); // 5 min timeout for fetching
router.get('/status', whatsappController.getStatus);
router.post('/disconnect', whatsappController.disconnect);
router.delete('/session', whatsappController.deleteSession);

// Error handling middleware specific to WhatsApp routes
router.use((error, req, res, next) => {
    console.error(`[WhatsApp Routes] Error in ${req.path}:`, error);

    if (res.headersSent) {
        return next(error);
    }

    res.status(500).json({
        error: 'WhatsApp service error',
        ...(process.env.NODE_ENV === 'development' && { details: error.message })
    });
});

module.exports = router;