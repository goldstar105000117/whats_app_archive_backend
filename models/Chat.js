const { query } = require('../config/database');

class Chat {
    static async create(userId, chatData) {
        try {
            console.log(`[Chat] Creating/updating chat for user ${userId}:`, chatData.chatId);

            // Extract participants and format them properly
            let participantsJson = null;
            let participantCount = 0;

            if (chatData.participants && Array.isArray(chatData.participants)) {
                // Format participants data for JSON storage
                const formattedParticipants = chatData.participants.map(participant => {
                    if (typeof participant === 'object' && participant.id) {
                        return {
                            id: participant.id._serialized || participant.id,
                            isAdmin: participant.isAdmin || false,
                            isSuperAdmin: participant.isSuperAdmin || false,
                            number: participant.id.user || participant.number
                        };
                    }
                    return participant;
                });

                participantsJson = JSON.stringify(formattedParticipants);
                participantCount = formattedParticipants.length;
            } else if (chatData.participantCount) {
                participantCount = chatData.participantCount;
            }

            const queryText = `
                INSERT INTO chats (
                    user_id, 
                    chat_id, 
                    chat_name, 
                    chat_type, 
                    is_group, 
                    participant_count,
                    participants,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON DUPLICATE KEY UPDATE 
                    chat_name = VALUES(chat_name),
                    chat_type = VALUES(chat_type),
                    is_group = VALUES(is_group),
                    participant_count = VALUES(participant_count),
                    participants = VALUES(participants),
                    updated_at = CURRENT_TIMESTAMP
            `;

            await query(queryText, [
                userId,
                chatData.chatId,
                chatData.chatName || null,
                chatData.chatType || 'individual',
                chatData.isGroup || false,
                participantCount,
                participantsJson
            ]);

            // Fetch the created/updated record
            const selectQuery = 'SELECT * FROM chats WHERE user_id = ? AND chat_id = ?';
            const result = await query(selectQuery, [userId, chatData.chatId]);

            console.log(`[Chat] Chat created/updated for user ${userId}`);
            return result.rows[0];

        } catch (error) {
            console.error(`[Chat] Error creating chat for user ${userId}:`, error);
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

    static async updateParticipants(chatId, participants) {
        try {
            console.log(`[Chat] Updating participants for chat ${chatId}`);

            // Format participants for JSON storage
            const formattedParticipants = participants.map(participant => {
                if (typeof participant === 'object' && participant.id) {
                    return {
                        id: participant.id._serialized || participant.id,
                        isAdmin: participant.isAdmin || false,
                        isSuperAdmin: participant.isSuperAdmin || false,
                        number: participant.id.user || participant.number,
                        pushname: participant.pushname || null,
                        shortName: participant.shortName || null
                    };
                }
                return participant;
            });

            const participantsJson = JSON.stringify(formattedParticipants);

            const queryText = `
                UPDATE chats 
                SET participants = ?, 
                    participant_count = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE chat_id = ?
            `;

            await query(queryText, [participantsJson, formattedParticipants.length, chatId]);

            console.log(`[Chat] Participants updated for chat ${chatId}`);
            return { success: true };

        } catch (error) {
            console.error(`[Chat] Error updating participants:`, error);
            throw error;
        }
    }

    static async updateLastMessageTime(chatId, timestamp) {
        try {
            const queryText = `
                UPDATE chats 
                SET last_message_time = FROM_UNIXTIME(?), 
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;
            await query(queryText, [Math.floor(timestamp / 1000), chatId]);
        } catch (error) {
            console.error(`[Chat] Error updating last message time:`, error);
            throw error;
        }
    }

    static async delete(userId, chatId) {
        try {
            const queryText = 'DELETE FROM chats WHERE user_id = ? AND chat_id = ?';
            const result = await query(queryText, [userId, chatId]);
            return result.affectedRows > 0;
        } catch (error) {
            console.error(`[Chat] Error deleting chat:`, error);
            throw error;
        }
    }
}

module.exports = Chat;