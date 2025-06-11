const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const WhatsAppSession = require('../models/WhatsAppSession');
const Message = require('../models/Message');
const Chat = require('../models/Chat');

class WhatsAppService {
    constructor() {
        this.clients = new Map(); // userId -> client instance
        this.qrCodes = new Map(); // userId -> qrCode
    }

    async initializeClient(userId, io) {
        try {
            // Check if client already exists and is connected
            if (this.clients.has(userId)) {
                const existingClient = this.clients.get(userId);
                if (existingClient.info) {
                    console.log(`Client already connected for user ${userId}`);
                    return { success: true, message: 'Client already connected', connected: true };
                }
            }

            // Get existing session data from database
            const sessionData = await WhatsAppSession.findByUserId(userId);
            console.log(`Session data for user ${userId}:`, sessionData ? 'Found' : 'Not found');

            const client = new Client({
                authStrategy: new LocalAuth({
                    clientId: `user_${userId}`,
                    dataPath: './sessions'
                }),
                puppeteer: {
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--single-process',
                        '--disable-gpu'
                    ]
                }
            });

            // Set up event handlers
            this.setupClientEvents(client, userId, io);

            // Store client
            this.clients.set(userId, client);

            // Initialize client
            await client.initialize();

            return { success: true, message: 'Client initialization started', connected: false };
        } catch (error) {
            console.error(`Error initializing client for user ${userId}:`, error);
            return { success: false, error: error.message };
        }
    }

    setupClientEvents(client, userId, io) {
        client.on('qr', async (qr) => {
            try {
                console.log(`QR Code generated for user ${userId}`);

                // Generate QR code as data URL
                const qrDataURL = await QRCode.toDataURL(qr);

                // Store QR code
                this.qrCodes.set(userId, qrDataURL);

                // Emit to specific user
                io.to(`user_${userId}`).emit('qr', { qr: qrDataURL });

                // Create or update session record (not active yet)
                await WhatsAppSession.create(userId);
            } catch (error) {
                console.error('Error generating QR code:', error);
            }
        });

        client.on('ready', async () => {
            try {
                console.log(`WhatsApp client ready for user ${userId}`);

                const clientInfo = client.info;
                console.log(`Connected as: ${clientInfo.pushname} (${clientInfo.wid.user})`);

                // Save session data to database
                const sessionData = {
                    clientId: `user_${userId}`,
                    phoneNumber: clientInfo.wid.user,
                    pushName: clientInfo.pushname,
                    isConnected: true
                };

                // Update session in database with full session data
                await WhatsAppSession.updateSessionData(userId, JSON.stringify(sessionData));
                await WhatsAppSession.setActive(userId, true);
                await WhatsAppSession.updatePhoneNumber(userId, clientInfo.wid.user);

                // Emit ready event
                io.to(`user_${userId}`).emit('ready', {
                    phoneNumber: clientInfo.wid.user,
                    pushName: clientInfo.pushname
                });

                // Remove QR code
                this.qrCodes.delete(userId);
            } catch (error) {
                console.error('Error in ready event:', error);
            }
        });

        client.on('authenticated', async (session) => {
            try {
                console.log(`Client authenticated for user ${userId}`);

                // Save the session data to database
                await WhatsAppSession.updateSessionData(userId, JSON.stringify(session));

                io.to(`user_${userId}`).emit('authenticated');
            } catch (error) {
                console.error('Error saving session data:', error);
            }
        });

        client.on('auth_failure', async (msg) => {
            console.error(`Authentication failed for user ${userId}:`, msg);
            await WhatsAppSession.setActive(userId, false);
            io.to(`user_${userId}`).emit('auth_failure', { message: msg });
        });

        client.on('disconnected', async (reason) => {
            console.log(`Client disconnected for user ${userId}:`, reason);
            await WhatsAppSession.setActive(userId, false);
            this.clients.delete(userId);
            io.to(`user_${userId}`).emit('disconnected', { reason });
        });

        client.on('message', async (message) => {
            // Handle incoming messages with real-time notifications
            try {
                console.log(`[WhatsApp] New message received for user ${userId}`);
                console.log(`[WhatsApp] From: ${message.from}, To: ${message.to}, FromMe: ${message.fromMe}`);

                const chat = await message.getChat();
                await this.saveMessage(userId, chat, message);

                // Only send notifications for messages NOT from the current user
                if (!message.fromMe) {
                    console.log(`[WhatsApp] Processing incoming message notification for user ${userId}`);

                    // Get sender info
                    const contact = await message.getContact();
                    const senderName = contact.pushname || contact.name || message._data.notifyName || 'Unknown Contact';

                    // Format message for notification
                    const formattedMessage = this.formatMessage(message);

                    // Prepare notification data
                    const notificationData = {
                        type: 'new_message',
                        message: formattedMessage,
                        chat: {
                            id: chat.id._serialized,
                            name: chat.name || senderName,
                            isGroup: chat.isGroup,
                            participantCount: chat.isGroup ? chat.participants?.length : 2
                        },
                        sender: {
                            name: senderName,
                            number: contact.number,
                            profilePicUrl: null // We'll get this separately if needed
                        },
                        timestamp: new Date(),
                        preview: message.body ?
                            (message.body.length > 100 ? message.body.substring(0, 100) + '...' : message.body)
                            : '[Media message]'
                    };

                    // Try to get profile picture
                    try {
                        const profilePicUrl = await contact.getProfilePicUrl();
                        notificationData.sender.profilePicUrl = profilePicUrl;
                    } catch (picError) {
                        console.log(`[WhatsApp] Could not get profile picture: ${picError.message}`);
                    }

                    // Emit real-time notification to the specific user
                    io.to(`user_${userId}`).emit('new_message_notification', notificationData);

                    // Also emit the original new_message event for backward compatibility
                    io.to(`user_${userId}`).emit('new_message', {
                        chatId: chat.id._serialized,
                        message: formattedMessage,
                        chat: notificationData.chat,
                        sender: notificationData.sender
                    });

                    console.log(`[WhatsApp] Notification sent for message from ${senderName} to user ${userId}`);
                }

            } catch (error) {
                console.error(`[WhatsApp] Error handling incoming message for user ${userId}:`, error);
            }
        });
    }

    // New method to check and restore existing session
    async checkExistingSession(userId, io) {
        try {
            console.log(`[checkExistingSession] Checking existing session for user ${userId}`);
            const sessionData = await WhatsAppSession.findByUserId(userId);
            console.log(`[checkExistingSession] Session data found:`, sessionData ? 'Yes' : 'No');

            if (sessionData) {
                console.log(`[checkExistingSession] Session details - Active: ${sessionData.is_active}, Phone: ${sessionData.phone_number}`);

                if (sessionData.is_active) {
                    console.log(`[checkExistingSession] Found active session for user ${userId}, checking client status...`);

                    // Check if client is already running
                    if (this.clients.has(userId)) {
                        const existingClient = this.clients.get(userId);
                        console.log(`[checkExistingSession] Client exists, checking if ready...`);

                        if (existingClient.info) {
                            console.log(`[checkExistingSession] Client already connected for user ${userId}`);
                            return {
                                hasSession: true,
                                isActive: true,
                                connected: true,
                                phoneNumber: sessionData.phone_number,
                                lastUsed: sessionData.last_used
                            };
                        } else {
                            console.log(`[checkExistingSession] Client exists but not ready, removing and reinitializing...`);
                            this.clients.delete(userId);
                        }
                    }

                    // Try to initialize with existing session
                    console.log(`[checkExistingSession] Attempting to restore WhatsApp client for user ${userId}...`);
                    const result = await this.initializeClient(userId, io);
                    console.log(`[checkExistingSession] Initialization result:`, result);

                    if (result.success) {
                        // Wait a bit for the client to be ready
                        await new Promise(resolve => setTimeout(resolve, 2000));

                        const isReady = this.isClientReady(userId);
                        console.log(`[checkExistingSession] Client ready after initialization: ${isReady}`);

                        return {
                            hasSession: true,
                            isActive: true,
                            connected: isReady,
                            phoneNumber: sessionData.phone_number,
                            lastUsed: sessionData.last_used
                        };
                    }
                }
            }

            console.log(`[checkExistingSession] No active session or initialization failed`);
            return {
                hasSession: !!sessionData,
                isActive: false,
                connected: false,
                phoneNumber: sessionData?.phone_number || null,
                lastUsed: sessionData?.last_used || null
            };
        } catch (error) {
            console.error(`[checkExistingSession] Error checking existing session for user ${userId}:`, error);
            return {
                hasSession: false,
                isActive: false,
                connected: false,
                phoneNumber: null,
                lastUsed: null
            };
        }
    }

    async fetchAndSaveMessages(userId, limit = null) {
        try {
            const client = this.clients.get(userId);
            if (!client || !client.info) {
                throw new Error('WhatsApp client not connected');
            }

            console.log(`[fetchAndSaveMessages] Starting for user ${userId} ${limit ? `with limit ${limit}` : 'without limit'}`);

            const chats = await client.getChats();
            let totalMessages = 0;
            let totalChatsProcessed = 0;
            const results = [];

            console.log(`[fetchAndSaveMessages] Found ${chats.length} chats to process`);

            for (let i = 0; i < chats.length; i++) {
                const chat = chats[i];

                try {
                    console.log(`[fetchAndSaveMessages] Processing chat ${i + 1}/${chats.length}: ${chat.name || chat.id.user}`);

                    // Save or update chat info first
                    const chatRecord = await Chat.create(userId, {
                        chatId: chat.id._serialized,
                        chatName: chat.name || chat.id.user,
                        chatType: chat.isGroup ? 'group' : 'individual',
                        isGroup: chat.isGroup,
                        participantCount: chat.isGroup ? chat.participants.length : 2
                    });

                    // Fetch messages with proper error handling
                    const fetchOptions = limit ? { limit } : {};
                    console.log(`[fetchAndSaveMessages] Fetching messages for: ${chat.name || chat.id.user} ${limit ? `(limit: ${limit})` : '(no limit)'}`);

                    let messages = [];
                    try {
                        messages = await chat.fetchMessages(fetchOptions);
                        console.log(`[fetchAndSaveMessages] Fetched ${messages.length} messages from ${chat.name || chat.id.user}`);
                    } catch (fetchError) {
                        console.error(`[fetchAndSaveMessages] Error fetching messages for chat ${chat.name || chat.id.user}:`, fetchError.message);
                        // Continue with empty messages array
                        messages = [];
                    }

                    // Format and save messages if any exist
                    if (messages.length > 0) {
                        try {
                            // Format messages
                            const formattedMessages = messages.map(msg => this.formatMessage(msg));

                            // Save messages in batches
                            await Message.bulkCreate(userId, chatRecord.id, formattedMessages);

                            // Update last message time
                            const lastMessage = messages[0];
                            if (lastMessage) {
                                await Chat.updateLastMessageTime(chatRecord.id, lastMessage.timestamp * 1000);
                            }

                            totalMessages += formattedMessages.length;
                        } catch (saveError) {
                            console.error(`[fetchAndSaveMessages] Error saving messages for chat ${chat.name || chat.id.user}:`, saveError.message);
                            // Continue processing other chats
                        }
                    }

                    totalChatsProcessed++;

                    results.push({
                        chatId: chat.id._serialized,
                        chatName: chat.name || chat.id.user,
                        isGroup: chat.isGroup,
                        messageCount: messages.length,
                        status: 'success'
                    });

                    // Add a small delay between chats to prevent overwhelming the system
                    if (i % 5 === 0 && i > 0) {
                        console.log(`[fetchAndSaveMessages] Processed ${i} chats, taking a brief pause...`);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }

                } catch (chatError) {
                    console.error(`[fetchAndSaveMessages] Error processing chat ${chat.id._serialized}:`, chatError.message);

                    results.push({
                        chatId: chat.id._serialized,
                        chatName: chat.name || chat.id.user,
                        isGroup: chat.isGroup,
                        messageCount: 0,
                        status: 'error',
                        error: chatError.message
                    });

                    // Continue with other chats even if one fails
                }
            }

            console.log(`[fetchAndSaveMessages] Completed: Processed ${totalChatsProcessed}/${chats.length} chats, fetched ${totalMessages} total messages for user ${userId}`);

            return {
                success: true,
                totalChats: chats.length,
                totalChatsProcessed,
                totalMessages,
                chats: results
            };

        } catch (error) {
            console.error(`[fetchAndSaveMessages] Critical error for user ${userId}:`, error);
            throw error;
        }
    }

    formatMessage(message) {
        // Ensure timestamp is properly formatted
        let timestamp = message.timestamp;
        if (typeof timestamp === 'number') {
            // WhatsApp timestamps are typically in seconds, convert to milliseconds if needed
            if (timestamp < 1e12) {
                timestamp = timestamp * 1000;
            }
        } else {
            timestamp = Date.now(); // Fallback to current time
        }

        return {
            messageId: message.id._serialized,
            fromMe: message.fromMe,
            senderName: message._data.notifyName || message.author || 'Unknown',
            senderNumber: message.author || message.from,
            body: message.body || '',
            messageType: message.type || 'text',
            timestamp: timestamp
        };
    }

    async saveMessage(userId, chat, message) {
        try {
            // Ensure chat exists
            const chatRecord = await Chat.create(userId, {
                chatId: chat.id._serialized,
                chatName: chat.name || chat.id.user,
                chatType: chat.isGroup ? 'group' : 'individual',
                isGroup: chat.isGroup,
                participantCount: chat.isGroup ? chat.participants.length : 2
            });

            // Save message
            const formattedMessage = this.formatMessage(message);
            await Message.create(userId, chatRecord.id, formattedMessage);

            // // Update last message time
            // await Chat.updateLastMessageTime(chatRecord.id, message.timestamp * 1000);

        } catch (error) {
            console.error('Error saving message:', error);
        }
    }

    getQRCode(userId) {
        return this.qrCodes.get(userId);
    }

    isClientReady(userId) {
        const client = this.clients.get(userId);
        return client && client.info;
    }

    async disconnectClient(userId) {
        try {
            const client = this.clients.get(userId);
            if (client) {
                console.log(`Disconnecting WhatsApp client for user ${userId}`);
                await client.destroy();
                this.clients.delete(userId);
            }

            await WhatsAppSession.setActive(userId, false);
            this.qrCodes.delete(userId);

            return { success: true };
        } catch (error) {
            console.error(`Error disconnecting client for user ${userId}:`, error);
            return { success: false, error: error.message };
        }
    }

    async getClientStatus(userId) {
        const client = this.clients.get(userId);
        const session = await WhatsAppSession.findByUserId(userId);

        return {
            connected: !!(client && client.info),
            hasSession: !!session,
            isActive: session?.is_active || false,
            phoneNumber: session?.phone_number,
            lastUsed: session?.last_used
        };
    }
}

module.exports = new WhatsAppService();