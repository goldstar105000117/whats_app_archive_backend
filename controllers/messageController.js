const Chat = require('../models/Chat');
const Message = require('../models/Message');

const getChats = async (req, res) => {
    try {
        const userId = req.user.id;
        const chats = await Chat.findByUserId(userId);

        res.json({ chats });
    } catch (error) {
        console.error('Get chats error:', error);
        res.status(500).json({ error: 'Failed to get chats' });
    }
};

const getChatMessages = async (req, res) => {
    try {
        const userId = req.user.id;
        const { chatId } = req.params;

        // Verify chat belongs to user
        const chat = await Chat.findById(chatId, userId);
        if (!chat) {
            return res.status(404).json({ error: 'Chat not found' });
        }

        const messages = await Message.findByChatId(
            chatId,
            userId,
        );

        res.json({
            chat,
            messages,
            pagination: {
                total: messages.length
            }
        });
    } catch (error) {
        console.error('Get chat messages error:', error);
        res.status(500).json({ error: 'Failed to get chat messages' });
    }
};

const searchMessages = async (req, res) => {
    try {
        const userId = req.user.id;
        const { q: searchTerm, limit = 20 } = req.query;

        if (!searchTerm || searchTerm.trim().length < 2) {
            return res.status(400).json({
                error: 'Search term must be at least 2 characters long'
            });
        }

        const messages = await Message.searchMessages(
            userId,
            searchTerm.trim(),
            parseInt(limit)
        );

        res.json({
            searchTerm,
            results: messages,
            count: messages.length
        });
    } catch (error) {
        console.error('Search messages error:', error);
        res.status(500).json({ error: 'Failed to search messages' });
    }
};

const getMessageStats = async (req, res) => {
    try {
        const userId = req.user.id;
        const stats = await Message.getMessageStats(userId);

        res.json({ stats });
    } catch (error) {
        console.error('Get message stats error:', error);
        res.status(500).json({ error: 'Failed to get message statistics' });
    }
};

const deleteAllData = async (req, res) => {
    try {
        const userId = req.user.id;

        // Delete all messages and chats for the user
        await Message.deleteByUserId(userId);
        await Chat.deleteByUserId(userId);

        res.json({ message: 'All chat data deleted successfully' });
    } catch (error) {
        console.error('Delete all data error:', error);
        res.status(500).json({ error: 'Failed to delete data' });
    }
};

const exportData = async (req, res) => {
    try {
        const userId = req.user.id;
        const { format = 'json' } = req.query;

        const chats = await Chat.findByUserId(userId);
        const exportData = [];

        for (const chat of chats) {
            const messages = await Message.findByChatId(chat.id, userId, 1000); // Export up to 1000 messages per chat
            exportData.push({
                chat: {
                    id: chat.chat_id,
                    name: chat.chat_name,
                    type: chat.chat_type,
                    isGroup: chat.is_group,
                    participantCount: chat.participant_count,
                    lastMessageTime: chat.last_message_time,
                    messageCount: messages.length
                },
                messages: messages.map(msg => ({
                    id: msg.message_id,
                    fromMe: msg.from_me,
                    senderName: msg.sender_name,
                    senderNumber: msg.sender_number,
                    body: msg.body,
                    type: msg.message_type,
                    timestamp: new Date(parseInt(msg.timestamp)),
                    createdAt: msg.created_at
                }))
            });
        }

        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="whatsapp-export-${Date.now()}.json"`);
            res.json(exportData);
        } else {
            res.status(400).json({ error: 'Unsupported export format' });
        }
    } catch (error) {
        console.error('Export data error:', error);
        res.status(500).json({ error: 'Failed to export data' });
    }
};

module.exports = {
    getChats,
    getChatMessages,
    searchMessages,
    getMessageStats,
    deleteAllData,
    exportData
};