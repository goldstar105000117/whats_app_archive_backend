const { query } = require('../config/database');

class WhatsAppSession {
  static async create(userId, sessionData = null, phoneNumber = null) {
    try {
      console.log(`[WhatsAppSession] Creating/updating session for user ${userId}`);

      const queryText = `
        INSERT INTO whatsapp_sessions (user_id, session_data, phone_number, is_active)
        VALUES (?, ?, ?, false)
        ON DUPLICATE KEY UPDATE 
          session_data = COALESCE(VALUES(session_data), session_data),
          phone_number = COALESCE(VALUES(phone_number), phone_number),
          updated_at = CURRENT_TIMESTAMP
      `;

      await query(queryText, [userId, sessionData, phoneNumber]);

      // Fetch the created/updated record
      const selectQuery = 'SELECT * FROM whatsapp_sessions WHERE user_id = ?';
      const result = await query(selectQuery, [userId]);

      console.log(`[WhatsAppSession] Session created/updated for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error(`[WhatsAppSession] Error creating session for user ${userId}:`, error);
      throw error;
    }
  }

  static async findByUserId(userId) {
    try {
      console.log(`[WhatsAppSession] Finding session for user ${userId}`);

      const queryText = 'SELECT * FROM whatsapp_sessions WHERE user_id = ?';
      const result = await query(queryText, [userId]);

      const session = result.rows[0];
      console.log(`[WhatsAppSession] Session found for user ${userId}: ${session ? 'Yes' : 'No'}`);

      return session;
    } catch (error) {
      console.error(`[WhatsAppSession] Error finding session for user ${userId}:`, error);
      throw error;
    }
  }

  static async updateSessionData(userId, sessionData) {
    try {
      console.log(`[WhatsAppSession] Updating session data for user ${userId}`);

      const queryText = `
        UPDATE whatsapp_sessions 
        SET session_data = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `;
      await query(queryText, [sessionData, userId]);

      // Fetch the updated record
      const selectQuery = 'SELECT * FROM whatsapp_sessions WHERE user_id = ?';
      const result = await query(selectQuery, [userId]);

      console.log(`[WhatsAppSession] Session data updated for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error(`[WhatsAppSession] Error updating session data for user ${userId}:`, error);
      throw error;
    }
  }

  static async setActive(userId, isActive) {
    try {
      console.log(`[WhatsAppSession] Setting active status to ${isActive} for user ${userId}`);

      const queryText = `
        UPDATE whatsapp_sessions 
        SET is_active = ?, 
            last_used = CASE WHEN ? = true THEN CURRENT_TIMESTAMP ELSE last_used END,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `;
      await query(queryText, [isActive, isActive, userId]);

      // Fetch the updated record
      const selectQuery = 'SELECT * FROM whatsapp_sessions WHERE user_id = ?';
      const result = await query(selectQuery, [userId]);

      console.log(`[WhatsAppSession] Active status updated for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error(`[WhatsAppSession] Error setting active status for user ${userId}:`, error);
      throw error;
    }
  }

  static async updatePhoneNumber(userId, phoneNumber) {
    try {
      console.log(`[WhatsAppSession] Updating phone number for user ${userId}`);

      const queryText = `
        UPDATE whatsapp_sessions 
        SET phone_number = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `;
      await query(queryText, [phoneNumber, userId]);

      // Fetch the updated record
      const selectQuery = 'SELECT * FROM whatsapp_sessions WHERE user_id = ?';
      const result = await query(selectQuery, [userId]);

      console.log(`[WhatsAppSession] Phone number updated for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error(`[WhatsAppSession] Error updating phone number for user ${userId}:`, error);
      throw error;
    }
  }

  static async delete(userId) {
    try {
      console.log(`[WhatsAppSession] Deleting session for user ${userId}`);

      // First fetch the record to return it
      const selectQuery = 'SELECT * FROM whatsapp_sessions WHERE user_id = ?';
      const selectResult = await query(selectQuery, [userId]);
      const session = selectResult.rows[0];

      // Then delete it
      const deleteQuery = 'DELETE FROM whatsapp_sessions WHERE user_id = ?';
      await query(deleteQuery, [userId]);

      console.log(`[WhatsAppSession] Session deleted for user ${userId}`);
      return session;
    } catch (error) {
      console.error(`[WhatsAppSession] Error deleting session for user ${userId}:`, error);
      throw error;
    }
  }

  static async getAllActiveSessions() {
    try {
      console.log(`[WhatsAppSession] Getting all active sessions`);

      const queryText = `
        SELECT ws.*, u.username, u.email 
        FROM whatsapp_sessions ws
        JOIN users u ON ws.user_id = u.id
        WHERE ws.is_active = true
        ORDER BY ws.last_used DESC
      `;
      const result = await query(queryText);

      console.log(`[WhatsAppSession] Found ${result.rows.length} active sessions`);
      return result.rows;
    } catch (error) {
      console.error(`[WhatsAppSession] Error getting active sessions:`, error);
      throw error;
    }
  }

  static async cleanupInactiveSessions(olderThanDays = 30) {
    try {
      console.log(`[WhatsAppSession] Cleaning up inactive sessions older than ${olderThanDays} days`);

      // First fetch the records to return them
      const selectQuery = `
        SELECT * FROM whatsapp_sessions 
        WHERE is_active = false 
        AND updated_at < DATE_SUB(NOW(), INTERVAL ? DAY)
      `;
      const selectResult = await query(selectQuery, [olderThanDays]);

      // Then delete them
      const deleteQuery = `
        DELETE FROM whatsapp_sessions 
        WHERE is_active = false 
        AND updated_at < DATE_SUB(NOW(), INTERVAL ? DAY)
      `;
      await query(deleteQuery, [olderThanDays]);

      console.log(`[WhatsAppSession] Cleaned up ${selectResult.rows.length} inactive sessions`);
      return selectResult.rows;
    } catch (error) {
      console.error(`[WhatsAppSession] Error cleaning up sessions:`, error);
      throw error;
    }
  }

  static async getSessionStats() {
    try {
      console.log(`[WhatsAppSession] Getting session statistics`);

      const queryText = `
        SELECT 
          COUNT(*) as total_sessions,
          COUNT(CASE WHEN is_active = true THEN 1 END) as active_sessions,
          COUNT(CASE WHEN is_active = false THEN 1 END) as inactive_sessions,
          AVG(TIMESTAMPDIFF(HOUR, last_used, NOW())) as avg_hours_since_last_use
        FROM whatsapp_sessions
      `;
      const result = await query(queryText);

      console.log(`[WhatsAppSession] Session statistics retrieved`);
      return result.rows[0];
    } catch (error) {
      console.error(`[WhatsAppSession] Error getting session stats:`, error);
      throw error;
    }
  }
}

module.exports = WhatsAppSession;