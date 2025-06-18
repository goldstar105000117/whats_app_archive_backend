CREATE TABLE IF NOT EXISTS chats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    chat_id VARCHAR(255) NOT NULL,
    chat_name VARCHAR(255),
    chat_type VARCHAR(50) DEFAULT 'individual', -- 'individual', 'group'
    is_group BOOLEAN DEFAULT false,
    participant_count INT DEFAULT 0,
    participants JSON NULL,
    last_message_time BIGINT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_chat (user_id, chat_id),
    INDEX idx_chat_type (chat_type),
    INDEX idx_is_group (is_group)
);