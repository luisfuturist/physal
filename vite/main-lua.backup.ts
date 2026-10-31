// @ts-ignore
import { lua, lauxlib, to_luastring, to_jsstring } from 'fengari-web';

// Create Lua state
const L = lauxlib.luaL_newstate();

// Implement log function
lua.lua_pushjsfunction(L, function(L) {
    const n = lua.lua_gettop(L);
    const args = [];
    for (let i = 1; i <= n; i++) {
        args.push(to_jsstring(lauxlib.luaL_tolstring(L, i)));
        lua.lua_pop(L, 1); // remove string from stack
    }
    console.log(...args);
    return 0; // number of return values
});

lua.lua_setglobal(L, to_luastring("log"));

// Now Lua sees almost no globals
const code = `
log("Hello Lua!")
print("Hello Lua2!") -- error, print removed
`;

// Run the code
const result = lauxlib.luaL_dostring(L, to_luastring(code));
if (result !== lua.LUA_OK) {
    const errMsg = to_jsstring(lua.lua_tostring(L, -1));
    console.error("Lua Error:", errMsg);
    lua.lua_pop(L, 1); // remove error from stack
} else {
    console.log("Code executed successfully");
}
