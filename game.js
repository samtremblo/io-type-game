// Client-side code (index.js)
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

// Input state management
const InputState = {
    keys: new Set(),
    controls: {
        up: ['w', 'ArrowUp'],
        down: ['s', 'ArrowDown'],
        left: ['a', 'ArrowLeft'],
        right: ['d', 'ArrowRight']
    },
    mouse: { x: 0, y: 0, down: false },
    lastUpdate: 0,
    
    // Helper functions
    isKeyPressed(keys) {
        return keys.some(key => this.keys.has(key));
    },
    
    clearKeys() {
        this.keys.clear();
    },
    
    addKey(key) {
        this.keys.add(key);
    },
    
    removeKey(key) {
        this.keys.delete(key);
    }
};

// Game configuration
const CONFIG = {
    foodCount: 150, // More food for more action
    particleCount: 50, // Number of background particles
    particleSpeed: 0.02, // Speed of background particles
    trailLength: 20, // Length of player trails
    pulseSpeed: 0.5, // Speed of glow pulse effect
    foodParticleCount: 3, // Number of particles orbiting each food item
    foodParticleSpeed: 2, // Speed of orbiting food particles
    playerStartSize: 1,
    foodSize: 0.25, // Smaller food for better visibility
    growthRate: 0.08, // Faster growth for more dynamic gameplay
    absorptionThreshold: 1.15, // Easier to absorb other players
    forceMagnitude: 12, // Faster movement
    respawnThreshold: 0.4,
    respawnAmount: 15, // More food respawn
    maxReconnectAttempts: 5,
    reconnectDelay: 1000,
    inputUpdateInterval: 33, // ~30 updates per second for smoother control
    renderInterval: 1000 / 120, // 120 FPS target for smoother animation
    interpolationDelay: 50 // Reduced for more responsive gameplay
};

// Create the scene, camera, and renderer
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x000000, 20, 100); // Add fog for depth

const camera = new THREE.OrthographicCamera(
    window.innerWidth / -50, window.innerWidth / 50,
    window.innerHeight / 50, window.innerHeight / -50,
    0.1, 1000
);

const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    alpha: true
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
renderer.setClearColor(0x000000, 0.9); // Slightly transparent background

// We'll use built-in glow effects instead of post-processing for better performance

// Enable shadow mapping for better visuals
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Create a CSS2DRenderer for HTML-based UI
const css2dRenderer = new CSS2DRenderer();
css2dRenderer.setSize(window.innerWidth, window.innerHeight);
css2dRenderer.domElement.style.position = 'absolute';
css2dRenderer.domElement.style.top = '0';
css2dRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(css2dRenderer.domElement);

// Create the physics world (client-side prediction)
const world = new CANNON.World();
world.gravity.set(0, 0, 0);

// Set map size based on camera view
const mapWidth = window.innerWidth / 50;
const mapHeight = window.innerHeight / 50;

// Game state and objects
const players = new Map(); // Map of playerId -> {mesh, body, size, trail}
const foodItems = [];
const foodBodies = [];
const particles = [];

// Create background particles
const particleGeometry = new THREE.SphereGeometry(0.05, 8, 8);
const particleMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
for (let i = 0; i < CONFIG.particleCount; i++) {
    const particle = new THREE.Mesh(particleGeometry, particleMaterial);
    particle.position.set(
        (Math.random() - 0.5) * mapWidth * 2,
        (Math.random() - 0.5) * mapHeight * 2,
        0
    );
    particle.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * CONFIG.particleSpeed,
        (Math.random() - 0.5) * CONFIG.particleSpeed,
        0
    );
    particles.push(particle);
    scene.add(particle);
}
// Enhanced player colors with neon effect
const playerColors = [
    0x00ff88, // Neon green
    0xff0044, // Neon pink
    0x00ccff, // Neon blue
    0xffcc00, // Neon yellow
    0xff00ff, // Neon purple
    0xff4400, // Neon orange
    0x00ffff  // Neon cyan
];

// Game state management
const GameState = {
    CONNECTING: 'connecting',
    RECONNECTING: 'reconnecting',
    LOBBY: 'lobby',
    COUNTDOWN: 'countdown',
    PLAYING: 'playing',
    WIN: 'win',
    ERROR: 'error'
};

// State history for interpolation
const stateHistory = [];
const STATE_BUFFER_SIZE = 10;



// Performance monitoring
const Performance = {
    fps: 0,
    ping: 0,
    lastPingTime: 0,
    frameTimings: [],
    networkLatency: []
};

// Network and player information
let socket;
let clientId;
let localPlayerId;
let currentState = GameState.CONNECTING;
let countdown = 3;
let countdownInterval;
let serverUrl;

// UI Management System
class UIManager {
    constructor() {
        this.layers = {};
        this.elements = {};
        this.createUILayers();
    }

    createUILayers() {
        // Create all UI layers
        this.layers.connecting = this.createLayer('connecting');
        this.layers.lobby = this.createLayer('lobby');
        this.layers.countdown = this.createLayer('countdown');
        this.layers.game = this.createLayer('game');
        this.layers.win = this.createLayer('win');
        
        // Initialize connecting UI
        this.createConnectingUI();
    }

    createLayer(name) {
        const layer = document.createElement('div');
        layer.id = `${name}-layer`;
        layer.style.position = 'absolute';
        layer.style.top = '0';
        layer.style.left = '0';
        layer.style.width = '100%';
        layer.style.height = '100%';
        layer.style.display = 'none';
        layer.style.pointerEvents = 'auto';
        document.body.appendChild(layer);
        return layer;
    }

    createUIElement(message, size, color, layerName, id, top = '50%', left = '50%') {
        const layer = this.layers[layerName];
        const element = document.createElement('div');
        element.id = id;
        element.style.position = 'absolute';
        element.style.top = top;
        element.style.left = left;
        element.style.transform = 'translate(-50%, -50%)';
        element.style.fontSize = `${size}px`;
        element.style.color = color;
        element.style.fontFamily = 'Arial, sans-serif';
        element.style.textAlign = 'center';
        element.style.textShadow = '2px 2px 4px rgba(0, 0, 0, 0.7)';
        element.innerText = message;

        layer.appendChild(element);
        this.elements[id] = element;
        return element;
    }

    createInput(placeholder, layerName, id, top = '50%', left = '50%') {
        const layer = this.layers[layerName];
        const input = document.createElement('input');
        input.id = id;
        input.placeholder = placeholder;
        input.style.position = 'absolute';
        input.style.top = top;
        input.style.left = left;
        input.style.transform = 'translate(-50%, -50%)';
        input.style.padding = '10px';
        input.style.fontSize = '16px';
        input.style.width = '250px';
        input.style.borderRadius = '5px';
        input.style.border = '1px solid #ccc';
        
        layer.appendChild(input);
        this.elements[id] = input;
        return input;
    }

    createButton(text, layerName, id, onClick, top = '50%', left = '50%') {
        const layer = this.layers[layerName];
        const button = document.createElement('button');
        button.id = id;
        button.innerText = text;
        button.style.position = 'absolute';
        button.style.top = top;
        button.style.left = left;
        button.style.transform = 'translate(-50%, -50%)';
        button.style.padding = '12px 24px';
        button.style.fontSize = '18px';
        button.style.backgroundColor = '#4CAF50';
        button.style.color = 'white';
        button.style.border = 'none';
        button.style.borderRadius = '5px';
        button.style.cursor = 'pointer';
        button.style.transition = 'background-color 0.3s';
        
        button.onmouseover = () => {
            button.style.backgroundColor = '#45a049';
        };
        
        button.onmouseout = () => {
            button.style.backgroundColor = '#4CAF50';
        };
        
        button.onclick = onClick;
        
        layer.appendChild(button);
        this.elements[id] = button;
        return button;
    }

    showLayer(layerName) {
        // Hide all layers
        Object.values(this.layers).forEach(layer => {
            layer.style.display = 'none';
        });
        
        // Show the requested layer
        if (this.layers[layerName]) {
            this.layers[layerName].style.display = 'block';
        }
    }

    updateElement(id, newText) {
        if (this.elements[id]) {
            this.elements[id].innerText = newText;
        }
    }

    createConnectingUI() {
        this.createUIElement('IO Game Battle', 40, 'yellow', 'connecting', 'connect-title', '20%');
        
        // Create lobby button
        this.createButton('Create New Lobby', 'connecting', 'create-lobby-btn', () => {
            game.createLobby();
        }, '40%');
        
        // Join lobby section
        this.createUIElement('Or Join Existing Lobby:', 20, 'white', 'connecting', 'join-instruction', '55%');
        this.createInput('Enter Lobby Code', 'connecting', 'lobby-code-input', '65%');
        this.createButton('Join Lobby', 'connecting', 'join-lobby-btn', () => {
            const code = this.elements['lobby-code-input'].value.toUpperCase();
            game.joinLobby(code);
        }, '75%');
    }

    showLobbyCode(code) {
        this.createUIElement(`Lobby Code: ${code}`, 24, 'yellow', 'lobby', 'lobby-code', '10%');
    }

    createLobbyUI() {
        // Clear existing lobby elements first
        if (this.layers.lobby) {
            this.layers.lobby.innerHTML = '';
        }
        
        // Reset elements mapping for lobby
        Object.keys(this.elements).forEach(key => {
            if (this.elements[key]?.parentNode === this.layers.lobby) {
                delete this.elements[key];
            }
        });

        // Create lobby UI elements
        this.createUIElement('Game Lobby', 40, 'yellow', 'lobby', 'lobby-title', '20%');
        this.createUIElement('Waiting for players to join...', 20, 'white', 'lobby', 'lobby-status', '30%');
        this.createUIElement('Connected players: 0/5', 18, '#aaaaaa', 'lobby', 'player-count', '35%');
        
        // Player list container
        const playerList = document.createElement('div');
        playerList.id = 'player-list';
        playerList.style.position = 'absolute';
        playerList.style.top = '45%';
        playerList.style.left = '50%';
        playerList.style.transform = 'translate(-50%, 0)';
        playerList.style.width = '300px';
        playerList.style.maxHeight = '200px';
        playerList.style.overflowY = 'auto';
        playerList.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        playerList.style.borderRadius = '5px';
        playerList.style.padding = '10px';
        
        this.layers.lobby.appendChild(playerList);
        this.elements['player-list'] = playerList;
        
        // Ready button for local player
        const readyBtn = this.createButton('Ready', 'lobby', 'ready-btn', () => game.toggleReady(), '75%');
        readyBtn.disabled = false;
        readyBtn.style.backgroundColor = '#4CAF50';
    }

    updatePlayerList(players) {
        const list = this.elements['player-list'];
        list.innerHTML = '';
        
        players.forEach(player => {
            const playerItem = document.createElement('div');
            playerItem.style.padding = '5px';
            playerItem.style.margin = '5px 0';
            playerItem.style.backgroundColor = player.ready ? 'rgba(0, 128, 0, 0.3)' : 'rgba(128, 0, 0, 0.3)';
            playerItem.style.borderRadius = '3px';
            playerItem.style.color = '#' + player.color.toString(16).padStart(6, '0');
            
            const readyStatus = player.ready ? '✓ Ready' : '✗ Not Ready';
            playerItem.innerHTML = `<strong>${player.name}</strong> ${player.id === localPlayerId ? '(You)' : ''} - ${readyStatus}`;
            
            list.appendChild(playerItem);
        });
        
        // Update player count
        this.updateElement('player-count', `Connected players: ${players.length}/5`);
        
        // Update lobby status
        const allReady = players.length >= 2 && players.every(p => p.ready);
        this.updateElement('lobby-status', allReady ? 
            'All players ready! Game starting soon...' : 
            'Waiting for players to ready up...');
    }

    createCountdownUI() {
        this.createUIElement('Game Starting in:', 30, 'yellow', 'countdown', 'countdown-text', '40%');
        this.createUIElement('3', 60, 'red', 'countdown', 'countdown-number', '50%');
    }
    
    createGameUI() {
        // Score header
        this.createUIElement('Scores', 24, 'white', 'game', 'scores-header', '5%');
        
        // Score container
        const scoreContainer = document.createElement('div');
        scoreContainer.id = 'score-container';
        scoreContainer.style.position = 'absolute';
        scoreContainer.style.top = '10%';
        scoreContainer.style.left = '10px';
        scoreContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        scoreContainer.style.padding = '10px';
        scoreContainer.style.borderRadius = '5px';
        scoreContainer.style.maxWidth = '200px';
        
        this.layers.game.appendChild(scoreContainer);
        this.elements['score-container'] = scoreContainer;
        
        // Controls info
        const controlsInfo = document.createElement('div');
        controlsInfo.style.position = 'absolute';
        controlsInfo.style.bottom = '10px';
        controlsInfo.style.left = '50%';
        controlsInfo.style.transform = 'translateX(-50%)';
        controlsInfo.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        controlsInfo.style.color = 'white';
        controlsInfo.style.padding = '10px';
        controlsInfo.style.borderRadius = '5px';
        controlsInfo.style.fontFamily = 'Arial, sans-serif';
        controlsInfo.style.fontSize = '14px';
        controlsInfo.innerHTML = `
            <strong>Controls:</strong> WASD or Arrow Keys to move
        `;
        this.layers.game.appendChild(controlsInfo);
    }
    
    updateScores(playersList) {
        const container = this.elements['score-container'];
        container.innerHTML = '';
        
        // Sort players by size (descending)
        const sortedPlayers = [...playersList].sort((a, b) => b.size - a.size);
        
        sortedPlayers.forEach(player => {
            const scoreItem = document.createElement('div');
            scoreItem.style.margin = '5px 0';
            scoreItem.style.color = '#' + player.color.toString(16).padStart(6, '0');
            scoreItem.style.fontWeight = player.id === localPlayerId ? 'bold' : 'normal';
            scoreItem.innerHTML = `${player.name}: ${player.size.toFixed(1)}`;
            
            container.appendChild(scoreItem);
        });
    }
    
    createWinUI(winner) {
        this.createUIElement(`${winner.name} Wins!`, 50, '#' + winner.color.toString(16).padStart(6, '0'), 'win', 'win-message');
        this.createUIElement(`Final size: ${winner.size.toFixed(1)}`, 24, 'white', 'win', 'win-size', '60%');
        this.createButton('Back to Lobby', 'win', 'lobby-btn', () => game.requestLobby(), '70%');
    }
}

// Network Manager
class NetworkManager {
    constructor(onMessage, onConnect, onDisconnect) {
        this.socket = null;
        this.onMessage = onMessage;
        this.onConnect = onConnect;
        this.onDisconnect = onDisconnect;
        this.connected = false;
        this.messageQueue = [];
        this.lastSentTime = 0;
        this.sendInterval = 50; // Send input updates every 50ms (20 times per second)
    }
    
    connect(serverUrl) {
        if (this.socket) {
            this.socket.close();
        }
        
        try {
            this.socket = new WebSocket(serverUrl);
            
            this.socket.onopen = () => {
                console.log('Connected to server');
                this.connected = true;
                if (this.onConnect) this.onConnect();
                
                // Start message sender loop
                this.startMessageSender();
            };
            
            this.socket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (this.onMessage) this.onMessage(message);
                } catch (e) {
                    console.error('Failed to parse message:', e);
                }
            };
            
            this.socket.onclose = () => {
                console.log('Disconnected from server');
                this.connected = false;
                if (this.onDisconnect) this.onDisconnect();
            };
            
            this.socket.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
            
        } catch (e) {
            console.error('Failed to connect to server:', e);
            if (this.onDisconnect) this.onDisconnect();
        }
    }
    
    startMessageSender() {
        setInterval(() => {
            if (this.connected && this.messageQueue.length > 0) {
                const now = Date.now();
                if (now - this.lastSentTime >= this.sendInterval) {
                    // Only send the most recent message (latest input state)
                    const message = this.messageQueue.pop();
                    this.messageQueue = []; // Clear queue after sending
                    
                    this.send(message);
                    this.lastSentTime = now;
                }
            }
        }, this.sendInterval / 2); // Check twice as often as we send
    }
    
    send(data) {
        if (this.connected && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(data));
            return true;
        }
        return false;
    }
    
    queueMessage(data) {
        this.messageQueue.push(data);
    }
    
    disconnect() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
            this.connected = false;
        }
    }
}

// Game Manager
class Game {
    constructor() {
        this.ui = new UIManager();
        this.playersInfo = [];
        this.localPlayerReady = false;
        this.lobbyId = null;
        this.isSpectating = false;
        this.reconnecting = false;
        
        // Set up network manager
        this.network = new NetworkManager(
            this.handleServerMessage.bind(this),
            this.handleConnection.bind(this),
            this.handleDisconnection.bind(this)
        );
        
        this.initialize();
        
        // Connect to server immediately when game starts
        this.connectToServer('ws://localhost:8080');
        
        this.clearInputState = this.clearInputState.bind(this);
    }

    clearInputState() {
        // Clear all keyboard inputs
        InputState.clearKeys();
        
        // Reset mouse position and state
        InputState.mouse = { x: 0, y: 0, down: false };
        InputState.lastUpdate = 0;
    }
    
    initialize() {
        this.setState(GameState.CONNECTING);
        window.addEventListener('resize', this.handleResize.bind(this));
        
        // Handle key inputs
        window.addEventListener('keydown', (e) => {
            InputState.addKey(e.key);
            // Prevent default browser behavior for game controls
            if (Object.values(InputState.controls).flat().includes(e.key)) {
                e.preventDefault();
            }
        });
        window.addEventListener('keyup', (e) => {
            InputState.removeKey(e.key);
            if (Object.values(InputState.controls).flat().includes(e.key)) {
                e.preventDefault();
            }
        });
        
        // Handle mouse movement
        window.addEventListener('mousemove', (e) => {
            const centerX = window.innerWidth / 2;
            const centerY = window.innerHeight / 2;
            
            // Calculate direction vector from center to mouse
            const dirX = (e.clientX - centerX) / (window.innerWidth / 2);
            const dirY = -(e.clientY - centerY) / (window.innerHeight / 2);
            
            // Normalize the direction vector
            const length = Math.sqrt(dirX * dirX + dirY * dirY);
            if (length > 0) {
                InputState.mouse.x = dirX / length;
                InputState.mouse.y = dirY / length;
            } else {
                InputState.mouse.x = 0;
                InputState.mouse.y = 0;
            }
        });
        
        // Handle mouse down/up
        window.addEventListener('mousedown', () => {
            InputState.mouse.down = true;
        });
        
        window.addEventListener('mouseup', () => {
            InputState.mouse.down = false;
        });
    }
    
    handleResize() {
        camera.left = window.innerWidth / -50;
        camera.right = window.innerWidth / 50;
        camera.top = window.innerHeight / 50;
        camera.bottom = window.innerHeight / -50;
        camera.updateProjectionMatrix();
        
        renderer.setSize(window.innerWidth, window.innerHeight);
        css2dRenderer.setSize(window.innerWidth, window.innerHeight);
    }
    
    setState(newState) {
        currentState = newState;
        this.ui.showLayer(this.stateToLayerMap(newState));
    }
    
    stateToLayerMap(state) {
        switch(state) {
            case GameState.CONNECTING: return 'connecting';
            case GameState.LOBBY: return 'lobby';
            case GameState.COUNTDOWN: return 'countdown';
            case GameState.PLAYING: return 'game';
            case GameState.WIN: return 'win';
            default: return 'connecting';
        }
    }
    
    connectToServer(serverAddress) {
        serverUrl = serverAddress;
        this.network.connect(serverAddress);
    }
    
    handleConnection() {
        // Don't automatically join, wait for user to create or join lobby
        console.log('Connected to server');
    }
    
    handleDisconnection() {
        if (this.reconnecting) {
            // Wait a moment then reconnect
            setTimeout(() => {
                this.resetState();
                this.connectToServer(serverUrl);
                this.reconnecting = false;
            }, 1000);
        } else {
            // Normal disconnection handling
            alert('Disconnected from server. Please refresh to reconnect.');
            this.setState(GameState.CONNECTING);
        }
    }
    
    handleServerMessage(message) {
        switch (message.type) {
            case 'welcome':
                this.handleWelcomeMessage(message);
                break;
            case 'lobby_update':
                this.handleLobbyUpdate(message);
                break;
            case 'countdown':
                this.handleCountdown(message);
                break;
            case 'game_start':
                this.handleGameStart(message);
                break;
            case 'game_update':
                this.handleGameUpdate(message);
                break;
            case 'food_eaten':
                this.handleFoodEaten(message);
                break;
            case 'player_eaten':
                this.handlePlayerEaten(message);
                break;
            case 'game_over':
                this.handleGameOver(message);
                this.reconnecting = true;
                break;
            case 'force_lobby':
                this.forceLobbyReturn();
                break;
            case 'lobby_created':
                this.handleLobbyCreated(message);
                break;
            case 'lobby_closed':
                this.handleLobbyClosed();
                break;
            case 'player_eliminated':
                this.handlePlayerEliminated();
                break;
            case 'you_were_eliminated':
                this.handleElimination();
                break;
            case 'prepare_reconnect':
                this.handlePrepareReconnect();
                break;
            default:
                console.log('Unknown message type:', message.type);
        }
    }
    
    forceLobbyReturn() {
        // Clear game state
        this.clearGameObjects();
        
        // Reset state and UI
        this.setState(GameState.LOBBY);
        this.localPlayerReady = false;
        
        // Force UI recreation
        this.ui.createLobbyUI();
    }
    
    handleWelcomeMessage(message) {
        clientId = message.clientId;
        localPlayerId = message.playerId;
        
        // Initialize lobby
        this.setState(GameState.LOBBY);
        this.ui.createLobbyUI();
        
        // Enable ready button
        this.ui.elements['ready-btn'].disabled = false;
        this.ui.elements['ready-btn'].style.backgroundColor = '#4CAF50';
        this.lobbyId = message.lobbyId;
        this.ui.showLobbyCode(message.lobbyId);
    }
    
    handleLobbyUpdate(message) {
        this.playersInfo = message.players;
        
        // Ensure lobby UI exists and is properly initialized
        if (!this.ui.elements['ready-btn']) {
            this.ui.createLobbyUI();
        }
        
        this.ui.updatePlayerList(message.players);
        
        // Update ready button text based on local player status
        const localPlayer = this.playersInfo.find(p => p.id === localPlayerId);
        if (localPlayer && this.ui.elements['ready-btn']) {
            this.localPlayerReady = localPlayer.ready;
            const readyBtn = this.ui.elements['ready-btn'];
            readyBtn.innerText = this.localPlayerReady ? 'Cancel Ready' : 'Ready';
            readyBtn.disabled = false;
            readyBtn.style.backgroundColor = '#4CAF50';
        }
    }
    
    handleCountdown(message) {
        this.setState(GameState.COUNTDOWN);
        
        if (!this.ui.elements['countdown-text']) {
            this.ui.createCountdownUI();
        }
        
        countdown = message.count;
        this.ui.updateElement('countdown-number', countdown.toString());
    }
    
    handleGameStart(message) {
        this.setState(GameState.PLAYING);
        
        // Clear existing objects
        this.clearGameObjects();
        
        // Initialize game UI
        this.ui.createGameUI();
        
        // Create players
        message.players.forEach(playerInfo => {
            this.createPlayer(playerInfo);
        });
        
        // Create food
        message.food.forEach(foodInfo => {
            this.createFood(foodInfo);
        });
        
        // Position camera
        camera.position.set(0, 0, 10);
        camera.lookAt(new THREE.Vector3(0, 0, 0));
    }
    
    handleGameUpdate(message) {
        // Update player positions and sizes
        message.players.forEach(playerUpdate => {
            const player = players.get(playerUpdate.id);
            if (player) {
                // Update position
                player.body.position.set(playerUpdate.x, playerUpdate.y, 0);
                player.mesh.position.set(playerUpdate.x, playerUpdate.y, 0);
                
                // Update size if it changed
                if (player.size !== playerUpdate.size) {
                    player.size = playerUpdate.size;
                    player.mesh.scale.setScalar(player.size);
                    player.body.shapes[0].radius = player.size;
                }
            }
        });
        
        // Update UI scores
        this.ui.updateScores(message.players.map(p => ({
            id: p.id,
            name: this.playersInfo.find(info => info.id === p.id)?.name || 'Unknown',
            size: p.size,
            color: this.playersInfo.find(info => info.id === p.id)?.color || 0xffffff
        })));
    }
    
    handleFoodEaten(message) {
        const foodIndex = foodItems.findIndex(food => 
            food.position.x === message.x && food.position.y === message.y);
            
        if (foodIndex !== -1) {
            scene.remove(foodItems[foodIndex]);
            world.removeBody(foodBodies[foodIndex]);
            foodItems.splice(foodIndex, 1);
            foodBodies.splice(foodIndex, 1);
        }
        
        // Add new food if provided
        if (message.newFood) {
            this.createFood(message.newFood);
        }
    }
    
    handlePlayerEaten(message) {
        if (players.has(message.eaten)) {
            const player = players.get(message.eaten);
            scene.remove(player.mesh);
            world.removeBody(player.body);
            players.delete(message.eaten);
            
            // If local player was eaten
            if (message.eaten === localPlayerId) {
                // Set state to spectating
                this.localPlayerReady = false;
                localPlayerId = null;
            }
        }
    }
    
    handleGameOver(message) {
        const winnerInfo = this.playersInfo.find(p => p.id === message.winner);
        if (!winnerInfo) return;

        // Clear all input states immediately
        this.clearInputState();

        // Show winner overlay
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        overlay.style.color = '#' + winnerInfo.color.toString(16).padStart(6, '0');
        overlay.style.fontSize = '48px';
        overlay.style.display = 'flex';
        overlay.style.flexDirection = 'column';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = '1000';
        overlay.innerHTML = `
            <div>${winnerInfo.name} Wins!</div>
            <div style="font-size: 24px; margin-top: 20px;">Final Size: ${message.size.toFixed(1)}</div>
            <div style="font-size: 18px; margin-top: 20px; color: white;">Restarting game...</div>
        `;
        document.body.appendChild(overlay);

        // Clear game state
        this.clearGameObjects();
        
        // Remove overlay and clear inputs again after delay
        setTimeout(() => {
            overlay.remove();
            this.clearInputState();
        }, 3000);
    }

    handleLobbyClosed() {
        this.resetState();
        this.ui.createConnectingUI();
        
        // Clear all UI layers
        Object.keys(this.ui.layers).forEach(layerName => {
            this.ui.layers[layerName].innerHTML = '';
        });
        this.ui.elements = {};
        
        this.setState(GameState.CONNECTING);
        this.ui.createConnectingUI();
    }

    handlePlayerEliminated() {
        // Clear local player state
        this.localPlayerReady = false;
        
        // Show eliminated message
        const eliminatedText = document.createElement('div');
        eliminatedText.style.position = 'absolute';
        eliminatedText.style.top = '40%';
        eliminatedText.style.left = '50%';
        eliminatedText.style.transform = 'translate(-50%, -50%)';
        eliminatedText.style.color = 'red';
        eliminatedText.style.fontSize = '32px';
        eliminatedText.innerText = 'You were eliminated!';
        eliminatedText.style.zIndex = '1000';
        this.ui.layers.game.appendChild(eliminatedText);
        
        // Remove after 3 seconds
        setTimeout(() => {
            eliminatedText.remove();
        }, 3000);
    }

    handleElimination() {
        // Set spectating state
        this.isSpectating = true;
        localPlayerId = null;
        
        // Show eliminated message
        const eliminatedText = document.createElement('div');
        eliminatedText.style.position = 'absolute';
        eliminatedText.style.top = '40%';
        eliminatedText.style.left = '50%';
        eliminatedText.style.transform = 'translate(-50%, -50%)';
        eliminatedText.style.color = 'red';
        eliminatedText.style.fontSize = '32px';
        eliminatedText.innerText = 'You were eliminated!';
        eliminatedText.style.zIndex = '1000';
        this.ui.layers.game.appendChild(eliminatedText);
        
        // Create return to lobby button
        const returnButton = document.createElement('button');
        returnButton.innerText = 'Return to Lobby';
        returnButton.style.position = 'absolute';
        returnButton.style.top = '50%';
        returnButton.style.left = '50%';
        returnButton.style.transform = 'translate(-50%, -50%)';
        returnButton.style.padding = '10px 20px';
        returnButton.style.fontSize = '18px';
        returnButton.style.backgroundColor = '#4CAF50';
        returnButton.style.color = 'white';
        returnButton.style.border = 'none';
        returnButton.style.borderRadius = '5px';
        returnButton.style.cursor = 'pointer';
        returnButton.style.zIndex = '1000';
        
        returnButton.onclick = () => {
            this.handleLobbyClosed();
        };
        
        this.ui.layers.game.appendChild(returnButton);
        
        // Remove UI elements after 5 seconds if player hasn't clicked the button
        setTimeout(() => {
            if (this.isSpectating) {
                eliminatedText.remove();
                returnButton.remove();
                this.handleLobbyClosed();
            }
        }, 5000);
    }

    handlePrepareReconnect() {
        // Prepare for reconnection
        this.reconnecting = true;
        this.clearInputState();
    }

    toggleReady() {
        this.network.send({
            type: 'toggle_ready'
        });
    }
    
    requestLobby() {
        if (!this.lobbyId) {
            this.setState(GameState.CONNECTING);
            this.ui.createConnectingUI();
            return;
        }

        // Send request to server
        this.network.send({
            type: 'request_lobby'
        });
    }
    
    createLobby() {
        if (!this.network.connected) {
            alert('Not connected to server');
            return;
        }
        this.network.send({
            type: 'create_lobby'
        });
    }

    handleLobbyCreated(message) {
        this.lobbyId = message.lobbyId;
        const playerName = prompt('Enter your name', 'Player' + Math.floor(Math.random() * 1000));
        if (!playerName) return;
        
        // Join the newly created lobby
        this.network.send({
            type: 'join_lobby',
            lobbyId: message.lobbyId,
            name: playerName
        });
    }

    joinLobby(lobbyCode) {
        if (!this.network.connected) {
            alert('Not connected to server');
            return;
        }
        const playerName = prompt('Enter your name', 'Player' + Math.floor(Math.random() * 1000));
        if (!playerName) return;

        this.network.send({
            type: 'join_lobby',
            lobbyId: lobbyCode,
            name: playerName
        });
    }

    handleLobbyClosed() {
        alert('Lobby has been closed. Returning to main menu.');
        this.setState(GameState.CONNECTING);
        this.ui.createConnectingUI();
    }

    createPlayer(playerInfo) {
        const playerColor = this.playersInfo.find(p => p.id === playerInfo.id)?.color || 0xffffff;
        
        // Create player mesh with glow effect
        const playerGeometry = new THREE.CircleGeometry(1, 32);
        const playerMaterial = new THREE.ShaderMaterial({
            uniforms: {
                color: { value: new THREE.Color(playerColor) },
                time: { value: 0 },
                pulseSpeed: { value: CONFIG.pulseSpeed }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 color;
                uniform float time;
                uniform float pulseSpeed;
                varying vec2 vUv;
                void main() {
                    float dist = length(vUv - vec2(0.5));
                    float pulse = 0.5 + 0.5 * sin(time * pulseSpeed);
                    float alpha = smoothstep(0.5, 0.4, dist);
                    vec3 glowColor = mix(color, vec3(1.0), dist * pulse);
                    gl_FragColor = vec4(glowColor, alpha);
                }
            `,
            transparent: true
        });
        const playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);
        playerMesh.position.set(playerInfo.x, playerInfo.y, 0);
        playerMesh.scale.setScalar(playerInfo.size);
        scene.add(playerMesh);
        
        // Create trail effect
        const trail = [];
        for (let i = 0; i < CONFIG.trailLength; i++) {
            const trailGeometry = new THREE.CircleGeometry(0.8, 32);
            const trailMaterial = new THREE.MeshBasicMaterial({
                color: playerColor,
                transparent: true,
                opacity: 1 - (i / CONFIG.trailLength)
            });
            const trailMesh = new THREE.Mesh(trailGeometry, trailMaterial);
            trailMesh.position.copy(playerMesh.position);
            trailMesh.scale.setScalar(playerInfo.size);
            scene.add(trailMesh);
            trail.push(trailMesh);
        }
        
        // Create physics body
        const playerBody = new CANNON.Body({ 
            mass: 1, 
            shape: new CANNON.Sphere(playerInfo.size) 
        });
        playerBody.position.set(playerInfo.x, playerInfo.y, 0);
        playerBody.type = CANNON.Body.DYNAMIC;
        playerBody.linearDamping = 0.9;
        world.addBody(playerBody);
        
        players.set(playerInfo.id, {
            mesh: playerMesh,
            body: playerBody,
            size: playerInfo.size,
            trail: trail
        });
    }
    
    createFood(foodInfo) {
        const foodGeometry = new THREE.CircleGeometry(CONFIG.foodSize, 32);
        const foodMaterial = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                pulseSpeed: { value: CONFIG.pulseSpeed * 2 },
                glowColor: { value: new THREE.Vector3(1.0, 0.3, 0.3) }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform float pulseSpeed;
                uniform vec3 glowColor;
                varying vec2 vUv;
                void main() {
                    float dist = length(vUv - vec2(0.5));
                    float pulse = 0.5 + 0.5 * sin(time * pulseSpeed);
                    float alpha = smoothstep(0.5, 0.2, dist);
                    vec3 baseColor = glowColor;
                    vec3 glowColor = mix(baseColor, vec3(1.0), dist * pulse);
                    gl_FragColor = vec4(glowColor, alpha * (1.0 - dist * 0.5));
                }
            `,
            transparent: true
        });
        const food = new THREE.Mesh(foodGeometry, foodMaterial);
        food.position.set(foodInfo.x, foodInfo.y, 0);
        
        // Add particle effect
        const particles = [];
        for (let i = 0; i < CONFIG.foodParticleCount; i++) {
            const particleGeometry = new THREE.CircleGeometry(CONFIG.foodSize * 0.2, 16);
            const particleMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    time: { value: 0 },
                    pulseSpeed: { value: CONFIG.pulseSpeed * 2 },
                    glowColor: { value: new THREE.Vector3(1.0, 0.5, 0.5) }
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform float time;
                    uniform float pulseSpeed;
                    uniform vec3 glowColor;
                    varying vec2 vUv;
                    void main() {
                        float dist = length(vUv - vec2(0.5));
                        float pulse = 0.5 + 0.5 * sin(time * pulseSpeed + dist * 10.0);
                        float alpha = smoothstep(0.5, 0.1, dist) * (0.6 + 0.4 * pulse);
                        vec3 baseColor = glowColor;
                        vec3 finalColor = mix(baseColor, vec3(1.0), dist * pulse);
                        gl_FragColor = vec4(finalColor, alpha);
                    }
                `,
                transparent: true
            });
            const particle = new THREE.Mesh(particleGeometry, particleMaterial);
            const angle = (i / CONFIG.foodParticleCount) * Math.PI * 2;
            const radius = CONFIG.foodSize * 1.5;
            particle.position.set(
                food.position.x + Math.cos(angle) * radius,
                food.position.y + Math.sin(angle) * radius,
                0
            );
            particle.userData.angle = angle;
            particle.userData.radius = radius;
            particle.userData.speed = CONFIG.foodParticleSpeed;
            scene.add(particle);
            particles.push(particle);
        }
        food.userData.particles = particles;
        scene.add(food);
        foodItems.push(food);

        const foodBody = new CANNON.Body({ 
            mass: 0.1, 
            shape: new CANNON.Sphere(CONFIG.foodSize) 
        });
        foodBody.position.set(foodInfo.x, foodInfo.y, 0);
        world.addBody(foodBody);
        foodBodies.push(foodBody);
    }
    
    clearGameObjects() {
        // Remove players and their trails
        players.forEach(player => {
            scene.remove(player.mesh);
            world.removeBody(player.body);
            if (player.trail) {
                player.trail.forEach(trailMesh => {
                    scene.remove(trailMesh);
                });
            }
        });
        players.clear();
        
        // Remove food and their particles
        foodItems.forEach(food => {
            scene.remove(food);
            if (food.userData.particles) {
                food.userData.particles.forEach(particle => {
                    scene.remove(particle);
                });
            }
        });
        foodBodies.forEach(body => world.removeBody(body));
        foodItems.length = 0;
        foodBodies.length = 0;
        
        // Remove background particles
        particles.forEach(particle => {
            scene.remove(particle);
        });
        particles.length = 0;
        
        // Reset camera position
        camera.position.set(0, 0, 10);
        camera.lookAt(0, 0, 0);
        
        // Clear any remaining UI elements from game layer
        if (this.ui && this.ui.layers.game) {
            this.ui.layers.game.innerHTML = '';
        }
    }

    resetState() {
        this.playersInfo = [];
        this.localPlayerReady = false;
        this.lobbyId = null;
        this.isSpectating = false;
        localPlayerId = null;
        currentState = GameState.CONNECTING;
        
        // Clear all game objects
        this.clearGameObjects();
        
        // Clear input state
        this.clearInputState();
        
        // Clear all UI layers
        Object.keys(this.ui.layers).forEach(layerName => {
            this.ui.layers[layerName].innerHTML = '';
        });
        this.ui.elements = {};
        
        // Reset to initial state
        this.setState(GameState.CONNECTING);
        this.ui.createConnectingUI();
    }
    
    update() {
        if (currentState === GameState.PLAYING) {
            world.step(1 / 60);
            
            // Send player input to server
            const inputState = this.getInputState();
            if (inputState && (inputState.x !== 0 || inputState.y !== 0)) {
                console.log('Sending input:', inputState); // Debug log
                this.network.send({
                    type: 'player_input',
                    input: inputState,
                    lobbyId: this.lobbyId
                });
            }
        }
    }
    
    getInputState() {
        // Don't send inputs if spectating
        if (this.isSpectating || !this.lobbyId || currentState !== GameState.PLAYING) {
            return null;
        }
        
        // Check if enough time has passed since last input
        const now = Date.now();
        if (now - InputState.lastUpdate < CONFIG.inputUpdateInterval) {
            return null;
        }
        InputState.lastUpdate = now;
        
        // Get input direction from keyboard
        const input = { x: 0, y: 0 };
        
        if (InputState.isKeyPressed(InputState.controls.up)) input.y += 1;
        if (InputState.isKeyPressed(InputState.controls.down)) input.y -= 1;
        if (InputState.isKeyPressed(InputState.controls.left)) input.x -= 1;
        if (InputState.isKeyPressed(InputState.controls.right)) input.x += 1;
        
        // Normalize diagonal movement
        if (input.x !== 0 && input.y !== 0) {
            const length = Math.sqrt(input.x * input.x + input.y * input.y);
            input.x /= length;
            input.y /= length;
        }
        
        // Add mouse input for direction
        const mouseInput = {
            x: InputState.mouse.x,
            y: InputState.mouse.y,
            down: InputState.mouse.down
        };
        
        // If mouse is moved significantly or clicked, prioritize mouse input
        const mouseThreshold = 0.1;
        if (Math.abs(mouseInput.x) > mouseThreshold || Math.abs(mouseInput.y) > mouseThreshold || mouseInput.down) {
            return mouseInput; // Mouse input is already normalized in handleMouseMove
        }
        
        // Only send keyboard input if there's actual movement
        if (input.x !== 0 || input.y !== 0) {
            return {
                x: input.x,
                y: input.y
            };
        }
        
        return null;
    }
}

// Input handling system
class InputHandler {
    constructor() {
        // Input handling is now done in Game class
        // These event listeners are kept for compatibility
        window.addEventListener('keydown', this.handleKeyDown.bind(this));
        window.addEventListener('keyup', this.handleKeyUp.bind(this));
        window.addEventListener('mousemove', this.handleMouseMove.bind(this));
        window.addEventListener('mousedown', this.handleMouseDown.bind(this));
        window.addEventListener('mouseup', this.handleMouseUp.bind(this));
    }
    
    handleKeyDown(event) {
        if (!event.repeat) {
            InputState.addKey(event.key);
            this.processInput();
        }
    }
    
    handleKeyUp(event) {
        InputState.removeKey(event.key);
        this.processInput();
    }
    
    handleMouseMove(event) {
        // Mouse movement is now handled in Game class
        this.processInput();
    }
    
    handleMouseDown(event) {
        // Mouse down is now handled in Game class
        this.processInput();
    }
    
    handleMouseUp(event) {
        // Mouse up is now handled in Game class
        this.processInput();
    }
    
    processInput() {
        // Input handling is now done in Game class
        // This method is kept for compatibility
    }
    
    getInput() {
        // Input handling is now done in Game class
        return null;
    }
    
    clearInput() {
        // Input handling is now done in Game class
        // This method is kept for compatibility
    }
}

const inputHandler = new InputHandler();

// Create game instance
const game = new Game();

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    const time = performance.now() / 1000;
    
    // Update background particle positions
    particles.forEach(particle => {
        particle.position.add(particle.velocity);
        
        // Wrap particles around screen
        if (particle.position.x > mapWidth) particle.position.x = -mapWidth;
        if (particle.position.x < -mapWidth) particle.position.x = mapWidth;
        if (particle.position.y > mapHeight) particle.position.y = -mapHeight;
        if (particle.position.y < -mapHeight) particle.position.y = mapHeight;
    });
    
    // Update player trails and shader uniforms
    players.forEach(player => {
        if (player.trail) {
            // Update trail positions
            for (let i = player.trail.length - 1; i > 0; i--) {
                player.trail[i].position.copy(player.trail[i - 1].position);
            }
            player.trail[0].position.copy(player.mesh.position);
            
            // Update trail sizes
            player.trail.forEach((trailMesh, i) => {
                const scale = player.size * (1 - (i / CONFIG.trailLength) * 0.5);
                trailMesh.scale.set(scale, scale, 1);
            });
        }
        
        // Update shader uniforms
        if (player.mesh.material.uniforms) {
            player.mesh.material.uniforms.time.value = time;
        }
    });
    
    // Update food particles and shader uniforms
    foodItems.forEach(food => {
        if (food.material.uniforms) {
            food.material.uniforms.time.value = time;
        }
        
        if (food.userData.particles) {
            food.userData.particles.forEach((particle, i) => {
                // Update particle position
                particle.userData.angle += particle.userData.speed * 0.02;
                const angle = particle.userData.angle;
                const radius = particle.userData.radius * (1 + 0.1 * Math.sin(time * 2));
                
                particle.position.set(
                    food.position.x + Math.cos(angle) * radius,
                    food.position.y + Math.sin(angle) * radius,
                    0
                );
                
                // Update particle shader uniforms
                if (particle.material.uniforms) {
                    particle.material.uniforms.time.value = time;
                }
            });
        }
    });
    
    game.update();
    renderer.render(scene, camera);
    css2dRenderer.render(scene, camera);
}

animate();