// Canvas setup
const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// Box state
const box = {
    x: canvas.width / 2 - 25,
    y: canvas.height / 2 - 25,
    width: 50,
    height: 50,
    speedX: 0,
    speedY: 0,
};

// Key state tracking
const keys: Record<string, boolean> = {};

// Keyboard event listeners
window.addEventListener('keydown', (e) => {
    keys[e.key] = true;
    keys[e.code] = true;
});

window.addEventListener('keyup', (e) => {
    keys[e.key] = false;
    keys[e.code] = false;
});

// Create Web Worker for Lua execution
const worker = new Worker(new URL('./lua-worker.ts', import.meta.url), {
    type: 'module'
});

let workerReady = false;

// Handle messages from worker
worker.addEventListener('message', (event) => {
    const { type, speedX, speedY, message } = event.data;
    
    if (type === 'worker-ready') {
        // Worker is ready, send Lua code
        const code = `
log("Lua script loaded!")

-- This function will be called each frame
function update()
    local speedX = 0
    local speedY = 0
    
    if Key.A then
        speedX = speedX - 2
    end
    if Key.D then
        speedX = speedX + 2
    end
    if Key.W then
        speedY = speedY - 2
    end
    if Key.S then
        speedY = speedY + 2
    end
    
    Motor.set_speed(speedX, speedY)
end

log("Use WASD keys to move the box!")
`;
        
        worker.postMessage({
            type: 'init',
            data: { code }
        });
    } else if (type === 'ready') {
        workerReady = true;
        console.log('Lua worker ready');
    } else if (type === 'motor') {
        // Update box speed from worker
        box.speedX = speedX;
        box.speedY = speedY;
    } else if (type === 'error') {
        console.error('Lua Worker Error:', message);
    }
});

// Game loop
let lastTime = performance.now();

function gameLoop(currentTime: number) {
    const deltaTime = (currentTime - lastTime) / 1000; // Convert to seconds
    lastTime = currentTime;

    if (workerReady) {
        // Send current key states to worker
        worker.postMessage({
            type: 'keys',
            data: { keys: { ...keys } }
        });
        
        // Request Lua update
        worker.postMessage({
            type: 'update'
        });
    }

    // Update box position based on speed
    box.x += box.speedX * deltaTime * 60; // Scale by 60 for reasonable speed
    box.y += box.speedY * deltaTime * 60;

    // Keep box within canvas bounds
    if (box.x < 0) {
        box.x = 0;
        box.speedX = 0;
    }
    if (box.x + box.width > canvas.width) {
        box.x = canvas.width - box.width;
        box.speedX = 0;
    }
    if (box.y < 0) {
        box.y = 0;
        box.speedY = 0;
    }
    if (box.y + box.height > canvas.height) {
        box.y = canvas.height - box.height;
        box.speedY = 0;
    }

    // Clear canvas
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw box
    ctx.fillStyle = '#4a90e2';
    ctx.fillRect(box.x, box.y, box.width, box.height);

    // Draw border
    ctx.strokeStyle = '#2c5f8d';
    ctx.lineWidth = 2;
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    // Continue game loop
    requestAnimationFrame(gameLoop);
}

// Start game loop
requestAnimationFrame(gameLoop);
