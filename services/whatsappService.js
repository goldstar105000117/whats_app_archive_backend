const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const WhatsAppSession = require('../models/WhatsAppSession');
const Message = require('../models/Message');
const Chat = require('../models/Chat');

class WhatsAppService {
    constructor() {
        this.clients = new Map(); // userId -> client instance
        this.qrCodes = new Map(); // userId -> qrCode
        this.initializationPromises = new Map();
    }

    async initializeClient(userId, io) {
        try {
            console.log(`[initializeClient] Starting initialization for user ${userId}`);

            // Check if initialization is already in progress
            if (this.initializationPromises.has(userId)) {
                console.log(`[initializeClient] Initialization already in progress for user ${userId}`);
                return await this.initializationPromises.get(userId);
            }

            // Check if client already exists and is connected
            if (this.clients.has(userId)) {
                const existingClient = this.clients.get(userId);
                if (existingClient.info) {
                    console.log(`[initializeClient] Client already connected for user ${userId}`);
                    return { success: true, message: 'Client already connected', connected: true };
                } else {
                    console.log(`[initializeClient] Existing client not ready, removing for user ${userId}`);
                    // Clean up non-ready client
                    try {
                        await existingClient.destroy();
                    } catch (e) {
                        console.log(`[initializeClient] Error destroying old client: ${e.message}`);
                    }
                    this.clients.delete(userId);
                }
            }

            // Create initialization promise
            const initPromise = this._performInitialization(userId, io);
            this.initializationPromises.set(userId, initPromise);

            try {
                const result = await initPromise;
                return result;
            } finally {
                // Clean up the promise tracker
                this.initializationPromises.delete(userId);
            }

        } catch (error) {
            console.error(`[initializeClient] Error initializing client for user ${userId}:`, error);
            this.initializationPromises.delete(userId);
            return { success: false, error: error.message };
        }
    }

    async _performInitialization(userId, io) {
        try {
            console.log(`[_performInitialization] Creating new client for user ${userId}`);

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

            // Store client immediately
            this.clients.set(userId, client);

            // Initialize client with timeout
            console.log(`[_performInitialization] Starting client.initialize() for user ${userId}`);

            // Create a promise that resolves when client is ready or rejects on timeout
            const initializationResult = await Promise.race([
                new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Client initialization timed out'));
                    }, 50000);

                    // Listen for ready or auth_failure events
                    client.once('ready', () => {
                        clearTimeout(timeout);
                        resolve({ success: true, message: 'Client connected', connected: true });
                    });

                    client.once('auth_failure', (msg) => {
                        clearTimeout(timeout);
                        resolve({ success: false, error: `Authentication failed: ${msg}` });
                    });

                    // Start initialization
                    client.initialize().catch((err) => {
                        clearTimeout(timeout);
                        reject(err);
                    });
                })
            ]);

            return initializationResult;

        } catch (error) {
            console.error(`[_performInitialization] Error during initialization for user ${userId}:`, error);

            // Clean up on error
            if (this.clients.has(userId)) {
                const client = this.clients.get(userId);
                try {
                    await client.destroy();
                } catch (e) {
                    console.log(`[_performInitialization] Error destroying client on error: ${e.message}`);
                }
                this.clients.delete(userId);
            }

            throw error;
        }
    }

    setupClientEvents(client, userId, io) {
        client.on('qr', async (qr) => {
            try {
                console.log(`[setupClientEvents] QR Code generated for user ${userId}`);

                // Generate QR code as data URL
                const qrDataURL = await QRCode.toDataURL(qr);

                // Store QR code
                this.qrCodes.set(userId, qrDataURL);

                // Emit to specific user
                if (io) {
                    io.to(`user_${userId}`).emit('qr', { qr: qrDataURL });
                }

                // Create or update session record (not active yet)
                await WhatsAppSession.create(userId);
            } catch (error) {
                console.error(`[setupClientEvents] Error generating QR code for user ${userId}:`, error);
            }
        });

        client.on('ready', async () => {
            try {
                console.log(`[setupClientEvents] WhatsApp client ready for user ${userId}`);

                const clientInfo = client.info;
                console.log(`[setupClientEvents] Connected as: ${clientInfo.pushname} (${clientInfo.wid.user})`);

                // IMMEDIATE: Emit ready event to frontend first (don't wait for database)
                if (io) {
                    io.to(`user_${userId}`).emit('ready', {
                        phoneNumber: clientInfo.wid.user,
                        pushName: clientInfo.pushname
                    });
                    console.log(`[setupClientEvents] Ready event emitted to frontend for user ${userId}`);
                }

                // IMMEDIATE: Remove QR code since connection is successful
                this.qrCodes.delete(userId);
                console.log(`[setupClientEvents] QR code removed for user ${userId}`);

                // BACKGROUND: Handle database updates asynchronously (don't block)
                setImmediate(async () => {
                    try {
                        console.log(`[setupClientEvents] Starting background database updates for user ${userId}`);

                        const sessionData = {
                            clientId: `user_${userId}`,
                            phoneNumber: clientInfo.wid.user,
                            pushName: clientInfo.pushname,
                            isConnected: true
                        };

                        // Use Promise.allSettled to handle each DB operation independently
                        const dbOperations = [
                            // Operation 1: Update session data
                            WhatsAppSession.updateSessionData(userId, JSON.stringify(sessionData))
                                .catch(err => {
                                    console.error(`[setupClientEvents] Failed to update session data for user ${userId}:`, err.message);
                                    return { error: 'session_data_failed' };
                                }),

                            // Operation 2: Set active status
                            WhatsAppSession.setActive(userId, true)
                                .catch(err => {
                                    console.error(`[setupClientEvents] Failed to set active for user ${userId}:`, err.message);
                                    return { error: 'set_active_failed' };
                                }),

                            // Operation 3: Update phone number
                            WhatsAppSession.updatePhoneNumber(userId, clientInfo.wid.user)
                                .catch(err => {
                                    console.error(`[setupClientEvents] Failed to update phone number for user ${userId}:`, err.message);
                                    return { error: 'phone_update_failed' };
                                })
                        ];

                        // Execute all operations with timeout
                        const results = await Promise.race([
                            Promise.allSettled(dbOperations),
                            new Promise((_, reject) =>
                                setTimeout(() => reject(new Error('Database operations timeout')), 10000)
                            )
                        ]);

                        console.log(`[setupClientEvents] Background database updates completed for user ${userId}`);

                        // Log results but don't fail if some operations failed
                        results.forEach((result, index) => {
                            if (result.status === 'fulfilled') {
                                console.log(`[setupClientEvents] DB operation ${index + 1} successful for user ${userId}`);
                            } else {
                                console.error(`[setupClientEvents] DB operation ${index + 1} failed for user ${userId}:`, result.reason?.message);
                            }
                        });

                        // Emit database update completion (optional)
                        if (io) {
                            io.to(`user_${userId}`).emit('session_saved', {
                                success: true,
                                phoneNumber: clientInfo.wid.user
                            });
                        }

                    } catch (backgroundError) {
                        console.error(`[setupClientEvents] Background database operations failed for user ${userId}:`, backgroundError.message);

                        // Even if database fails, client is still connected
                        if (io) {
                            io.to(`user_${userId}`).emit('session_saved', {
                                success: false,
                                error: 'Database update failed but client is connected',
                                phoneNumber: clientInfo.wid.user
                            });
                        }
                    }
                });

            } catch (error) {
                console.error(`[setupClientEvents] Critical error in ready event for user ${userId}:`, error);

                // Even on error, try to emit ready event
                if (io) {
                    io.to(`user_${userId}`).emit('ready', {
                        phoneNumber: 'unknown',
                        pushName: 'unknown',
                        error: 'Partial connection - some features may not work'
                    });
                }
            }
        });

        client.on('authenticated', async (session) => {
            try {
                console.log(`[setupClientEvents] Client authenticated for user ${userId}`);

                // Save the session data to database
                await WhatsAppSession.updateSessionData(userId, JSON.stringify(session));

                if (io) {
                    io.to(`user_${userId}`).emit('authenticated');
                }
            } catch (error) {
                console.error(`[setupClientEvents] Error saving session data for user ${userId}:`, error);
            }
        });

        client.on('auth_failure', async (msg) => {
            console.error(`[setupClientEvents] Authentication failed for user ${userId}:`, msg);
            try {
                await WhatsAppSession.setActive(userId, false);
                if (io) {
                    io.to(`user_${userId}`).emit('auth_failure', { message: msg });
                }
            } catch (error) {
                console.error(`[setupClientEvents] Error handling auth_failure for user ${userId}:`, error);
            }
        });

        client.on('disconnected', async (reason) => {
            console.log(`[setupClientEvents] Client disconnected for user ${userId}:`, reason);
            try {
                await WhatsAppSession.setActive(userId, false);
                this.clients.delete(userId);
                if (io) {
                    io.to(`user_${userId}`).emit('disconnected', { reason });
                }
            } catch (error) {
                console.error(`[setupClientEvents] Error handling disconnection for user ${userId}:`, error);
            }
        });

        client.on('message', async (message) => {
            // Handle incoming messages with real-time notifications
            try {
                console.log(`[setupClientEvents] New message received for user ${userId}`);
                console.log(`[setupClientEvents] From: ${message.from}, To: ${message.to}, FromMe: ${message.fromMe}`);

                const chat = await message.getChat();
                await this.saveMessage(userId, chat, message);

                // Only send notifications for messages NOT from the current user
                if (!message.fromMe && io) {
                    console.log(`[setupClientEvents] Processing incoming message notification for user ${userId}`);

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
                        console.log(`[setupClientEvents] Could not get profile picture: ${picError.message}`);
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

                    console.log(`[setupClientEvents] Notification sent for message from ${senderName} to user ${userId}`);
                }

            } catch (error) {
                console.error(`[setupClientEvents] Error handling incoming message for user ${userId}:`, error);
            }
        });
    }

    // New method to check and restore existing session
    async checkExistingSession(userId, io) {
        try {
            console.log(`[checkExistingSession] Checking existing session for user ${userId}`);

            const sessionData = await WhatsAppSession.findByUserId(userId);
            console.log(`[checkExistingSession] Session data found:`, sessionData ? 'Yes' : 'No');

            if (!sessionData) {
                return {
                    hasSession: false,
                    isActive: false,
                    connected: false,
                    phoneNumber: null,
                    lastUsed: null
                };
            }

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

                try {
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
                    } else {
                        // Initialization failed, mark session as inactive
                        await WhatsAppSession.setActive(userId, false);
                        return {
                            hasSession: true,
                            isActive: false,
                            connected: false,
                            phoneNumber: sessionData.phone_number,
                            lastUsed: sessionData.last_used
                        };
                    }
                } catch (initError) {
                    console.error(`[checkExistingSession] Error during initialization:`, initError.message);
                    // Mark session as inactive on error
                    await WhatsAppSession.setActive(userId, false);
                    return {
                        hasSession: true,
                        isActive: false,
                        connected: false,
                        phoneNumber: sessionData.phone_number,
                        lastUsed: sessionData.last_used
                    };
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

                    const chatData = {
                        chatId: chat.id._serialized,
                        chatName: chat.name || chat.id.user,
                        chatType: chat.isGroup ? 'group' : 'individual',
                        isGroup: chat.isGroup,
                        participantCount: chat.isGroup ? chat.participants?.length || 0 : 2
                    };

                    if (chat.isGroup && chat.participants) {
                        console.log(`[fetchAndSaveMessages] Processing ${chat.participants.length} participants for group: ${chat.name}`);
                        
                        // Format participants data
                        chatData.participants = chat.participants.map(participant => {
                            return {
                                id: participant.id._serialized,
                                isAdmin: participant.isAdmin || false,
                                isSuperAdmin: participant.isSuperAdmin || false,
                                number: participant.id.user
                            };
                        });

                        console.log(`[fetchAndSaveMessages] Sample participant data:`, chatData.participants[0]);
                    }
                    // Save or update chat info first
                    const chatRecord = await Chat.create(userId, chatData);

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
                            const lastMessage = messages[messages.length-1];
                            if (lastMessage) {
                                await Chat.updateLastMessageTime(chatRecord.id, lastMessage.timestamp);
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
                        participantCount: chatData.participantCount,
                        participantsStored: chat.isGroup ? (chatData.participants?.length || 0) : 0,
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
            const chatData = {
                chatId: chat.id._serialized,
                chatName: chat.name || chat.id.user,
                chatType: chat.isGroup ? 'group' : 'individual',
                isGroup: chat.isGroup,
                participantCount: chat.isGroup ? chat.participants?.length || 0 : 2
            };

            if (chat.isGroup && chat.participants) {
                chatData.participants = chat.participants.map(participant => {
                    return {
                        id: participant.id._serialized,
                        isAdmin: participant.isAdmin || false,
                        isSuperAdmin: participant.isSuperAdmin || false,
                        number: participant.id.user,
                        pushname: participant.pushname || null,
                        shortName: participant.shortName || null
                    };
                });
            }

            // Ensure chat exists
            const chatRecord = await Chat.create(userId, chatData);

            // Save message
            const formattedMessage = this.formatMessage(message);
            await Message.create(userId, chatRecord.id, formattedMessage);

            // Update last message time
            await Chat.updateLastMessageTime(chatRecord.id, message.timestamp);

        } catch (error) {
            console.error(`[saveMessage] Error saving message for user ${userId}:`, error);
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
                console.log(`[disconnectClient] Disconnecting WhatsApp client for user ${userId}`);
                await client.destroy();
                this.clients.delete(userId);
            }

            await WhatsAppSession.setActive(userId, false);
            this.qrCodes.delete(userId);
            this.initializationPromises.delete(userId); // Clean up any pending initializations

            return { success: true };
        } catch (error) {
            console.error(`[disconnectClient] Error disconnecting client for user ${userId}:`, error);
            return { success: false, error: error.message };
        }
    }

    async getClientStatus(userId) {
        try {
            const client = this.clients.get(userId);
            const session = await WhatsAppSession.findByUserId(userId);

            return {
                connected: !!(client && client.info),
                hasSession: !!session,
                isActive: session?.is_active || false,
                phoneNumber: session?.phone_number,
                lastUsed: session?.last_used
            };
        } catch (error) {
            console.error(`[getClientStatus] Error getting status for user ${userId}:`, error);
            return {
                connected: false,
                hasSession: false,
                isActive: false,
                phoneNumber: null,
                lastUsed: null
            };
        }
    }
}

module.exports = new WhatsAppService();