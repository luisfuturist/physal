// @ts-ignore
import { lua, lauxlib, to_luastring, to_jsstring } from 'fengari-web';

// Create Lua state
const L = lauxlib.luaL_newstate();

// Implement log function
lua.lua_pushjsfunction(L, function(L) {
    const n = lua.lua_gettop(L);
    const args: string[] = [];
    for (let i = 1; i <= n; i++) {
        args.push(to_jsstring(lauxlib.luaL_tolstring(L, i)));
        lua.lua_pop(L, 1); // remove string from stack
    }
    console.log('[Lua Worker]', ...args);
    return 0; // number of return values
});
lua.lua_setglobal(L, to_luastring("log"));

// Create Motor table
lua.lua_newtable(L);

// Implement Motor.set_speed function - sends message to main thread
lua.lua_pushjsfunction(L, function(L) {
    const n = lua.lua_gettop(L);
    if (n >= 1) {
        const speedX = lua.lua_tonumber(L, 1);
        if (lua.lua_isnumber(L, 1)) {
            let speedY = 0;
            // If only one argument, set Y to 0, otherwise use second argument
            if (n >= 2 && lua.lua_isnumber(L, 2)) {
                speedY = lua.lua_tonumber(L, 2);
            }
            
            // Send motor command to main thread
            self.postMessage({
                type: 'motor',
                speedX: speedX,
                speedY: speedY
            });
        }
    }
    return 0;
});
lua.lua_setfield(L, -2, to_luastring("set_speed"));

// Set Motor as global
lua.lua_setglobal(L, to_luastring("Motor"));

// Key table - will be updated from messages
let keyStates: Record<string, boolean> = {};

function updateKeyTable() {
    // Create new Key table
    lua.lua_newtable(L);
    
    // Add common keys
    const commonKeys = [
        'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
        'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
        'Up', 'Down', 'Left', 'Right',
        'Space', 'Enter', 'Shift', 'Control', 'Alt',
        'Escape', 'Tab', 'Backspace', 'Delete'
    ];
    
    for (const keyName of commonKeys) {
        // Check if key is pressed
        const isPressed = 
            keyStates[keyName] || 
            keyStates[keyName.toLowerCase()] ||
            (keyName === 'Up' && keyStates['ArrowUp']) ||
            (keyName === 'Down' && keyStates['ArrowDown']) ||
            (keyName === 'Left' && keyStates['ArrowLeft']) ||
            (keyName === 'Right' && keyStates['ArrowRight']) ||
            (keyName === 'Space' && keyStates[' ']) ||
            false;
        
        lua.lua_pushboolean(L, isPressed ? 1 : 0);
        lua.lua_setfield(L, -2, to_luastring(keyName));
    }
    
    // Set Key as global (replaces previous Key table)
    lua.lua_setglobal(L, to_luastring("Key"));
}

// Initialize Key table
updateKeyTable();

// Handle messages from main thread
self.addEventListener('message', (event) => {
    const { type, data } = event.data;
    
    if (type === 'init') {
        // Initialize Lua script
        const code = data.code;
        const result = lauxlib.luaL_dostring(L, to_luastring(code));
        if (result !== lua.LUA_OK) {
            const errMsg = to_jsstring(lua.lua_tostring(L, -1));
            console.error("Lua Error:", errMsg);
            lua.lua_pop(L, 1); // remove error from stack
            self.postMessage({
                type: 'error',
                message: errMsg
            });
        } else {
            console.log("Lua code executed successfully");
            self.postMessage({
                type: 'ready'
            });
        }
    } else if (type === 'keys') {
        // Update key states
        keyStates = data.keys;
        updateKeyTable();
    } else if (type === 'update') {
        // Call Lua update() function
        updateKeyTable();
        
        lua.lua_getglobal(L, to_luastring("update"));
        if (lua.lua_isfunction(L, -1)) {
            const updateResult = lua.lua_pcall(L, 0, 0, 0);
            if (updateResult !== lua.LUA_OK) {
                const errMsg = to_jsstring(lua.lua_tostring(L, -1));
                console.error("Lua Update Error:", errMsg);
                lua.lua_pop(L, 1);
                self.postMessage({
                    type: 'error',
                    message: errMsg
                });
            }
        } else {
            lua.lua_pop(L, 1); // Remove non-function value from stack
        }
    }
});

// Notify main thread that worker is ready
self.postMessage({ type: 'worker-ready' });

