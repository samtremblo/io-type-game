const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

// Game configuration
const CONFIG = {
    foodCount: 100,
    playerStartSize: 1,
    foodSize: 0.3,
    growthRate: 0.05,
    absorptionThreshold: 1.2,
    forceMagnitude: 10,
    respawnThreshold: 0.3,
    respawnAmount: 10,
    mapWidth: 20,
    mapHeight: 15,
    maxPlayers: 5,
    minPlayersToStart: 2,
    countdownTime: 3,
    tickRate: 60 // Updates per second
};

const DEFAULT_LOBBY = {
    players: new Map(),
    gameState: 'lobby',
    foodItems: [],
    countdown: CONFIG.countdownTime,
    countdownInterval: null,
    gameTickInterval: null
};

// Server state
const clients = new Map(); // Maps clientId -> {ws, playerId}
const players = new Map(); // Maps playerId -> {id, clientId, x, y, size, ready, name, color, input}
let foodItems = []; // Array of {x, y}
let gameState = 'lobby'; // 'lobby', 'countdown', 'playing', 'over'
let countdown = CONFIG.countdownTime;
let countdownInterval = null;
let gameTickInterval = null;
const playerColors = [0x44aa88, 0xaa4444, 0x4444aa, 0xaaaa44, 0xaa44aa];
const lobbies = new Map(); // Maps lobbyId -> {players, gameState, foodItems, etc}

// Initialize WebSocket server
const wss = new WebSocket.Server({ port: 8080 });
console.log('WebSocket server started on port 8080');

// Handle new client connections
wss.on('connection', (ws) => {
    const clientId = uuidv4();
    console.log(`New client connected: ${clientId}`);
    
    // Store client connection
    clients.set(clientId, { 
        ws, 
        id: clientId,
        playerId: null 
    });
    
    // Set up message handler for this client
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleClientMessage(clientId, data);
        } catch (e) {
            console.error(`Error handling message from ${clientId}:`, e);
        }
    });
    
    // Set up disconnect handler
    ws.on('close', () => {
        handleClientDisconnect(clientId);
    });
});

// Generate a random lobby code
function generateLobbyCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Create a new lobby instance
function createLobby() {
    const lobbyId = generateLobbyCode();
    lobbies.set(lobbyId, {
        ...DEFAULT_LOBBY,
        players: new Map()
    });
    console.log('Created lobby:', lobbyId);
    return lobbyId;
}

// Handle client messages
function handleClientMessage(clientId, message) {
    const client = clients.get(clientId);
    if (!client) {
        console.warn(`Message received from unknown client: ${clientId}`);
        return;
    }
    
    if (!message || !message.type) {
        console.warn(`Invalid message format from client ${clientId}`);
        return;
    }
    
    console.log('Received message:', message.type, 'from client:', clientId);
    
    try {
        switch (message.type) {
            case 'create_lobby':
                const lobbyId = createLobby();
                sendToClient(clientId, {
                    type: 'lobby_created',
                    lobbyId: lobbyId
                });
                break;
            case 'join_lobby':
                if (!message.lobbyId) {
                    sendToClient(clientId, {
                        type: 'error',
                        message: 'Lobby ID is required'
                    });
                    return;
                }
                handleJoinLobby(clientId, message.lobbyId, message.name || 'Anonymous');
                break;
            case 'toggle_ready':
                if (!client.lobbyId) {
                    sendToClient(clientId, {
                        type: 'error',
                        message: 'Not in a lobby'
                    });
                    return;
                }
                handleToggleReady(clientId, client.lobbyId);
                break;
            case 'player_input':
                if (!message.lobbyId || !message.input) {
                    console.warn(`Invalid player input from ${clientId}`);
                    return;
                }
                handlePlayerInput(clientId, message.lobbyId, message.input);
                break;
            case 'request_lobby':
                handleRequestLobby(clientId);
                break;
            default:
                console.log(`Unknown message type from ${clientId}:`, message.type);
                sendToClient(clientId, {
                    type: 'error',
                    message: 'Unknown message type'
                });
        }
    } catch (error) {
        console.error(`Error handling message from ${clientId}:`, error);
        sendToClient(clientId, {
            type: 'error',
            message: 'Internal server error'
        });
    }
}

// Handle client join request
function handleJoin(clientId, message) {
    // Check if game is in progress
    if (gameState === 'playing' || gameState === 'countdown') {
        sendToClient(clientId, {
            type: 'error',
            message: 'Game in progress. Please wait for the next round.'
        });
        return;
    }
    
    // Check if max players reached
    if (players.size >= CONFIG.maxPlayers) {
        sendToClient(clientId, {
            type: 'error',
            message: 'Server is full. Please try again later.'
        });
        return;
    }
    
    // Create player
    const playerId = uuidv4();
    const playerName = message.name || 'Anonymous';
    const playerColor = playerColors[players.size % playerColors.length];
    
    // Store player information
    players.set(playerId, {
        id: playerId,
        clientId: clientId,
        x: 0,
        y: 0,
        size: CONFIG.playerStartSize,
        ready: false,
        name: playerName,
        color: playerColor,
        input: { x: 0, y: 0 }
    });
    
    // Update client with player ID
    clients.get(clientId).playerId = playerId;
    
    // Send welcome message
    sendToClient(clientId, {
        type: 'welcome',
        clientId: clientId,
        playerId: playerId
    });
    
    // Broadcast updated lobby state
    broadcastLobbyUpdate();
}

// Handle join lobby request
function handleJoinLobby(clientId, lobbyId, playerName) {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) {
        sendToClient(clientId, {
            type: 'error',
            message: 'Lobby not found'
        });
        return;
    }

    if (lobby.gameState !== 'lobby') {
        sendToClient(clientId, {
            type: 'error',
            message: 'Game already in progress'
        });
        return;
    }

    if (lobby.players.size >= CONFIG.maxPlayers) {
        sendToClient(clientId, {
            type: 'error',
            message: 'Lobby is full'
        });
        return;
    }

    // Create player and add to lobby
    const playerId = uuidv4();
    const player = {
        id: playerId,
        clientId: clientId,
        name: playerName,
        color: playerColors[lobby.players.size % playerColors.length],
        ready: false,
        x: 0,
        y: 0,
        size: CONFIG.playerStartSize,
        input: { x: 0, y: 0 }
    };
    
    lobby.players.set(playerId, player);

    // Update client references
    const client = clients.get(clientId);
    client.lobbyId = lobbyId;
    client.playerId = playerId;

    // Send welcome message to client
    sendToClient(clientId, {
        type: 'welcome',
        clientId: clientId,
        playerId: playerId,
        lobbyId: lobbyId
    });

    // Broadcast updated player list to all players in lobby
    broadcastLobbyUpdate(lobbyId);
}

// Handle ready toggle
function handleToggleReady(clientId, lobbyId) {
    const client = clients.get(clientId);
    if (!client || !client.playerId) return;
    
    const lobby = lobbies.get(lobbyId);
    if (!lobby) return;

    const player = lobby.players.get(client.playerId);
    if (!player) return;
    
    // Toggle ready state
    player.ready = !player.ready;
    
    // Broadcast updated lobby state
    broadcastLobbyUpdate(lobbyId);
    
    // Check if all players are ready to start
    checkGameStart(lobbyId);
}

// Handle player input
function handlePlayerInput(clientId, lobbyId, input) {
    const lobby = lobbies.get(lobbyId);
    if (!lobby || lobby.gameState !== 'playing') return;
    
    const client = clients.get(clientId);
    if (!client || !client.playerId) return;
    
    const player = lobby.players.get(client.playerId);
    if (!player) return;
    
    // Normalize input vector
    const length = Math.sqrt(input.x * input.x + input.y * input.y);
    if (length > 0) {
        player.input = {
            x: input.x / length,
            y: input.y / length
        };
    } else {
        player.input = { x: 0, y: 0 };
    }
}

// Handle request to return to lobby
function handleRequestLobby(clientId) {
    const client = clients.get(clientId);
    if (!client || !client.lobbyId) return;

    const lobby = lobbies.get(client.lobbyId);
    if (!lobby) return;

    // Clear any existing intervals
    if (lobby.countdownInterval) {
        clearInterval(lobby.countdownInterval);
        lobby.countdownInterval = null;
    }
    if (lobby.gameTickInterval) {
        clearInterval(lobby.gameTickInterval);
        lobby.gameTickInterval = null;
    }

    // Reset lobby state
    lobby.gameState = 'lobby';
    lobby.foodItems = [];
    lobby.countdown = CONFIG.countdownTime;
    
    // Reset all players in this lobby
    lobby.players.forEach(player => {
        player.x = 0;
        player.y = 0;
        player.size = CONFIG.playerStartSize;
        player.ready = false;
        player.input = { x: 0, y: 0 };
    });
    
    // Force all clients in this lobby to return to lobby
    broadcastToLobby(client.lobbyId, {
        type: 'force_lobby'
    });
    
    // Broadcast the reset to all clients in this lobby
    broadcastLobbyUpdate(client.lobbyId);
}

// Handle client disconnect
function handleClientDisconnect(clientId) {
    console.log(`Client disconnected: ${clientId}`);
    
    const client = clients.get(clientId);
    if (!client) return;

    const lobby = client.lobbyId ? lobbies.get(client.lobbyId) : null;
    if (lobby && client.playerId) {
        // Remove player from lobby
        lobby.players.delete(client.playerId);
        
        // Notify remaining players
        broadcastToLobby(client.lobbyId, {
            type: 'player_eaten',
            eaten: client.playerId,
            by: null
        });
        
        // Check if game should end
        if (lobby.gameState === 'playing' && lobby.players.size <= 1) {
            const remainingPlayers = Array.from(lobby.players.values());
            endGame(client.lobbyId, remainingPlayers[0]?.id);
        }
    }
    
    // Remove client
    clients.delete(clientId);
}

// Broadcast lobby update to all clients
function broadcastLobbyUpdate(lobbyId) {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) return;

    // Create player list for lobby
    const playerList = Array.from(lobby.players.values()).map(player => ({
        id: player.id,
        name: player.name,
        ready: player.ready,
        color: player.color
    }));
    
    // Send update to all clients
    broadcastToLobby(lobbyId, {
        type: 'lobby_update',
        players: playerList
    });
}

// Check if game can start
function checkGameStart(lobbyId) {
    const lobby = lobbies.get(lobbyId);
    if (!lobby || lobby.gameState !== 'lobby') return;
    
    const playerList = Array.from(lobby.players.values());
    
    // Need minimum players and all must be ready
    if (playerList.length >= CONFIG.minPlayersToStart && playerList.every(p => p.ready)) {
        // Start countdown
        startCountdown(lobbyId);
    }
}

// Start game countdown
function startCountdown(lobbyId) {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) return;

    lobby.gameState = 'countdown';
    lobby.countdown = CONFIG.countdownTime;
    
    // Broadcast initial countdown value
    broadcastToLobby(lobbyId, {
        type: 'countdown',
        count: lobby.countdown
    });
    
    // Set up countdown interval
    lobby.countdownInterval = setInterval(() => {
        lobby.countdown--;
        
        if (lobby.countdown > 0) {
            // Update countdown
            broadcastToLobby(lobbyId, {
                type: 'countdown',
                count: lobby.countdown
            });
        } else {
            // Start game
            clearInterval(lobby.countdownInterval);
            startGame(lobbyId);
        }
    }, 1000);
}

// Start the game
function startGame(lobbyId) {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) return;

    lobby.gameState = 'playing';
    
    // Initialize player positions
    initializeGamePositions(lobbyId);
    
    // Generate food
    generateFood(lobbyId);
    
    // Send game start message
    broadcastToLobby(lobbyId, {
        type: 'game_start',
        players: Array.from(lobby.players.values()).map(player => ({
            id: player.id,
            x: player.x,
            y: player.y,
            size: player.size
        })),
        food: lobby.foodItems
    });
    
    // Start game tick
    startGameTick(lobbyId);
}

// Initialize player positions
function initializeGamePositions(lobbyId) {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) return;

    const playerList = Array.from(lobby.players.values());
    
    // Position players in a circle around the center
    const radius = Math.min(CONFIG.mapWidth, CONFIG.mapHeight) / 3;
    const angleStep = (2 * Math.PI) / playerList.length;
    
    playerList.forEach((player, index) => {
        const angle = angleStep * index;
        player.x = Math.cos(angle) * radius;
        player.y = Math.sin(angle) * radius;
        player.size = CONFIG.playerStartSize;
        player.input = { x: 0, y: 0 };
    });
}

// Generate food items
function generateFood(lobbyId) {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) return;

    lobby.foodItems = [];
    
    for (let i = 0; i < CONFIG.foodCount; i++) {
        lobby.foodItems.push({
            x: (Math.random() * 2 - 1) * CONFIG.mapWidth,
            y: (Math.random() * 2 - 1) * CONFIG.mapHeight
        });
    }
}

// Start game tick with performance monitoring
function startGameTick(lobbyId) {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) return;

    const tickInterval = 1000 / CONFIG.tickRate;
    let lastTickTime = process.hrtime.bigint();
    let tickCount = 0;
    let lastPerformanceReport = Date.now();
    
    lobby.gameTickInterval = setInterval(() => {
        if (lobby.gameState !== 'playing') {
            clearInterval(lobby.gameTickInterval);
            return;
        }
        
        const currentTime = process.hrtime.bigint();
        const deltaTime = Number(currentTime - lastTickTime) / 1e9; // Convert to seconds
        lastTickTime = currentTime;
        
        // Performance monitoring
        tickCount++;
        const now = Date.now();
        if (now - lastPerformanceReport >= 5000) { // Report every 5 seconds
            const actualTickRate = tickCount / 5;
            console.log(`[Lobby ${lobbyId}] Tick rate: ${actualTickRate.toFixed(2)}/sec (target: ${CONFIG.tickRate}), Players: ${lobby.players.size}`);
            tickCount = 0;
            lastPerformanceReport = now;
        }
        
        try {
            updateGameState(lobbyId, deltaTime);
            broadcastGameState(lobbyId);
        } catch (error) {
            console.error(`Error in game tick for lobby ${lobbyId}:`, error);
            // Attempt to recover
            if (error.message.includes('player') || error.message.includes('collision')) {
                initializeGamePositions(lobbyId);
            }
        }
    }, tickInterval);
}

// Update game state with improved physics and validation
function updateGameState(lobbyId, deltaTime = 1/CONFIG.tickRate) {
    const lobby = lobbies.get(lobbyId);
    if (!lobby || lobby.gameState !== 'playing') return;

    // Validate game state
    if (lobby.players.size < CONFIG.minPlayersToStart) {
        endGame(lobbyId, null);
        return;
    }

    // Move players according to input with improved physics
    lobby.players.forEach(player => {
        try {
            if (!player || typeof player.size !== 'number') {
                console.error('Invalid player data:', player);
                return;
            }

            if (player.input && (player.input.x !== 0 || player.input.y !== 0)) {
                // Speed decreases with size for better balance
                const moveSpeed = CONFIG.forceMagnitude * Math.pow(1 / player.size, 0.5) * deltaTime;
                
                // Normalize diagonal movement
                const inputMagnitude = Math.sqrt(player.input.x * player.input.x + player.input.y * player.input.y);
                if (inputMagnitude > 0) {
                    const normalizedInput = {
                        x: player.input.x / inputMagnitude,
                        y: player.input.y / inputMagnitude
                    };
                    
                    player.x += normalizedInput.x * moveSpeed;
                    player.y += normalizedInput.y * moveSpeed;
                }
                
                // Smooth boundary collision with bounce effect
                const boundaryForce = 0.8;
                const boundaryDistance = 2;
                
                if (player.x < -CONFIG.mapWidth + boundaryDistance) {
                    player.x = Math.max(-CONFIG.mapWidth, player.x);
                    player.input.x *= -boundaryForce; // Bounce
                } else if (player.x > CONFIG.mapWidth - boundaryDistance) {
                    player.x = Math.min(CONFIG.mapWidth, player.x);
                    player.input.x *= -boundaryForce; // Bounce
                }
                
                if (player.y < -CONFIG.mapHeight + boundaryDistance) {
                    player.y = Math.max(-CONFIG.mapHeight, player.y);
                    player.input.y *= -boundaryForce; // Bounce
                } else if (player.y > CONFIG.mapHeight - boundaryDistance) {
                    player.y = Math.min(CONFIG.mapHeight, player.y);
                    player.input.y *= -boundaryForce; // Bounce
                }
            }
            
            // Update last activity timestamp
            player.lastUpdate = Date.now();
            
        } catch (error) {
            console.error(`Error updating player ${player?.id}:`, error);
        }
    });
    
    try {
        // Check for collisions
        checkFoodCollisions(lobbyId);
        checkPlayerCollisions(lobbyId);
        
        // Clean up inactive players
        const now = Date.now();
        for (const [playerId, player] of lobby.players) {
            if (now - player.lastUpdate > 5000) { // 5 seconds timeout
                console.log(`Removing inactive player ${playerId} from lobby ${lobbyId}`);
                lobby.players.delete(playerId);
                broadcastToLobby(lobbyId, {
                    type: 'player_disconnected',
                    playerId: playerId
                });
            }
        }
        
        // Check for game end condition
        if (lobby.gameState === 'playing' && lobby.players.size <= 1) {
            const remainingPlayers = Array.from(lobby.players.values());
            endGame(lobbyId, remainingPlayers[0]?.id);
        }
    } catch (error) {
        console.error(`Error in collision detection for lobby ${lobbyId}:`, error);
    }
}

// Check for food collisions
function checkFoodCollisions(lobbyId) {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) return;

    lobby.players.forEach(player => {
        for (let i = lobby.foodItems.length - 1; i >= 0; i--) {
            const food = lobby.foodItems[i];
            const dx = player.x - food.x;
            const dy = player.y - food.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Check if player touches food
            if (distance < player.size + CONFIG.foodSize) {
                // Grow player
                player.size += CONFIG.growthRate;
                
                // Notify clients
                broadcastToLobby(lobbyId, {
                    type: 'food_eaten',
                    x: food.x,
                    y: food.y,
                    by: player.id
                });
                
                // Remove eaten food
                lobby.foodItems.splice(i, 1);
                
                // Add new food if less than threshold
                if (lobby.foodItems.length < CONFIG.foodCount * CONFIG.respawnThreshold) {
                    for (let j = 0; j < CONFIG.respawnAmount; j++) {
                        const newFood = {
                            x: (Math.random() * 2 - 1) * CONFIG.mapWidth,
                            y: (Math.random() * 2 - 1) * CONFIG.mapHeight
                        };
                        
                        lobby.foodItems.push(newFood);
                        
                        // Notify clients about new food
                        broadcastToLobby(lobbyId, {
                            type: 'food_eaten',
                            x: food.x,
                            y: food.y,
                            by: player.id,
                            newFood: newFood
                        });
                    }
                }
            }
        }
    });
}

// Check for player-player collisions with improved physics
function checkPlayerCollisions(lobbyId) {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) return;

    const playerList = Array.from(lobby.players.values());
    
    for (let i = 0; i < playerList.length; i++) {
        const playerA = playerList[i];
        if (!playerA || !playerA.id) continue;
        
        for (let j = i + 1; j < playerList.length; j++) {
            const playerB = playerList[j];
            if (!playerB || !playerB.id) continue;
            
            try {
                const dx = playerA.x - playerB.x;
                const dy = playerA.y - playerB.y;
                const distanceSquared = dx * dx + dy * dy;
                const distance = Math.sqrt(distanceSquared);
                const touchDistance = playerA.size + playerB.size;
                
                // Check if players touch
                if (distance < touchDistance) {
                    // Determine if one can absorb the other
                    if (playerA.size > playerB.size * CONFIG.absorptionThreshold) {
                        // A absorbs B with momentum conservation
                        const massRatio = playerB.size / playerA.size;
                        playerA.size += playerB.size * 0.5;
                        // Transfer some momentum
                        if (playerB.input) {
                            playerA.input.x += playerB.input.x * massRatio * 0.5;
                            playerA.input.y += playerB.input.y * massRatio * 0.5;
                        }
                        absorbPlayer(lobbyId, playerA.id, playerB.id);
                    } else if (playerB.size > playerA.size * CONFIG.absorptionThreshold) {
                        // B absorbs A with momentum conservation
                        const massRatio = playerA.size / playerB.size;
                        playerB.size += playerA.size * 0.5;
                        // Transfer some momentum
                        if (playerA.input) {
                            playerB.input.x += playerA.input.x * massRatio * 0.5;
                            playerB.input.y += playerA.input.y * massRatio * 0.5;
                        }
                        absorbPlayer(lobbyId, playerB.id, playerA.id);
                    } else {
                        // Elastic collision with size-based momentum
                        const angle = Math.atan2(dy, dx);
                        const overlap = touchDistance - distance;
                        
                        // Mass-like properties based on size
                        const totalMass = playerA.size + playerB.size;
                        const massRatioA = playerA.size / totalMass;
                        const massRatioB = playerB.size / totalMass;
                        
                        // Separation to prevent sticking
                        const separation = overlap * 0.5;
                        const separationX = Math.cos(angle) * separation;
                        const separationY = Math.sin(angle) * separation;
                        
                        // Apply separation
                        playerA.x += separationX * massRatioB;
                        playerA.y += separationY * massRatioB;
                        playerB.x -= separationX * massRatioA;
                        playerB.y -= separationY * massRatioA;
                        
                        // Exchange momentum
                        if (playerA.input && playerB.input) {
                            const tempX = playerA.input.x;
                            const tempY = playerA.input.y;
                            
                            playerA.input.x = (playerA.input.x * (massRatioA - massRatioB) + 
                                              2 * massRatioB * playerB.input.x) * 0.8;
                            playerA.input.y = (playerA.input.y * (massRatioA - massRatioB) + 
                                              2 * massRatioB * playerB.input.y) * 0.8;
                            
                            playerB.input.x = (playerB.input.x * (massRatioB - massRatioA) + 
                                              2 * massRatioA * tempX) * 0.8;
                            playerB.input.y = (playerB.input.y * (massRatioB - massRatioA) + 
                                              2 * massRatioA * tempY) * 0.8;
                        }
                    }
                }
            } catch (error) {
                console.error(`Error in collision between players ${playerA?.id} and ${playerB?.id}:`, error);
            }
        }
    }
}

// Player absorption (when one player eats another)
function absorbPlayer(lobbyId, absorberId, absorbeId) {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) return;

    // Find eliminated player's client
    let eliminatedClient = null;
    for (const [id, client] of clients.entries()) {
        if (client.playerId === absorbeId) {
            eliminatedClient = client;
            break;
        }
    }

    if (eliminatedClient) {
        // Remove player from lobby
        lobby.players.delete(absorbeId);
        eliminatedClient.playerId = null;

        // Notify all clients about player elimination
        broadcastToLobby(lobbyId, {
            type: 'player_eaten',
            eaten: absorbeId,
            by: absorberId
        });

        // Notify eliminated player specifically
        sendToClient(eliminatedClient.id, {
            type: 'you_were_eliminated'
        });
    }

    // Check if game should end
    if (lobby.players.size <= 1 && lobby.gameState === 'playing') {
        const remainingPlayers = Array.from(lobby.players.values());
        endGame(lobbyId, remainingPlayers[0]?.id);
    }
}

// Broadcast current game state to all clients
function broadcastGameState(lobbyId) {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) return;

    if (lobby.gameState !== 'playing') return;
    
    broadcastToLobby(lobbyId, {
        type: 'game_update',
        players: Array.from(lobby.players.values()).map(player => ({
            id: player.id,
            x: player.x,
            y: player.y,
            size: player.size
        }))
    });
}

// End the game
function endGame(lobbyId, winnerId) {
    const lobby = lobbies.get(lobbyId);
    if (!lobby || lobby.gameState !== 'playing') return;

    // Stop all game updates
    if (lobby.gameTickInterval) {
        clearInterval(lobby.gameTickInterval);
        lobby.gameTickInterval = null;
    }

    const winner = lobby.players.get(winnerId);
    
    // Send game over to everyone
    broadcastToLobby(lobbyId, {
        type: 'game_over',
        winner: winnerId,
        size: winner ? winner.size : 0
    });

    // Wait 3 seconds then force disconnect everyone
    setTimeout(() => {
        lobby.players.forEach(player => {
            const client = clients.get(player.clientId);
            if (client && client.ws) {
                // Tell client to prepare for reconnect
                sendToClient(client.id, { type: 'prepare_reconnect' });
                
                // Close their connection
                client.ws.close();
            }
        });
        
        // Delete the lobby
        lobbies.delete(lobbyId);
    }, 3000);
}

// Send message to a specific client
function sendToClient(clientId, message) {
    const client = clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(message));
    }
}

// Broadcast message to all connected clients
function broadcastToAll(message) {
    const serializedMessage = JSON.stringify(message);
    
    clients.forEach(client => {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(serializedMessage);
        }
    });
}

// Broadcast message to a specific lobby
function broadcastToLobby(lobbyId, message) {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) return;

    const serializedMessage = JSON.stringify(message);
    lobby.players.forEach(player => {
        const client = clients.get(player.clientId);
        if (client && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(serializedMessage);
        }
    });
}

// Handle server shutdown (for clean exit)
process.on('SIGINT', () => {
    console.log('Server shutting down...');
    
    // Clear intervals
    if (countdownInterval) clearInterval(countdownInterval);
    if (gameTickInterval) clearInterval(gameTickInterval);
    
    // Close all WebSocket connections
    wss.clients.forEach(client => {
        client.close();
    });
    
    // Close WebSocket server
    wss.close(() => {
        console.log('Server stopped');
        process.exit(0);
    });
});
console.log(gameState)
console.log('Game server is running...');