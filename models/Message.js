const { query } = require('../config/database');

class Message {
  static async create(userId, chatId, messageData) {
    try {
      const {
        messageId,
        fromMe,
        senderName,
        senderNumber,
        body,
        messageType = 'text',
        timestamp
      } = messageData;

      const queryText = `
        INSERT INTO messages (
          user_id, chat_id, message_id, from_me, sender_name, 
          sender_number, body, message_type, timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          sender_name = VALUES(sender_name),
          sender_number = VALUES(sender_number),
          body = VALUES(body),
          message_type = VALUES(message_type),
          timestamp = VALUES(timestamp)
      `;

      const result = await query(queryText, [
        userId, chatId, messageId, fromMe, senderName,
        senderNumber, body, messageType, timestamp
      ]);

      // For MySQL, we need to fetch the inserted record if we want to return it
      if (result.rowCount > 0) {
        const selectQuery = `
          SELECT * FROM messages 
          WHERE user_id = ? AND message_id = ?
        `;
        const selectResult = await query(selectQuery, [userId, messageId]);
        return selectResult.rows[0];
      }

      return null;
    } catch (error) {
      console.error('[Message.create] Database error:', error);
      throw error;
    }
  }

  static async findByChatId(chatId, userId) {
    try {
      const queryText = `
        SELECT * FROM messages 
        WHERE chat_id = ? AND user_id = ?
        ORDER BY timestamp DESC
      `;
      const result = await query(queryText, [chatId, userId]);
      return result.rows;
    } catch (error) {
      console.error('[Message.findByChatId] Database error:', error);
      throw error;
    }
  }

  static async getMessageStats(userId) {
    try {
      const queryText = `
        SELECT 
          COUNT(*) as total_messages,
          COUNT(CASE WHEN from_me = true THEN 1 END) as sent_messages,
          COUNT(CASE WHEN from_me = false THEN 1 END) as received_messages,
          COUNT(DISTINCT chat_id) as total_chats
        FROM messages 
        WHERE user_id = ?
      `;
      const result = await query(queryText, [userId]);
      return result.rows[0];
    } catch (error) {
      console.error('[Message.getMessageStats] Database error:', error);
      throw error;
    }
  }

  static async searchMessages(userId, searchTerm, limit = 20) {
    try {
      const queryText = `
        SELECT m.*, c.chat_name 
        FROM messages m
        JOIN chats c ON m.chat_id = c.id
        WHERE m.user_id = ? AND m.body LIKE ?
        ORDER BY m.timestamp DESC
        LIMIT ?
      `;
      const result = await query(queryText, [userId, `%${searchTerm}%`, limit]);
      return result.rows;
    } catch (error) {
      console.error('[Message.searchMessages] Database error:', error);
      throw error;
    }
  }

  static async deleteByUserId(userId) {
    try {
      const queryText = 'DELETE FROM messages WHERE user_id = ?';
      await query(queryText, [userId]);
    } catch (error) {
      console.error('[Message.deleteByUserId] Database error:', error);
      throw error;
    }
  }

  static async bulkCreate(userId, chatId, messages) {
    if (!messages || messages.length === 0) {
      console.log('[Message.bulkCreate] No messages to insert');
      return [];
    }

    try {
      console.log(`[Message.bulkCreate] Inserting ${messages.length} messages for chat ${chatId}`);

      // Process in smaller batches to avoid overwhelming the database
      const batchSize = 100;
      const results = [];

      for (let i = 0; i < messages.length; i += batchSize) {
        const batch = messages.slice(i, i + batchSize);
        console.log(`[Message.bulkCreate] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(messages.length / batchSize)}`);

        try {
          // Build bulk insert query for better performance
          const values = [];
          const placeholders = [];

          for (const msg of batch) {
            placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?)');
            values.push(
              userId,
              chatId,
              msg.messageId,
              msg.fromMe,
              msg.senderName,
              msg.senderNumber,
              msg.body,
              msg.messageType || 'text',
              msg.timestamp
            );
          }

          const bulkQuery = `
            INSERT INTO messages (
              user_id, chat_id, message_id, from_me, sender_name,
              sender_number, body, message_type, timestamp
            )
            VALUES ${placeholders.join(', ')}
            ON DUPLICATE KEY UPDATE
              sender_name = VALUES(sender_name),
              body = VALUES(body)
          `;

          await query(bulkQuery, values);
          results.push(...batch);

          console.log(`[Message.bulkCreate] Batch completed: ${batch.length} messages processed`);

          // Add a small delay between batches
          if (i + batchSize < messages.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }

        } catch (batchError) {
          console.error(`[Message.bulkCreate] Batch error:`, batchError);

          // Fallback to individual inserts for this batch
          for (const msg of batch) {
            try {
              await query(`
                INSERT INTO messages (
                  user_id, chat_id, message_id, from_me, sender_name,
                  sender_number, body, message_type, timestamp
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                  sender_name = VALUES(sender_name),
                  body = VALUES(body)
              `, [
                userId,
                chatId,
                msg.messageId,
                msg.fromMe,
                msg.senderName,
                msg.senderNumber,
                msg.body,
                msg.messageType || 'text',
                msg.timestamp
              ]);
              results.push(msg);
            } catch (msgError) {
              console.error(`[Message.bulkCreate] Error inserting message ${msg.messageId}:`, msgError.message);
            }
          }
        }
      }

      console.log(`[Message.bulkCreate] Completed: ${results.length} total messages inserted`);
      return results;

    } catch (error) {
      console.error('[Message.bulkCreate] Database error:', error);
      throw error;
    }
  }
}

module.exports = Message;