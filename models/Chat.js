const { query } = require('../config/database');

class Chat {
    static async create(userId, chatData) {
        try {
            const {
                chatId,
                chatName,
                chatType = 'individual',
                isGroup = false,
                participantCount = 0
            } = chatData;

            console.log(`[Chat.create] Creating/updating chat ${chatName} for user ${userId}`);

            const queryText = `
                INSERT INTO chats (user_id, chat_id, chat_name, chat_type, is_group, participant_count)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE 
                    chat_name = VALUES(chat_name),
                    chat_type = VALUES(chat_type),
                    is_group = VALUES(is_group),
                    participant_count = VALUES(participant_count),
                    updated_at = CURRENT_TIMESTAMP
            `;

            await query(queryText, [
                userId, chatId, chatName, chatType, isGroup, participantCount
            ]);

            // Fetch the created/updated record
            const selectQuery = 'SELECT * FROM chats WHERE user_id = ? AND chat_id = ?';
            const result = await query(selectQuery, [userId, chatId]);

            console.log(`[Chat.create] Chat created/updated: ${chatName}`);
            return result.rows[0];
        } catch (error) {
            console.error(`[Chat.create] Database error for chat ${chatData.chatName}:`, error);
            throw error;
        }
    }

    static async findByUserId(userId) {
        try {
            console.log(`[Chat.findByUserId] Finding chats for user ${userId}`);

            const queryText = `
                SELECT c.*, COUNT(m.id) as message_count
                FROM chats c
                LEFT JOIN messages m ON c.id = m.chat_id
                WHERE c.user_id = ?
                GROUP BY c.id
                ORDER BY 
                    CASE WHEN c.last_message_time IS NULL THEN 1 ELSE 0 END,
                    c.last_message_time DESC, 
                    c.created_at DESC
            `;
            const result = await query(queryText, [userId]);

            console.log(`[Chat.findByUserId] Found ${result.rows.length} chats for user ${userId}`);
            return result.rows;
        } catch (error) {
            console.error(`[Chat.findByUserId] Database error:`, error);
            throw error;
        }
    }

    static async findById(chatId, userId) {
        try {
            const queryText = 'SELECT * FROM chats WHERE id = ? AND user_id = ?';
            const result = await query(queryText, [chatId, userId]);
            return result.rows[0];
        } catch (error) {
            console.error(`[Chat.findById] Database error:`, error);
            throw error;
        }
    }

    static async updateLastMessageTime(chatId, timestamp) {
        try {
            const queryText = `
                UPDATE chats 
                SET last_message_time = FROM_UNIXTIME(? / 1000), updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;
            await query(queryText, [timestamp, chatId]);
        } catch (error) {
            console.error(`[Chat.updateLastMessageTime] Database error:`, error);
            throw error;
        }
    }

    static async deleteByUserId(userId) {
        try {
            const queryText = 'DELETE FROM chats WHERE user_id = ?';
            await query(queryText, [userId]);
        } catch (error) {
            console.error(`[Chat.deleteByUserId] Database error:`, error);
            throw error;
        }
    }
}

module.exports = Chat;