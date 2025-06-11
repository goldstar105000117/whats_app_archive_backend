const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const auth = require('../middleware/auth');

// All message routes require authentication
router.use(auth);

router.get('/chats', messageController.getChats);
router.get('/chats/:chatId/messages', messageController.getChatMessages);
router.get('/search', messageController.searchMessages);
router.get('/stats', messageController.getMessageStats);
router.get('/export', messageController.exportData);
router.delete('/all', messageController.deleteAllData);

module.exports = router;